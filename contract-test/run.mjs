// Runs a built extension backend the way the Graphite server does and checks the starter's behaviour
// against a fake Graphite API. Language-agnostic: every backend under backends/ must pass it.
// Usage: node contract-test/run.mjs <path to the backend executable>   (Node >= 22, no dependencies)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const executable = process.argv[2];
if (!executable) throw new Error('usage: node contract-test/run.mjs <backend executable>');
const root = join(import.meta.dirname, '..');
const { identifier, secrets } = JSON.parse(readFileSync(join(root, 'extension.json'), 'utf8'));
const secretName = secrets[0].name;
const apiKey = 'contract-test-key';
const secretValue = 'contract-test-secret-value';
const eventId = '0b1e9c3a-6f7d-4e21-9a55-3d2c8f4b7e10';
const classIds = ['5f0c2d9e-8a1b-4c3d-b7e6-1a2b3c4d5e6f', 'c4e8a1f2-3b5d-4e6f-8a9b-0c1d2e3f4a5b'];
const classes = [
  { class: { id: classIds[0], name: 'U12', description: '', eventId, gender: 'mixed' }, competitorCount: 3 },
  { class: { id: classIds[1], name: 'U14', description: '', eventId, gender: 'mixed' }, competitorCount: 0 },
];
const eventPath = `/api/workspaces/7/events/${eventId}`;

// The fake Graphite API. Records every request and serves only what the backend may call.
let secretIsSet = true;
const requests = [];
const api = createServer((req, res) => {
  requests.push({ method: req.method, url: req.url, apiKey: req.headers['x-api-key'] });
  if (req.headers['x-api-key'] !== apiKey) return res.writeHead(401).end();
  if (req.method === 'GET' && req.url === `${eventPath}/classes`) return json(res, classes);
  if (req.method === 'GET' && req.url === `${eventPath}/extensions/${identifier}/secrets/${secretName}/value`) {
    return secretIsSet ? json(res, { value: secretValue }) : res.writeHead(404).end();
  }
  if (req.method === 'GET' && req.url === `${eventPath}/entity-changes`) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    return res.write(`:keep-alive\n\nevent: mutation\ndata: [{"type":"class","data":{"id":"${classIds[0]}"}}]\n\n`);
  }
  res.writeHead(404).end();
});
await new Promise((done) => api.listen(0, '127.0.0.1', done));

const dataDir = mkdtempSync(join(tmpdir(), 'extension-data-'));
// The key comes from the environment only, never as a flag, so it stays out of the process list.
const { GRAPHITE_API_KEY: _, ...env } = process.env;
const args = [
  `--graphite-url=http://127.0.0.1:${api.address().port}/api`,
  '--workspace-id=7',
  `--event-id=${eventId}`,
  `--identifier=${identifier}`,
  `--data-dir=${dataDir}`,
];
const withoutKey = spawn(resolve(executable), args, { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
let withoutKeyStderr = '';
withoutKey.stderr.on('data', (chunk) => (withoutKeyStderr += chunk));
const withoutKeyCode = await new Promise((done) => withoutKey.on('exit', done));
check(withoutKeyCode !== 0 && withoutKeyStderr.includes('GRAPHITE_API_KEY'),
  `backend refuses to start without GRAPHITE_API_KEY, got code ${withoutKeyCode}: ${withoutKeyStderr.trim()}`);

let stopped = false;
const backend = spawn(resolve(executable), args, {
  cwd: root,
  env: { ...env, GRAPHITE_API_KEY: apiKey },
  stdio: ['ignore', 'pipe', 'inherit'],
});
backend.on('exit', (code, signal) => {
  if (stopped) return;
  console.error(`FAIL - backend exited early (code ${code}, signal ${signal})`);
  process.exit(1);
});

try {
  const lines = createInterface({ input: backend.stdout })[Symbol.asyncIterator]();
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('no PORT= line within 10 s')), 10_000).unref());
  const first = await Promise.race([lines.next(), timeout]);
  const port = Number(/^PORT=(\d+)$/.exec(first.value?.trim() ?? '')?.[1]);
  check(port > 0 && port < 65536, `first stdout line is PORT=<u16>, got ${JSON.stringify(first.value)}`);
  (async () => { for await (const line of lines) console.log(`  backend: ${line}`); })();

  const hello = await getHello(port);
  check(JSON.stringify(hello.classes) === JSON.stringify(classes.map(({ class: { id, name } }) => ({ id, name }))),
    `/hello returns the classes of the fake API, got ${JSON.stringify(hello.classes)}`);
  check(hello.exampleTokenIsSet === true, '/hello reports the secret as set');
  check(!JSON.stringify(hello).includes(secretValue), '/hello does not echo the secret value');
  check(requests.some((r) => r.url === `${eventPath}/classes`), 'backend fetched the classes of its event');
  check(requests.some((r) => r.url.endsWith(`/extensions/${identifier}/secrets/${secretName}/value`)),
    `backend read the secret through the value route of "${identifier}"`);

  secretIsSet = false;
  check((await getHello(port)).exampleTokenIsSet === false, '/hello reports an unset secret (404) as not set');

  for (let i = 0; i < 50 && !requests.some((r) => r.url === `${eventPath}/entity-changes`); i++) await sleep(100);
  check(requests.some((r) => r.url === `${eventPath}/entity-changes`), 'backend subscribed to the change stream');
  check(requests.every((r) => r.apiKey === apiKey), 'every request to the Graphite API carried x-api-key');
  check(!args.some((arg) => arg.includes(apiKey)), 'backend ran without the api key as flag (no --apikey)');
  console.log('Contract test passed');
} catch (error) {
  console.error(`FAIL - ${error.message}`);
  process.exitCode = 1;
} finally {
  stopped = true;
  backend.kill();
  backend.stdout.destroy();
  api.closeAllConnections();
  api.close();
  rmSync(dataDir, { recursive: true, force: true });
}

async function getHello(port) {
  const response = await fetch(`http://127.0.0.1:${port}/hello`);
  check(response.ok, `GET /hello answers 200, got ${response.status}: ${await response.clone().text()}`);
  return response.json();
}

function json(res, body) {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function check(condition, description) {
  if (!condition) throw new Error(description);
  console.log(`ok - ${description}`);
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

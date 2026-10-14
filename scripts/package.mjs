// Builds the UI and zips the extension package into dist/<name>-<version>.zip:
//   extension.json, icon.png (if present), ui/ (the module federation build)
// Usage: node scripts/package.mjs   (Node >= 22, no dependencies)
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const root = join(import.meta.dirname, '..');
const { name, version } = JSON.parse(readFileSync(join(root, 'extension.json'), 'utf8'));
if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error(`extension.json: name "${name}" may only contain [a-zA-Z0-9_-]`);

execSync('npm run build', { cwd: join(root, 'ui'), stdio: 'inherit' });

const entries = [['extension.json', join(root, 'extension.json')]];
if (existsSync(join(root, 'icon.png'))) entries.push(['icon.png', join(root, 'icon.png')]);
const uiDist = join(root, 'ui', 'dist');
for (const file of readdirSync(uiDist, { recursive: true, withFileTypes: true }).filter((f) => f.isFile())) {
  const path = join(file.parentPath, file.name);
  entries.push(['ui/' + relative(uiDist, path).split(sep).join('/'), path]);
}

mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', `${name}-${version}.zip`);
writeFileSync(out, zip(entries.map(([zipPath, path]) => [zipPath, readFileSync(path)])));
console.log(`Packaged ${entries.length} files into ${relative(root, out)}`);

/** Minimal zip writer (deflate, no zip64), enough for extension packages. */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [path, data] of files) {
    const name = Buffer.from(path);
    const deflated = deflateRawSync(data);
    // version 2.0, flags (UTF-8 names), method (deflate), time, date (1980-01-01), crc, sizes, name length, extra length
    const fields = Buffer.concat([u16(20, 0x0800, 8, 0, 0x21), u32(crc32(data), deflated.length, data.length), u16(name.length, 0)]);
    const local = Buffer.concat([u32(0x04034b50), fields, name]);
    // version made by, ...fields, comment length, disk, internal attributes, external attributes, local header offset
    centrals.push(u32(0x02014b50), u16(20), fields, u16(0, 0, 0), u32(0, offset), name);
    locals.push(local, deflated);
    offset += local.length + deflated.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.concat([u32(0x06054b50), u16(0, 0, files.length, files.length), u32(directory.length, offset), u16(0)]);
  return Buffer.concat([...locals, directory, end]);
}

function u16(...values) {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, i) => buffer.writeUInt16LE(value, i * 2));
  return buffer;
}

function u32(...values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => buffer.writeUInt32LE(value >>> 0, i * 4));
  return buffer;
}

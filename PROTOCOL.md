# Extension backend protocol

What the Graphite server expects from an extension backend and what it offers it. The Rust backend in
[`backends/rust`](backends/rust) implements it, [`contract-test`](contract-test) checks it.

Sections marked **Not released yet** describe server features that are not in a released Graphite
server yet. Server paths are relative to the API base URL, `/api` on self-hosted servers.

## Package

An extension is installed from a zip:

```
extension.json          the manifest, at the root of the zip
icon.png                optional
ui/                     optional, the Module Federation build of the UI
backend/my-extension    optional, the backend executable (any path, see `entry`)
```

The backend related fields of `extension.json`:

- `identifier`: a single path segment (no `/`, `\`, `:` or control characters). URLs of the
  extension contain it.
- `entry` (optional): path of the backend executable relative to the package root, like
  `backend/my-extension`. It can not leave the package. Without `entry` no process is started and the
  extension only provides UI.
- `secrets` (optional): `[{ "name": "...", "label": { "en": "...", "de": "..." } }]`, see
  [Secrets](#secrets).

The executable must be a native binary for the server's platform; the registry serves one zip per
platform (`linux-x64`, `linux-arm64`, `windows-x64`, `macos-arm64`, `macos-x64`). Store the unix mode
`0755` in the zip (the server also sets the executable bit on unix before starting it). For an
`entry` without `.exe`, the server starts `<entry>.exe` if that file exists and `<entry>` otherwise
(the resolution of Rust's `std::process::Command`), so one package can contain `server` and
`server.exe` with `"entry": "server"`.

## Process start

The server starts one process per event the extension is installed in, with the package directory as
working directory, stdin closed, the environment variable `GRAPHITE_API_KEY` set to its api key (see
[Calling the Graphite API](#calling-the-graphite-api); not a flag, so it does not show up in the
process list) and these flags, each as one argument of the form `--name=value`:

| Flag             | Value                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `--graphite-url` | Base URL of the Graphite REST API without trailing slash, e.g. `http://127.0.0.1:8080/api` |
| `--workspace-id` | Id of the workspace                                                                      |
| `--event-id`     | Id of the event                                                                          |
| `--identifier`   | `identifier` of the extension, e.g. for the URLs of its own secrets and backend          |
| `--data-dir`     | Absolute path of a directory for the extension's data in this event. It exists at start. |

Ignore flags you do not know, later servers may add some.

Every extension gets its own data dir per event, inside the workspace directory:
`event-<id>/local-extensions/<identifier>/data` or `event-<id>/registry-extensions/<identifier>/data`
depending on how it is installed, and `event-<id>/dev-extensions/<identifier>/data` for a dev
extension. It persists across restarts and new versions of the extension and belongs to the
workspace: it is part of workspace downloads, uploads, check-ins and replication. **Never store
secrets or credentials in it**, use [Secrets](#secrets). Do not write into the package directory
either, it is replaced on updates. Only rely on the path passed in `--data-dir`.

## Handshake

The backend binds an HTTP server to `127.0.0.1` (any free port, e.g. port `0`) and prints

```
PORT=<port>
```

as the **first line on stdout**, then flushes stdout. The port is a decimal `u16`. If that line does
not arrive within **10 seconds**, is malformed, or the process exits first, the extension is marked as
failed to start.

Everything else the backend prints to stdout (after the handshake) and to stderr goes to the
extension's log file and to the server's console. Self-hosted servers serve the log at
`GET /workspaces/{workspaceId}/events/{eventId}/extensions/{identifier}/log`.

## Lifecycle

- Started when the workspace loads (also on server start) and when the extension is installed in an
  event or changes version.
- Stopped when it is uninstalled, uploaded again, when its workspace is replaced or deleted, and when
  the server stops. On unix it receives `SIGTERM` and is killed 5 seconds later if it still runs, so
  shut down gracefully within that time. On Windows it is killed right away, so keep the data dir
  consistent at all times anyway (e.g. write to a temporary file and rename it).
- On Linux the process is killed when the server dies without stopping it. Elsewhere a backend that
  must not outlive a crashed server has to check that itself.
- A process that exits on its own is started again after 1, 2 and 4 seconds; exits after running
  for more than a minute do not count. If it exits again after the third restart in a row it is not
  restarted anymore and its error state is `crashed`, until it is installed again or the server
  restarts. While it is not running, requests to it fail with `503`.
- Uploading a new zip of a locally installed extension restarts all its running processes (in every
  event it is installed in) with the new files and new api keys.

## Requests from the engine

The server proxies

```
/workspaces/{workspaceId}/events/{eventId}/extensions/{identifier}/backend/{rest}
```

to `http://127.0.0.1:<port>/{rest}` of the backend (`…/backend` without rest goes to `/`). `GET` and
`HEAD` require read access to the event, every other method write access (`409` on read-only
workspaces). Users who may only read the event can call `GET` and `HEAD`, so **never change anything
on `GET` or `HEAD`**.

- Forwarded: method, path and query string exactly as the client sent them (still percent-encoded),
  headers and the body (up to 50 MB).
- Removed: the user's credentials (`Cookie`, `x-api-key`) and hop-by-hop headers (`Host`,
  `Connection`, `Transfer-Encoding`, `TE`, `Trailer`, `Upgrade`, `Proxy-Authorization`,
  `Proxy-Authenticate`). The backend does not learn who calls it.
- The response is streamed back with its status and headers, except `Set-Cookie`. Redirects (`3xx`)
  are not followed but passed to the client. Server-sent events work, WebSockets do not.

## Calling the Graphite API

Send the key from `GRAPHITE_API_KEY` in the `x-api-key` header to `--graphite-url`:

```
GET {graphite-url}/workspaces/{workspace-id}/events/{event-id}/classes
x-api-key: {GRAPHITE_API_KEY}
```

The key grants what an event scoped api key grants, for this event only, and identifies the
extension. It is kept across restarts after crashes, but revoked when the process is stopped or
crashed for good and replaced when the extension is uploaded again, so never persist it. The
server's OpenAPI description documents the endpoints.

## Secrets

**Not released yet.** Credentials, like api keys of other services, are stored as secrets: encrypted
on the server and never part of workspace data. Declare them in `extension.json`; names only contain
`a-z`, `0-9` and `-`, labels map a locale to the text the engine shows:

```json
"secrets": [{ "name": "example-token", "label": { "en": "Example token", "de": "Beispiel-Token" } }]
```

Users set them in the engine. The backend reads a value with its own key:

```
GET {graphite-url}/workspaces/{workspace-id}/events/{event-id}/extensions/{identifier}/secrets/{name}/value
→ 200 { "value": "..." }   404 if it is not set
```

Only the key of that extension in that event may read it (`403` otherwise). Extensions can not set
or delete secrets. Uninstalling the extension from the event deletes its secrets. Read a secret when
you need it instead of only at start, users may change it while the backend runs. Never log or
return secret values.

## Change events

**Not released yet.** `GET {graphite-url}/workspaces/{workspace-id}/events/{event-id}/entity-changes`
(with `x-api-key`) is a server-sent events stream. Each `mutation` event carries a JSON array of
entity changes of the event. Changes that can not be attributed to an event, like deletions, are
included too. Reconnect when the stream ends.

## Dev mode

**Not released yet.** On a self-hosted server the developer can run the backend themselves, e.g.
with `cargo run` or in a debugger. Only the server owner (password login) can do this: in the event's
**Extensions** sidebar, under **Plugin developers**, add a **Dev extension** with the `identifier`
from `extension.json`, the UI entry URL and a **Backend port**. The sidebar then shows the command
line to start the backend with, `GRAPHITE_API_KEY=<key> <flags>` (a new key each time), and lets you
set the dev extension's secrets by name. Outside a POSIX shell (e.g. on Windows or in an IDE run
configuration) set `GRAPHITE_API_KEY` in the environment and pass the flags as arguments.

Start the backend like that, listening on `127.0.0.1:<backend port>`; there is no `PORT=`
handshake. The backend route of the identifier is then proxied to that port instead of an installed
extension (`502` if nothing listens). A dev extension shares the secrets of the installed extension
with the same identifier; removing it revokes its key. Underneath, the sidebar uses
`POST|GET /workspaces/{workspaceId}/events/{eventId}/dev-extensions` (`{ identifier, port }` in,
`{ identifier, port, args, env }` out, `env` holding `GRAPHITE_API_KEY`) and `DELETE …/{identifier}`.

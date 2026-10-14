# Graphite starter extension

A minimal, working [Graphite](https://www.graphite-engine.com) extension to copy and build on. It adds a
sidebar, a page, a note on every game page and a toast, translated into English and German.

```
extension.json   package manifest (name, version, ...)
ui/              the extension's UI, a Module Federation 2 remote built with rsbuild
scripts/         packaging
```

## Prerequisites

- Node.js 22 or newer
- A Graphite engine. Installing your own extension packages requires a self-hosted engine.

## Develop

```bash
cd ui
npm install
npm run dev        # serves the extension on http://localhost:3002
```

In the engine, open an event, open the **Extensions** sidebar, expand **Plugin developers**, add a
**Dev extension** with the entry URL `http://localhost:3002/mf-manifest.json` and enable it. The
contributions of `ui/src/manifest.tsx` appear in the event; reload the engine after changes.

`npm run typecheck` type-checks the extension against the SDK.

## Package and install

```bash
node scripts/package.mjs
```

This builds the UI and writes `dist/<name>-<version>.zip` containing `extension.json`, `icon.png` (if
present in the repository root) and the UI build under `ui/`. Name and version come from
`extension.json`; the name may only contain `[a-zA-Z0-9_-]`.

Install the zip in a self-hosted engine with the **+** button of the **Extensions** sidebar, then
enable the extension in an event.

## The SDK

Extensions import everything they need from the engine from
[`@graphite-sports/sdk`](https://www.npmjs.com/package/@graphite-sports/sdk): the manifest types,
components such as `AppButton`, routing (`useRouter`, `buildRoute`), query options for engine data,
`toast` and `useEngineLocale`. Its type declarations (`node_modules/@graphite-sports/sdk/index.d.ts`)
are the reference.

The package contains types only. At runtime the engine provides the SDK, React and React Query as
shared singletons (see `ui/rsbuild.config.ts`), so never bundle your own copies and never import from
`@graphite-sports/sdk/...` subpaths.

The SDK follows semver: its major version is the compatibility contract with the engine. While it is
`0.x`, minor versions may contain breaking changes.

## Translations

Extensions ship their own dictionaries. They live in `ui/src/i18n/<locale>/index.ts` and use
[typesafe-i18n](https://github.com/ivanhofer/typesafe-i18n). After adding or renaming keys run
`npm run i18n` in `ui/`. `useLL()` picks the locale the user selected in the engine
(`useEngineLocale()`); every engine locale needs a dictionary, otherwise type-checking fails.

## License

[MIT](LICENSE)

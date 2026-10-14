import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';

/**
 * The engine provides these modules at runtime. `import: false` makes sure they are never bundled,
 * so the extension uses the engine's React, query client, router and SDK instances.
 */
const fromHost = { singleton: true, import: false } as const;

export default defineConfig({
  // The only entry is the module federation container below.
  source: { entry: {} },
  // The engine serves the build from a path it chooses, so assets must resolve relative to the manifest.
  output: { assetPrefix: 'auto' },
  // The engine loads the dev server cross-origin from the browser.
  server: { port: 3002, cors: { origin: /^https?:\/\/localhost(?::\d+)?$/ } },
  plugins: [
    pluginReact(),
    pluginModuleFederation({
      // Must be a valid JS identifier and unique among installed extensions.
      name: 'starter_extension',
      exposes: { './manifest': './src/manifest.tsx' },
      shared: {
        react: { ...fromHost, requiredVersion: '^19.1.1' },
        'react-dom': { ...fromHost, requiredVersion: '^19.1.1' },
        '@tanstack/react-query': { ...fromHost, requiredVersion: '=5.90.7' },
        '@graphite-sports/sdk': { ...fromHost, requiredVersion: false },
      },
      dts: false,
    }),
  ],
});

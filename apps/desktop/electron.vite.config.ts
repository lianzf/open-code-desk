import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const rendererRoot = fileURLToPath(new URL('./src/renderer', import.meta.url));
const rendererSource = fileURLToPath(new URL('./src/renderer/src', import.meta.url));
const bundledWorkspacePackages = [
  '@open-code-desk/application',
  '@open-code-desk/domain',
  '@open-code-desk/ipc-contracts',
  '@open-code-desk/provider-core',
  '@open-code-desk/tool-core',
];
const bundledPreloadPackages = [...bundledWorkspacePackages, 'zod'];
const developmentCspPlugin = {
  name: 'open-code-desk-development-csp',
  transformIndexHtml(html: string, context: { readonly server?: unknown }): string {
    const developmentConnections =
      context.server === undefined ? '' : 'http://localhost:* ws://localhost:*';
    return html.replace('__DEVELOPMENT_CONNECT_SOURCES__', developmentConnections);
  },
};

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: bundledWorkspacePackages,
      }),
    ],
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: bundledPreloadPackages,
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
        },
      },
    },
  },
  renderer: {
    root: rendererRoot,
    resolve: {
      alias: {
        '@': rendererSource,
      },
    },
    plugins: [react(), tailwindcss(), developmentCspPlugin],
    build: {
      // The renderer outDir lives outside rendererRoot. Vite otherwise keeps
      // content-hashed bundles from every build, inflating packaged apps and
      // making cold start progressively slower.
      emptyOutDir: true,
    },
  },
});

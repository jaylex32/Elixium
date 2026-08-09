import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Event contract compiled by the server too — see shared/socket-events.ts
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    // Source maps for a production bug report, without shipping them inline.
    sourcemap: false,
    // Warn only for genuinely large chunks, now that vendors are split out.
    chunkSizeWarningLimit: 300,
    rollupOptions: {
      output: {
        /*
         * Id-based splitting rather than a package-name map.
         *
         * The previous object form listed `react` and `react-dom`, but the app
         * imports `react-dom/client` and `react/jsx-runtime` — different module
         * ids than the bare package names, so they never matched and React
         * ended up inside the main bundle while the "react" chunk came out at
         * 60 bytes. Matching on the resolved path catches every subpath.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('framer-motion')) return 'motion';
          if (id.includes('@tanstack')) return 'query';
          if (/[\\/]node_modules[\\/](axios|socket\.io-client|engine\.io-client)[\\/]/.test(id)) return 'net';
          if (id.includes('lucide-react')) return 'icons';

          /*
           * Radix plus everything that sits on top of it (cmdk, sonner) and
           * everything it sits on (the react-remove-scroll / aria-hidden
           * family). Splitting these apart produced a vendor -> radix -> vendor
           * cycle, because the wrappers import Radix while Radix imports the
           * scroll-lock helpers — and circular chunks have undefined module
           * initialization order at runtime.
           */
          if (
            id.includes('@radix-ui') ||
            /[\\/]node_modules[\\/](cmdk|sonner|vaul)[\\/]/.test(id) ||
            /[\\/]node_modules[\\/](aria-hidden|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar|get-nonce|detect-node-es|tslib)[\\/]/.test(
              id,
            )
          ) {
            return 'ui';
          }

          return 'vendor';
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});

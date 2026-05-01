import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Unbundled deploy uses ./frontend/public/...; Vite serves public files at /manifest.json */
function manifestLinkPlugin() {
  return {
    name: 'dashboard-manifest-link',
    enforce: 'pre',
    transformIndexHtml(html) {
      return html.replaceAll('./frontend/public/manifest.json', '/manifest.json');
    }
  };
}

export default defineConfig(() => {
  const base = process.env.VITE_BASE || './';
  return {
    root: __dirname,
    base,
    publicDir: 'frontend/public',
    appType: 'spa',
    plugins: [manifestLinkPlugin()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      assetsDir: 'assets',
      cssCodeSplit: false,
      sourcemap: false,
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
        output: {
          inlineDynamicImports: true,
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      },
      modulePreload: { polyfill: false }
    },
    server: {
      port: 5173,
      fs: { allow: [__dirname] }
    }
  };
});

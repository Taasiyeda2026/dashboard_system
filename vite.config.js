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
    // Only allow explicit public Supabase keys; never expose service-role secrets.
    envPrefix: ['VITE_', 'NEXT_PUBLIC_', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'],
    publicDir: 'frontend/public',
    appType: 'spa',
    plugins: [manifestLinkPlugin()],
    // The resident module worker uses async imports for the authenticated route
    // fallback; Rollup's default IIFE worker output cannot split that graph.
    worker: { format: 'es' },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      assetsDir: 'assets',
      cssCodeSplit: false,
      sourcemap: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
          // Standalone public feedback form (no app shell / login).
          feedback: resolve(__dirname, 'feedback.html')
        },
        output: {
          // Do not inline dynamic imports: feature/screen bundles must stay async chunks.
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

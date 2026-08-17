/**
 * Copies the pre-built, dependency-free @supabase/supabase-js UMD bundle into
 * attendance/vendor/ so the unbundled Attendance V2 app can load it with a plain
 * <script> tag (window.supabase) — no external CDN, no bundler for that app.
 * Regenerated from node_modules on every dev/build; not committed to git.
 */
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
const destDir = join(root, 'attendance', 'vendor');
const dest = join(destDir, 'supabase.js');

if (!existsSync(src)) {
  console.error('[sync-attendance-vendor] @supabase/supabase-js UMD build not found at', src);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.info('[sync-attendance-vendor] copied @supabase/supabase-js UMD build to attendance/vendor/supabase.js');

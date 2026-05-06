/**
 * After `vite build`: copy static tree expected by manifest/PWA, fix manifest paths,
 * copy service worker, and align SW precache with hashed filenames in dist/index.html.
 * Source repo layout (unbundled deploy) is unchanged.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');

function collectAssetRefs(html, base) {
  const out = new Set();
  const re = /(?:href|src)="([^"?#]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    let p = m[1];
    if (p.startsWith('./')) p = p.slice(2);
    if (!p.includes('assets/')) continue;
    if (!p.startsWith('/')) p = '/' + p;
    if (base && base !== '/' && base !== './' && p.startsWith(base)) {
      p = p.slice(base.replace(/\/$/, '').length);
    }
    out.add(p);
  }
  return out;
}

function walkFiles(dir, base = dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) files.push(...walkFiles(full, base));
    else files.push('/' + relative(base, full).replace(/\\/g, '/'));
  }
  return files;
}

if (!existsSync(join(dist, 'index.html'))) {
  console.error('[postbuild-dist] dist/index.html missing — run vite build first');
  process.exit(1);
}

mkdirSync(join(dist, 'assets'), { recursive: true });
cpSync(join(root, 'frontend', 'assets'), join(dist, 'assets'), { recursive: true });

const viteBaseRaw = process.env.VITE_BASE || './';
const manPath = join(dist, 'manifest.json');
if (existsSync(manPath)) {
  const m = JSON.parse(readFileSync(manPath, 'utf8'));
  const isAbsoluteBase = viteBaseRaw.startsWith('/') && viteBaseRaw !== '/';
  const basePrefix = isAbsoluteBase
    ? viteBaseRaw.replace(/\/$/, '') + '/'
    : './';
  m.start_url = isAbsoluteBase ? basePrefix + 'index.html' : './index.html';
  m.scope = basePrefix;
  m.id = isAbsoluteBase ? basePrefix + 'index.html' : './index.html';
  m.icons = (m.icons || []).map((icon) => {
    const src = String(icon.src || '');
    const next = src
      .replace(/^\.\.\/assets\//, './assets/')
      .replace(/^\.\/frontend\/assets\//, './assets/');
    return { ...icon, src: next };
  });
  writeFileSync(manPath, JSON.stringify(m, null, 2));
}

mkdirSync(join(dist, 'frontend'), { recursive: true });
cpSync(join(root, 'sw.js'), join(dist, 'sw.js'));
cpSync(join(root, 'frontend', 'sw.js'), join(dist, 'frontend', 'sw.js'));

let html = readFileSync(join(dist, 'index.html'), 'utf8');
const hashedManifest = html.match(/href="(\.\/assets\/manifest-[^"]+)"/);
if (hashedManifest) {
  const orphan = join(dist, hashedManifest[1].replace(/^\.\//, ''));
  html = html.replace(
    /<link rel="manifest" href="\.\/assets\/manifest-[^"]+"\s*\/?>/,
    '<link rel="manifest" href="./manifest.json" />'
  );
  writeFileSync(join(dist, 'index.html'), html);
  if (existsSync(orphan)) {
    try {
      unlinkSync(orphan);
    } catch {
      /* ignore */
    }
  }
}

const precache = new Set(['/index.html', '/manifest.json']);
for (const u of collectAssetRefs(html, viteBaseRaw)) precache.add(u);
for (const u of walkFiles(join(dist, 'assets'))) precache.add('/assets' + u);

const swOut = join(dist, 'frontend', 'sw.js');
let sw = readFileSync(swOut, 'utf8');
const sorted = [...precache].sort();
sw = sw.replace(/const PRECACHE_URLS = \[[\s\S]*?\];/, `const PRECACHE_URLS = ${JSON.stringify(sorted, null, 2)};`);
writeFileSync(swOut, sw);

console.info('[postbuild-dist] precache entries:', sorted.length);

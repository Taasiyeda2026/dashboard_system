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
cpSync(join(root, 'frontend', 'public'), dist, { recursive: true });

const viteBaseRaw = process.env.VITE_BASE || './';
const isAbsoluteBase = viteBaseRaw.startsWith('/') && viteBaseRaw !== '/';
const basePrefix = isAbsoluteBase
  ? viteBaseRaw.replace(/\/$/, '') + '/'
  : './';
const manPath = join(dist, 'manifest.json');
if (existsSync(manPath)) {
  const m = JSON.parse(readFileSync(manPath, 'utf8'));
  m.start_url = basePrefix;
  m.scope = basePrefix;
  m.id = basePrefix;
  m.icons = (m.icons || []).map((icon) => {
    const src = String(icon.src || '');
    const assetPath = src
      .replace(/^\.\.\/assets\//, 'assets/')
      .replace(/^\.\/frontend\/assets\//, 'assets/')
      .replace(/^\.\/assets\//, 'assets/')
      .replace(/^\/[^/]+\/assets\//, 'assets/')
      .replace(/^\/assets\//, 'assets/');
    const next = isAbsoluteBase && assetPath.startsWith('assets/')
      ? basePrefix + assetPath
      : assetPath.startsWith('assets/')
        ? './' + assetPath
        : src;
    return { ...icon, src: next };
  });
  writeFileSync(manPath, JSON.stringify(m, null, 2));
}

mkdirSync(join(dist, 'frontend'), { recursive: true });

let html = readFileSync(join(dist, 'index.html'), 'utf8');
const manifestHref = isAbsoluteBase ? basePrefix + 'manifest.json' : './manifest.json';
const hashedManifest = html.match(/href="((?:\.|\/[^"]*)?\/assets\/manifest-[^"]+)"/);
if (hashedManifest) {
  const orphanRel = hashedManifest[1]
    .replace(/^\.\//, '')
    .replace(new RegExp('^' + basePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '');
  const orphan = join(dist, orphanRel);
  if (existsSync(orphan)) {
    try {
      unlinkSync(orphan);
    } catch {
      /* ignore */
    }
  }
}
html = html.replace(
  /<link rel="manifest" href="[^"]+"\s*\/?>/,
  `<link rel="manifest" href="${manifestHref}" />`
);
writeFileSync(join(dist, 'index.html'), html);

const precache = new Set(['./index.html', './manifest.json']);
for (const u of collectAssetRefs(html, viteBaseRaw)) {
  precache.add('.' + u);
}
for (const u of walkFiles(join(dist, 'assets'))) {
  precache.add('./assets' + u);
}
for (const u of walkFiles(join(dist, 'catalog'))) {
  precache.add('./catalog' + u);
}

let sw = readFileSync(join(root, 'frontend', 'sw.js'), 'utf8');
const sorted = [...precache].sort();
sw = sw.replace(/const PRECACHE_URLS = \[[\s\S]*?\];/, `const PRECACHE_URLS = ${JSON.stringify(sorted, null, 2)};`);
writeFileSync(join(dist, 'sw.js'), sw);
writeFileSync(join(dist, 'frontend', 'sw.js'), sw);

console.info('[postbuild-dist] precache entries:', sorted.length);

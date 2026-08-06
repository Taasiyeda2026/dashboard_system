import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const isolationSource = await readFile(
  new URL('../frontend/src/auth-session-isolation-hotfix.js', import.meta.url),
  'utf8'
);
const cachePersistSource = await readFile(
  new URL('../frontend/src/cache-persist.js', import.meta.url),
  'utf8'
);

test('logout cleanup includes the current persisted screen-cache prefix', () => {
  assert.match(
    cachePersistSource,
    /export const SCREEN_CACHE_STORAGE_PREFIX = 'ds_screen_cache_v2';/
  );
  assert.match(
    isolationSource,
    /import \{ SCREEN_CACHE_STORAGE_PREFIX \} from '\.\/cache-persist\.js';/
  );
  assert.match(
    isolationSource,
    /const SCREEN_CACHE_PREFIXES = \[[\s\S]*SCREEN_CACHE_STORAGE_PREFIX[\s\S]*\];/
  );
  assert.match(
    isolationSource,
    /SCREEN_CACHE_PREFIXES\.some\(\(prefix\) => key === prefix \|\| key\.startsWith\(prefix\)\)/
  );
});

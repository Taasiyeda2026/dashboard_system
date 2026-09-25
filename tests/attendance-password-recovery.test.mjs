import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const login = await readFile(new URL('../attendance/src/screens/login-screen.js', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/management-password-reset/index.ts', import.meta.url), 'utf8');
const index = await readFile(new URL('../attendance/index.html', import.meta.url), 'utf8');
const sw = await readFile(new URL('../attendance/sw.js', import.meta.url), 'utf8');

test('attendance login exposes the existing password recovery flow', () => {
  assert.match(login, /שכחתי קוד כניסה/);
  assert.match(login, /supabase\.functions\.invoke\('management-password-reset'/);
  assert.match(login, /action: 'request'/);
  assert.match(login, /action: 'complete'/);
  assert.match(login, /challenge_id: challengeId/);
  assert.match(login, /new_password: password/);
});

test('recovery email normalization removes invisible bidi and zero-width marks', () => {
  assert.match(edge, /\\u200B-\\u200F/);
  assert.match(edge, /\\u202A-\\u202E/);
  assert.match(edge, /\\u2066-\\u2069/);
  assert.match(edge, /\\uFEFF/);
  assert.match(login, /\\u200B-\\u200F/);
});

test('attendance cache is bumped so the recovery UI reaches existing installs', () => {
  assert.match(index, /v=97/);
  assert.match(sw, /const CACHE_VERSION = 97/);
});

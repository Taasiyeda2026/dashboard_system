import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateProductionAuthConfig, workflowConfigPushViolations } from '../scripts/ci/guard-supabase-production-auth.mjs';

const original = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');

test('production OAuth configuration matches the public dashboard and staff consent route', () => {
  assert.deepEqual(validateProductionAuthConfig(original), []);
});

test('a loopback site URL cannot replace the production Site URL', () => {
  const unsafe = original.replace('site_url = "https://taasiyeda2026.github.io/dashboard_system"',
    'site_url = "http://127.0.0.1:3000"');
  assert.match(validateProductionAuthConfig(unsafe).join(' '), /localhost/);
});

test('missing production redirect and changed consent path are rejected', () => {
  const unsafe = original
    .replace('"https://taasiyeda2026.github.io/dashboard_system",', '"https://different.example",')
    .replace('authorization_url_path = "/scheduling-agent-approval.html"', 'authorization_url_path = "/missing"');
  assert.equal(validateProductionAuthConfig(unsafe).length, 2);
});

test('unscoped site URL and an automated config push are rejected', () => {
  assert.match(validateProductionAuthConfig(original + '\n[auth]\nsite_url = "http://localhost:3000"\n').join(' '), /unscoped/);
  assert.deepEqual(workflowConfigPushViolations([
    { path: 'safe.yml', source: 'run: npm ci' },
    { path: 'unsafe.yml', source: 'run: supabase config push --project-ref prod' }
  ]).map(x => x.path), ['unsafe.yml']);
});

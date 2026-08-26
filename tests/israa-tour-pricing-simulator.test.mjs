import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pricingSource = await readFile(new URL('../frontend/src/screens/admin-pricing-simulator.js', import.meta.url), 'utf8');
const israSource = await readFile(new URL('../frontend/src/israa-proposal-items.js', import.meta.url), 'utf8');

test('tour pricing simulator keeps admin access and also follows Israa management permission', () => {
  assert.match(pricingSource, /import \{ canViewIsraaManagement \} from '\.\.\/permissions\.js';/);
  assert.match(pricingSource, /role === 'admin' \|\| canViewIsraaManagement\(state\?\.user\)/);
  assert.match(pricingSource, /if \(!canOpenPricingSimulator\(\) \|\| typeof document === 'undefined'\) return;/);
});

test('Israa page exposes one launcher for the shared tour pricing simulator', () => {
  assert.match(israSource, /data-israa-tour-pricing/);
  assert.match(israSource, /button\.textContent = 'סימולטור סיורים'/);
  assert.match(israSource, /import\('\.\/screens\/admin-pricing-simulator\.js'\)/);
  assert.match(israSource, /module\.openAdminPricingSimulator\?\.\(\)/);
});

test('Israa launcher does not grant or mutate admin role', () => {
  assert.doesNotMatch(israSource, /state\s*\.\s*user\s*\.\s*role\s*=/);
  assert.doesNotMatch(israSource, /display_role\s*=/);
  assert.doesNotMatch(israSource, /role\s*=\s*['"]admin['"]/);
});

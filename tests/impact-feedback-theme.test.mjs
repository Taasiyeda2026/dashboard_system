import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adminCss = await readFile(new URL('../frontend/src/impact-feedback/impact-feedback-admin.css', import.meta.url), 'utf8');
const formCss = await readFile(new URL('../frontend/src/impact-feedback/feedback-form.css', import.meta.url), 'utf8');

test('impact feedback admin follows the global dashboard accent picker', () => {
  assert.match(adminCss, /--ifb-a-accent:\s*var\(--ds-accent,/);
  assert.match(adminCss, /--ifb-a-accent-hover:\s*var\(--ds-accent-hover,/);
  assert.match(adminCss, /--ifb-a-accent-soft:\s*var\(--ds-accent-soft,/);
  assert.match(adminCss, /--ifb-a-blue:\s*var\(--ds-accent,/);
  assert.match(adminCss, /\.ifb-btn--primary:hover\s*\{[^}]*var\(--ifb-a-accent-hover\)/s);
  assert.match(adminCss, /\.ifb-qr__kicker\s*\{[^}]*var\(--ds-accent,/s);
});

test('feedback questionnaire/preview uses the dashboard accent bridge with neutral fallback', () => {
  assert.match(formCss, /--ifb-accent:\s*var\(--ds-accent,\s*#1a3358\)/);
  assert.match(formCss, /--ifb-accent-soft:\s*var\(--ds-accent-soft,\s*#e8eef6\)/);
  assert.match(formCss, /--ifb-focus:\s*var\(--ds-accent,\s*#1a3358\)/);
});

test('legacy hard-coded pink primary palette is removed from feedback UI', () => {
  const combined = adminCss + '\n' + formCss;
  for (const legacy of ['#d81b72', '#e6237e', '#fdebf3', '#a3135a', '#b9135f']) {
    assert.equal(combined.toLowerCase().includes(legacy), false, `legacy feedback accent remains: ${legacy}`);
  }
});

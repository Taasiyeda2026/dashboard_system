import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../frontend/src/proposal-filtered-tab-count-runtime.js', import.meta.url),
  'utf8'
);

test('unfiltered proposal tabs use exact active server counts instead of loaded row count', () => {
  assert.match(source, /from\('proposals_agreements_directory_view'\)/);
  assert.equal((source.match(/select\('id', \{ count: 'exact', head: true \}\)/g) || []).length, 2);
  assert.equal((source.match(/\.is\('archived_at', null\)/g) || []).length, 2);
  assert.match(source, /\.eq\('status', 'sent'\)/);
  assert.match(source, /records:\s*Math\.max\(total - sent, 0\)/);
});

test('exact count path updates both proposal tabs and is independent of pagination', () => {
  assert.match(source, /setTabBadge\(screen, 'records', records/);
  assert.match(source, /setTabBadge\(screen, 'sent', sent/);
  assert.match(source, /!hasActiveProposalListFilters\(panel\) && applyExactProposalTabCounts\(panel\)/);
  assert.doesNotMatch(source, /exactTabCounts[^\n]*\.length/);
  assert.doesNotMatch(source, /range\(/);
});

test('existing client-side filtered count behaviour remains as fallback', () => {
  assert.match(source, /export function hasActiveProposalListFilters/);
  assert.match(source, /const rows = Array\.from\(panel\.querySelectorAll\(ROW_SELECTOR\)\)/);
  assert.match(source, /תוצאות לפי הסינון הפעיל/);
});

test('exact totals are refreshed after proposal-row mutations without querying on badge-only mutations', () => {
  assert.match(source, /function mutationTouchesProposalRows/);
  assert.match(source, /mutations\.some\(mutationTouchesProposalRows\)/);
  assert.match(source, /loadExactProposalTabCounts\(\{ force: true \}\)/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

if (!globalThis.sessionStorage) {
  const values = new Map();
  globalThis.sessionStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}
if (!globalThis.localStorage) globalThis.localStorage = globalThis.sessionStorage;

const { proposalPreviewBodyHtml } = await import('../frontend/src/screens/proposals-agreements.js');
const { sanitizeProposalAgreementPayload } = await import('../frontend/src/api.js');

const item = {
  item_name: 'קורס גפ״ן', item_type: 'קורס', proposal_group: 'next_year_courses',
  gefen_number: '777', quantity: 1, unit_price: 9000, total_price: 9000
};
const base = {
  client_type: 'school', client_authority: 'רשות', school_framework: 'בית ספר',
  school_id: 1, activity_type_group: 'next_year', document_type: 'הצעת מחיר'
};

test('next_year and gefen previews append approval only after explicit opt-in', () => {
  for (const activity_type_group of ['next_year', 'gefen']) {
    const row = { ...base, activity_type_group };
    assert.doesNotMatch(proposalPreviewBodyHtml({ ...row, combine_gefen_approval: false }, [item], []), /pa-gefen-combined-document/);
    assert.match(proposalPreviewBodyHtml({ ...row, combine_gefen_approval: true }, [item], []), /pa-gefen-combined-document/);
  }
  assert.doesNotMatch(proposalPreviewBodyHtml({ ...base, activity_type_group: 'summer', combine_gefen_approval: true }, [item], []), /pa-gefen-combined-document/);
});

test('an opted-in next_year proposal without eligible GEFEN items never renders an empty approval', () => {
  assert.doesNotMatch(proposalPreviewBodyHtml({ ...base, combine_gefen_approval: true }, [], []), /pa-gefen-combined-document/);
});

test('API sanitizer preserves explicit true and false booleans', () => {
  const groupLookup = new Map([['next_year', 'next_year']]);
  assert.equal(sanitizeProposalAgreementPayload({ ...base, combine_gefen_approval: true }, groupLookup).combine_gefen_approval, true);
  assert.equal(sanitizeProposalAgreementPayload({ ...base, combine_gefen_approval: false }, groupLookup).combine_gefen_approval, false);
});

test('migration changes only the default and turns item sync into a false-only safety guard', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260910120000_make_gefen_approval_combination_opt_in.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter column combine_gefen_approval set default false/i);
  assert.match(sql, /activity_type_group[\s\S]*'next_year'[\s\S]*'gefen'[\s\S]*p\.combine_gefen_approval = true[\s\S]*not public\.proposal_has_eligible_gefen_items/i);
  assert.doesNotMatch(sql, /set combine_gefen_approval = public\.proposal_has_eligible_gefen_items/i);
  assert.doesNotMatch(sql, /update[\s\S]*document_(?:html_)?snapshot|delete[\s\S]*proposal_linked_documents/i);
});

test('editor exposes one checkbox and final PDF bookkeeping is gated by the saved opt-in flag', async () => {
  const screen = await readFile(new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8');
  assert.match(screen, /name="combine_gefen_approval"[\s\S]*האישור יצורף כעמוד נוסף ל־PDF הסופי/);
  assert.match(screen, /payload\.combine_gefen_approval = Boolean\(combineInput\?\.checked\)/);
  assert.doesNotMatch(screen, /normalizeProposalGroup\(freshRow\.activity_type_group\) === 'gefen'\s*\|\|\s*freshRow\.combine_gefen_approval/);
});

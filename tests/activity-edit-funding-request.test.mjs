import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  normalizeRequestedFundingSources,
  separateFundingSourceChange,
  displayFundingSourcesForApproval
} from '../frontend/src/activity-edit-funding-request.js';

test('funding-only approval request is preserved instead of lost in activity sanitization', () => {
  const input = { funding_sources: [{ funding_source_id: 1, amount: '9000' }] };
  const { activityChanges, fundingSources } = separateFundingSourceChange(input);
  assert.deepEqual(activityChanges, {});
  assert.deepEqual(fundingSources, [{ funding_source_id: '1', amount: 9000 }]);
  assert.deepEqual(input, { funding_sources: [{ funding_source_id: 1, amount: '9000' }] });
});

test('price and funding are independent changes, preserving numeric amounts', () => {
  const { activityChanges, fundingSources } = separateFundingSourceChange({
    price: '9000', funding_sources: [
      { funding_source_id: '1', amount: '4000.5' },
      { funding_source_id: '2', amount: 4999.5 }
    ]
  });
  assert.deepEqual(activityChanges, { price: '9000' });
  assert.deepEqual(fundingSources, [
    { funding_source_id: '1', amount: 4000.5 },
    { funding_source_id: '2', amount: 4999.5 }
  ]);
  assert.deepEqual(separateFundingSourceChange({ notes: 'עודכן' }), {
    activityChanges: { notes: 'עודכן' }, fundingSources: undefined
  });
});

test('funding request refuses invalid and duplicated links without server writes', () => {
  assert.throws(() => normalizeRequestedFundingSources('broken'), /invalid_activity_funding_request/);
  assert.throws(() => normalizeRequestedFundingSources([{ amount: 50 }]), /invalid_activity_funding_request/);
  assert.throws(() => normalizeRequestedFundingSources([{ funding_source_id: 1, amount: 'oops' }]), /invalid_activity_funding_amount/);
  assert.throws(() => normalizeRequestedFundingSources([{ funding_source_id: 1, amount: -5 }]), /invalid_activity_funding_amount/);
  assert.throws(() => normalizeRequestedFundingSources([
    { funding_source_id: 1, amount: 10 }, { funding_source_id: '1', amount: 20 }
  ]), /duplicate_activity_funding_source/);
});

test('review card displays source names and amounts, including empty selections', () => {
  assert.equal(
    displayFundingSourcesForApproval([{ funding_source_id: '1', amount: 9000 }], { '1': 'גפ״ן' }),
    'גפ״ן: 9,000 ₪'
  );
  assert.equal(displayFundingSourcesForApproval([], {}), 'ללא גורמי מימון');
});

test('submission and approval paths both split structured funding before activity column mapping', async () => {
  const api = await fs.readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  const submit = api.slice(api.indexOf('submitEditRequest: async'), api.indexOf('reviewEditRequest: async'));
  const review = api.slice(api.indexOf('reviewEditRequest: async'), api.indexOf('savePermission: async'));
  assert.match(submit, /separateFundingSourceChange\(syncedChanges\)/);
  assert.match(submit, /requested_values: JSON\.stringify\(requestedValuesForApproval\)/);
  assert.match(submit, /funding_sources: requestFundingSources/);
  assert.match(review, /separateFundingSourceChange\(syncedRequestedValues\)/);
  assert.match(review, /saveActivityFundingSources\(appliedRow, \{ funding_sources: fundingSources \}\)/);
  assert.match(review, /if \(Object\.keys\(sanitizedRequestedValues\)\.length\)/);
});

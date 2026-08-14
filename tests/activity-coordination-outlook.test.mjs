import test from 'node:test';
import assert from 'node:assert/strict';
import { runSequentialGroups, sentMessageEvidence } from '../frontend/src/activity-coordination/outlook.js';

test('bulk queue processes 20 groups serially and reports progress', async () => {
  const groups = Array.from({ length: 20 }, (_, id) => ({ id }));
  let active = 0;
  let maxActive = 0;
  const progress = [];
  const results = await runSequentialGroups(groups, async (group) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return group.id;
  }, ({ current, total }) => progress.push(`${current}/${total}`));
  assert.equal(maxActive, 1);
  assert.equal(results.filter((item) => item.ok).length, 20);
  assert.deepEqual(progress, groups.map((_, index) => `${index + 1}/20`));
});

test('one bulk failure does not stop later groups and retry can target failures only', async () => {
  const groups = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const first = await runSequentialGroups(groups, async (group) => {
    if (group.id === 2) throw new Error('expected');
    return group.id;
  });
  assert.deepEqual(first.map((item) => item.ok), [true, false, true]);
  const retry = await runSequentialGroups(first.filter((item) => !item.ok).map((item) => item.group), async (group) => group.id);
  assert.equal(retry.length, 1);
  assert.equal(retry[0].ok, true);
});

test('sent evidence requires actual send, original recipient, and both PDFs', () => {
  const dispatch = { recipient_email: 'school@example.org', summary_pdf_filename: 'summary.pdf', photography_pdf_filename: 'photo.pdf' };
  const base = { isDraft: false, sentDateTime: '2026-08-14T12:00:00Z', toRecipients: [{ emailAddress: { address: 'school@example.org' } }], attachments: [{ name: 'summary.pdf' }, { name: 'photo.pdf' }] };
  assert.equal(sentMessageEvidence(base, dispatch).valid, true);
  assert.equal(sentMessageEvidence({ ...base, isDraft: true }, dispatch).reason, 'message_not_sent');
  assert.equal(sentMessageEvidence({ ...base, toRecipients: [] }, dispatch).reason, 'original_recipient_removed');
  assert.equal(sentMessageEvidence({ ...base, attachments: [{ name: 'summary.pdf' }] }, dispatch).reason, 'required_attachment_removed');
});

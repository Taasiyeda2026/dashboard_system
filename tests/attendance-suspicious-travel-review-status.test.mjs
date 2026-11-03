import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('pending suspicious cancellation never displays as matched or closed', async () => {
  const source = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');
  assert.match(source, /suspectCancellation \|\| needsDecision/);
  assert.match(source, /ערכים חריגים שהוזנו/);
  assert.match(source, /דיווח חריג – נדרש תיקון/);
  assert.match(source, /ממתין להחלטת מנהל/);
  assert.match(source, /needsDecision \? 'ממתין לבדיקה' : 'תואם\/סגור'/);
  assert.match(source, /suspectCancellation \? 'disabled/);
});

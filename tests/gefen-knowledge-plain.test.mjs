import test from 'node:test';
import assert from 'node:assert/strict';
import { plainKnowledgeText, createKnowledgeItem } from '../frontend/src/gefen-tender/knowledge.js';
test('plainKnowledgeText strips tags and entities', () => {
  assert.equal(plainKnowledgeText('טרם נוסף מידע. <button type="button">הוספה</button>'), 'טרם נוסף מידע. הוספה');
  const item = createKnowledgeItem({ content: '<b>עובדה</b> &amp; עוד' });
  assert.equal(item.content, 'עובדה & עוד');
});

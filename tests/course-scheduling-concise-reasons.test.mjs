import test from 'node:test';
import assert from 'node:assert/strict';

import { conciseSchedulingReason } from '../frontend/src/screens/course-scheduling-reason-labels.js';

test('manual scheduling reasons stay short and operational', () => {
  assert.equal(
    conciseSchedulingReason('מרחק הנסיעה לבית הספר הוא 44 ק״מ ועולה על המגבלה של 40 ק״מ'),
    'מרחק מהבית 44 ק״מ'
  );
  assert.equal(
    conciseSchedulingReason('הזמינות המוגדרת אינה מכסה את שעות 08:00:00–09:45:00 - משפיע על 11 מפגשים'),
    'לא זמין בשעות הקורס'
  );
  assert.equal(
    conciseSchedulingReason('חסרים נתוני התאמה מלאים'),
    'חסרים נתוני התאמה'
  );
  assert.equal(conciseSchedulingReason('ניתן לבחור ידנית'), 'ניתן לבחור ידנית');
});

test('technical suffixes are removed from fallback reasons', () => {
  assert.equal(
    conciseSchedulingReason('סיבה אחרת 08:00:00–09:45:00 - משפיע על 3 מפגשים'),
    'סיבה אחרת 08:00–09:45'
  );
});

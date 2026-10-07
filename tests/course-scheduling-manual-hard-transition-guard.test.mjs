import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  manualCandidateBlocked
} from '../frontend/src/screens/shared/course-scheduling-manual-picker-access.js';

const migration = await readFile(
  new URL('../supabase/migrations/20261007191000_block_hard_manual_scheduling_exceptions.sql', import.meta.url),
  'utf8'
);

test('verified previous/next >20km transitions can be selected for admin review', () => {
  for (const warning of [
    'המרחק אחרי ביומימיקרי בבית ספר שמש גבולות ביום 15.10.2026 גדול מ־20 ק״מ - משפיע על 8 מפגשים',
    'המרחק לפני בינה מלאכותית בבית ספר דוד בן גוריון גדול מ־20 ק״מ'
  ]) {
    assert.equal(
      manualCandidateBlocked({ failures: [warning] }),
      false,
      warning
    );
  }
});

test('a distance exception does not hide overlap, unavailability or insufficient travel time', () => {
  const distance = 'המרחק אחרי ביומימיקרי גדול מ־20 ק״מ';
  for (const blocker of ['קיימת חפיפה', 'הזמינות המוגדרת אינה מכסה את המפגש', 'אין זמן מעבר מספיק', 'לא ניתן לאמת זמן מעבר']) {
    assert.equal(manualCandidateBlocked({ failures: [distance, blocker] }), true, blocker);
  }
  assert.equal(manualCandidateBlocked({ failures: ['מרחק בין הפעילויות גדול מ־20 ק״מ'] }), false);
});

test('manual draft and approval submission both enforce authoritative hard violations', () => {
  assert.match(
    migration,
    /save_course_assignment_manual_draft[\s\S]*scheduling_manual_assignment_hard_violations/
  );
  assert.match(
    migration,
    /submit_course_assignment_manager_approval[\s\S]*scheduling_manual_assignment_hard_violations/
  );
});

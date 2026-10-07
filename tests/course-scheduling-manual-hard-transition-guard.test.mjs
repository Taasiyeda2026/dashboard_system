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

test('contextual previous/next >20km transition warnings stay non-overridable', () => {
  for (const warning of [
    'המרחק אחרי ביומימיקרי בבית ספר שמש גבולות ביום 15.10.2026 גדול מ־20 ק״מ - משפיע על 8 מפגשים',
    'המרחק לפני בינה מלאכותית בבית ספר דוד בן גוריון גדול מ־20 ק״מ'
  ]) {
    assert.equal(
      manualCandidateBlocked({ failures: [warning] }),
      true,
      warning
    );
  }
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

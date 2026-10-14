import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { displayedActivityProgramName } from '../frontend/src/screens/shared/activity-program-display-name.js';

const activitiesScreen = readFileSync(
  new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8'
);

test('secondary biomimicry gets clear display-only name for both canonical and legacy numbers', () => {
  for (const no of ['53828', 53828]) {
    assert.equal(
      displayedActivityProgramName({ activity_no: no, activity_name: 'ביומימיקרי' }, 'ביומימיקרי'),
      'ביומימיקרי (לחטיבה)'
    );
  }
  assert.equal(
    displayedActivityProgramName({ activity_no: '53828', activity_name: 'ביומימיקרי לחטיבה' }, 'ביומימיקרי לחטיבה'),
    'ביומימיקרי (לחטיבה)'
  );
});

test('elementary 6089 and all other activities retain existing display labels', () => {
  const cases = [
    [{ activity_no: '82835', activity_name: 'ביומימיקרי' }, 'ביומימיקרי (מספר ישן 82835 — לבדיקה)'],
    [{ activity_no: '6089', activity_name: 'ביומימיקרי' }, 'ביומימיקרי'],
    [{ activity_no: 6089, activity_name: 'ביומימיקרי' }, 'ביומימיקרי'],
    [{ activity_no: '57651', activity_name: 'טכנולוגיות החלל' }, 'טכנולוגיות החלל'],
    [{ activity_no: 'KIT-BIOMIMICRY-ESCAPE', activity_name: 'ביומימיקרי חדר בריחה' }, 'ביומימיקרי חדר בריחה'],
    [{ activity_no: '3604', activity_name: 'פורצות דרך' }, 'פורצות דרך']
  ];
  for (const [row, label] of cases) {
    assert.equal(displayedActivityProgramName(row, label), label);
  }
});

test('the name conversion is pure and used for activity-list rendering, not edited data', () => {
  const activity = { activity_no: '82835', activity_name: 'ביומימיקרי', activity_type: 'course' };
  const snapshot = structuredClone(activity);
  assert.equal(displayedActivityProgramName(activity, activity.activity_name), 'ביומימיקרי (מספר ישן 82835 — לבדיקה)');
  assert.deepEqual(activity, snapshot, 'saved source row must never be rewritten');
  assert.match(activitiesScreen, /function displayActivityName\(row = \{\}\) \{[\s\S]*?displayedActivityProgramName\(row, storedName\)/);
  assert.match(activitiesScreen, /const rawActivityName = displayActivityName\(row\)/);
  assert.match(activitiesScreen, /class="ds-activities-program-name" title="\$\{activityName\}">\$\{activityName\}<\/strong>/);
});

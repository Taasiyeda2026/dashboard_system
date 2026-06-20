import { test } from 'node:test';
import assert from 'node:assert/strict';

const { endDatesScreen } = await import('../frontend/src/screens/end-dates.js');

const futureEndDate = '2099-12-31';

const rows = [
  {
    activity_name: 'קורס רובוטיקה',
    activity_type: 'course',
    school: 'בית ספר א',
    authority: 'רשות א',
    end_date: futureEndDate,
    status: 'פעיל'
  },
  {
    activity_name: 'חוג מייקרים',
    activity_type: 'אפטרסקול',
    school: 'בית ספר ב',
    authority: 'רשות ב',
    end_date: futureEndDate,
    status: 'פעיל'
  },
  {
    activity_name: 'סדנת מדע',
    activity_type: 'workshop',
    school: 'בית ספר ג',
    authority: 'רשות ג',
    end_date: futureEndDate,
    status: 'פעיל'
  },
  {
    activity_name: 'חדר בריחה',
    activity_type: 'escape_room',
    school: 'בית ספר ד',
    authority: 'רשות ד',
    end_date: futureEndDate,
    status: 'פעיל'
  },
  {
    activity_name: 'סיור חלל',
    activity_type: 'tour',
    school: 'בית ספר ה',
    authority: 'רשות ה',
    end_date: futureEndDate,
    status: 'פעיל'
  }
];

test('end-dates screen shows only courses and after-school programs', () => {
  const html = endDatesScreen.render({ rows }, { state: {} });
  assert.match(html, /קורס רובוטיקה/);
  assert.match(html, /חוג מייקרים/);
  assert.doesNotMatch(html, /סדנת מדע/);
  assert.doesNotMatch(html, /חדר בריחה/);
  assert.doesNotMatch(html, /סיור חלל/);
});

test('end-dates screen accepts Hebrew course type label', () => {
  const html = endDatesScreen.render({
    rows: [{
      activity_name: 'קורס ביומימיקרי',
      activity_type: 'קורסים',
      school: 'בית ספר',
      authority: 'רשות',
      end_date: futureEndDate,
      status: 'פעיל'
    }]
  }, { state: {} });
  assert.match(html, /קורס ביומימיקרי/);
});

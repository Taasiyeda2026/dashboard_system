import { test } from 'node:test';
import assert from 'node:assert/strict';

const { getActivityCatalog, getActivityTypes, getActivityNamesForType, normalizeActivityMeetingsCount } = await import('../frontend/src/screens/shared/activity-options.js');

const settings = {
  dropdown_options: {
    activity_names: [
      { label: 'פעילות א', activity_name: 'פעילות א', activity_no: '100', gefen_number: '100', meetings_count: '11.00', activity_type: 'course', parent_value: '', type: 'course', label_he: 'פעילות א', active: true, sort_order: 2 },
      { label: 'פעילות ב', activity_name: 'פעילות ב', activity_no: '101', activity_type: '', parent_value: 'workshop', type: '', label_he: 'פעילות ב', active: true, sort_order: 1 }
    ]
  }
};

test('activity catalog preserves extended activity_names fields', () => {
  const catalog = getActivityCatalog(settings);
  assert.equal(catalog.length, 2);
  assert.equal(catalog[0].activity_name, 'פעילות א');
  assert.equal(catalog[0].label_he, 'פעילות א');
  assert.equal(catalog[0].type, 'course');
  assert.equal(catalog[0].gefen_number, '100');
  assert.equal(catalog[0].meetings_count, 11);
});

test('meeting count normalization accepts only whole values from 1 to 35', () => {
  assert.equal(normalizeActivityMeetingsCount('8.00'), 8);
  assert.equal(normalizeActivityMeetingsCount(35), 35);
  assert.equal(normalizeActivityMeetingsCount(0), null);
  assert.equal(normalizeActivityMeetingsCount(36), null);
  assert.equal(normalizeActivityMeetingsCount('8.5'), null);
  assert.equal(normalizeActivityMeetingsCount(''), null);
});

test('activity types are derived from activity_names catalog', () => {
  const types = getActivityTypes(settings);
  assert.deepEqual(types, ['course', 'workshop']);
});

test('activity names filter supports activity_type/parent_value/type', () => {
  const byCourse = getActivityNamesForType(settings, 'course');
  const byWorkshop = getActivityNamesForType(settings, 'workshop');
  assert.equal(byCourse.length, 1);
  assert.equal(byCourse[0].label, 'פעילות א');
  assert.equal(byWorkshop.length, 1);
  assert.equal(byWorkshop[0].label, 'פעילות ב');
});

test('one-day activity names are filtered by canonical type aliases', () => {
  const mixedSettings = {
    dropdown_options: {
      activity_names: [
        { label: 'צמידי שמש', parent_value: 'סדנה', activity_no: '201' },
        { label: 'התנסות בתעשייה', activity_type: 'tour', activity_no: '202' },
        { label: 'תמיר - איפה דדי', type: 'חדר בריחה', activity_no: '203' }
      ]
    }
  };

  assert.deepEqual(getActivityNamesForType(mixedSettings, 'workshop').map((row) => row.label), ['צמידי שמש']);
  assert.deepEqual(getActivityNamesForType(mixedSettings, 'סיור').map((row) => row.label), ['התנסות בתעשייה']);
  assert.deepEqual(getActivityNamesForType(mixedSettings, 'escape_room').map((row) => row.label), ['תמיר - איפה דדי']);
});


test('elementary 6089 and secondary 53828 are distinct visible choices; old 82835 cannot be selected anew', () => {
  const biomimicrySettings = { dropdown_options: { activity_names: [
    {label: 'ביומימיקרי', activity_name: 'ביומימיקרי', activity_no: '6089', active: true, activity_type: 'course'},
    {label: 'ביומימיקרי לחטיבה', activity_name: 'ביומימיקרי לחטיבה', activity_no: '53828', active: true, activity_type: 'course'},
    {label: 'ביומימיקרי', activity_name: 'ביומימיקרי', activity_no: '82835', active: true, activity_type: 'course'}
  ]}};
  const entries=getActivityNamesForType(biomimicrySettings,'course');
  assert.deepEqual(entries.map((v)=>v.activity_no),['6089','53828']);
  assert.deepEqual(entries.map((v)=>v.display_label),['ביומימיקרי (יסודי) — 6089','ביומימיקרי (לחטיבה) — 53828']);
  assert.deepEqual(entries.map((v)=>v.label),['ביומימיקרי','ביומימיקרי לחטיבה']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { displayedActivityProgramName } from '../frontend/src/screens/shared/activity-program-display-name.js';
import { getActivityCatalog } from '../frontend/src/screens/shared/activity-options.js';

const load = (path) => readFileSync(new URL(path, import.meta.url),'utf8');
const migration = load('../supabase/migrations/20261015160500_biomimicry_correct_6089_53828_all_modules.sql');
const planner = load('../frontend/src/screens/course-scheduling-planning.js');
const store = load('../frontend/src/screens/course-scheduling-planning-store.js');

test('the activity list distinguishes elementary 6089 and secondary 53828 only', () => {
  assert.equal(displayedActivityProgramName({activity_no:'6089'},'ביומימיקרי'),'ביומימיקרי');
  assert.equal(displayedActivityProgramName({activity_no:'53828'},'ביומימיקרי לחטיבה'),'ביומימיקרי (לחטיבה)');
  assert.equal(displayedActivityProgramName({activity_no:'82835'},'ביומימיקרי'),'ביומימיקרי',
    'ambiguous historical value cannot imply secondary');
});

test('catalog choices distinguish elementary/secondary by identifiers', () => {
  const opts = getActivityCatalog({dropdown_options:{activity_names:[
    {label:'ביומימיקרי (יסודי)',activity_name:'ביומימיקרי',activity_no:'6089',gefen_number:'6089',parent_value:'course',active:true},
    {label:'ביומימיקרי (לחטיבה)',activity_name:'ביומימיקרי לחטיבה',activity_no:'53828',gefen_number:'53828',parent_value:'course',active:true},
    {label:'ביומימיקרי',activity_name:'ביומימיקרי',activity_no:'82835',gefen_number:'82835',parent_value:'course',active:false}
  ]}});
  assert.deepEqual(opts.map(x=>x.activity_no),['6089','53828']);
  assert.deepEqual(opts.map(x=>x.label),['ביומימיקרי (יסודי)','ביומימיקרי (לחטיבה)']);
});

test('database migration classifies each legacy activity from school and grade instead of a blanket alias', () => {
  assert.match(migration,/v_count<>49/);
  assert.match(migration,/v_count<>2/);
  assert.match(migration,/ACT-7b152c38-7975-4658-a0ee-17a050491dcb/);
  assert.match(migration,/school_2027_032/);
  assert.match(migration,/where a.activity_season='school_2027' and a.activity_no='82835'/i);
  assert.match(migration,/where row_id='LONG-165' and activity_season='regular'/i);
  assert.match(migration,/if n<>89 then raise exception 'Expected 89 elementary records/);
  assert.match(migration,/if n<>12 then raise exception 'Expected 12 secondary records/);
  assert.match(migration,/list_id=29 and category='activity_names' and activity_no='53828'/);
  assert.match(migration,/list_id=378 and category='activity_names' and activity_no='82835'/);
  assert.match(migration,/feedback_canonical_program_number\(p_value text\)/);
  assert.match(migration,/disable trigger av2_guard_course_date_assignment[\s\S]*?enable trigger av2_guard_course_date_assignment/);
  assert.match(migration,/feedback_auto_delivery/);
  assert.match(migration,/private\.biomimicry_20261015_correction_audit/);
  assert.match(migration,/activities_school2027_biomimicry_no_82835/);
});

test('planning code cannot infer that 82835 belongs to secondary school', () => {
  assert.doesNotMatch(planner, /'82835': '53828'/);
  assert.doesNotMatch(store, /'82835': '53828'/);
  assert.match(planner,/PLANNING_ACTIVITY_NO_ALIASES = Object\.freeze\(\{\}\)/);
  assert.match(store,/ACTIVITY_NO_ALIASES = Object\.freeze\(\{\}\)/);
});

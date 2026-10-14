import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const controller = readFileSync(new URL('../frontend/src/screens/operations-2027-loading-controller.js', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../supabase/migrations/20261015011000_print_kits_unknown_source_and_audit.sql', import.meta.url), 'utf8');
const replacement = readFileSync(new URL('../supabase/migrations/20261015012000_print_kits_approved_replacement_keep_escape_room.sql', import.meta.url), 'utf8');

test('only 23 approved new kit holdings, grouped by course, replace 39 old holder records', () => {
  const pairs = [...replacement.matchAll(/\('([0-9a-f-]{36})'::uuid, '([^']+)'\)/g)]
    .map(([,courseId, instructor]) => ({courseId, instructor}));
  const counts = new Map();
  for (const pair of pairs) counts.set(pair.courseId, (counts.get(pair.courseId) || 0) + 1);
  assert.equal(pairs.length, 23);
  assert.equal(new Set(pairs.map((pair) => pair.instructor)).size, 11);
  assert.deepEqual(Object.fromEntries([...counts].sort()), Object.fromEntries(Object.entries({
    '909ec13b-dae8-4c19-b2f1-61a4ca25cf9c': 10,
    '760299a3-99c2-4014-902d-e23de4f4c209': 7,
    'de3f31e5-29aa-4ae4-b979-ef364e1e8266': 3,
    '92eeecbe-c32a-4e3f-b2fe-6809803618c2': 3
  }).sort()));
  assert.match(replacement, /if v<>39 then raise exception 'Legacy source differs from expected 39 rows/);
  assert.match(replacement, /active='yes'/);
  assert.match(replacement, /source_location,delivered_at/);
  assert.match(replacement, /'unrecorded',null/);
});

test('escape-room stock is explicitly preserved, counted and visible in the kit screen', () => {
  assert.match(replacement, /ביומימיקרי חדר בריחה/);
  assert.match(replacement, /stock\.warehouse_quantity=0 and stock\.hila_quantity=1/);
  assert.match(replacement, /stock\.idan_quantity=1 and stock\.gil_quantity=2/);
  assert.doesNotMatch(replacement, /update public\.course_print_kit_inventory/i,
    'replacing obsolete holder records may not edit the physical stock quantities');
  assert.match(controller, /function queryPrintKitCourses\(\)/);
  assert.match(controller, /\.eq\('requires_print_kit', true\)/);
  assert.match(controller, /function sharedPrintKitCourses\(\)/);
  assert.match(controller, /function loadPrintKitData\(\)[\s\S]*?sharedPrintKitCourses\(\)/);
  assert.match(controller, /BIOMIMICRY_ESCAPE_ROOM_KIT/);
});

test('new holdings with unrecorded source require a chosen destination on kit return', () => {
  assert.match(schema, /'unrecorded'/);
  assert.match(schema, /alter column delivered_at drop not null/);
  assert.match(schema, /return_course_print_kit_to_location/);
  assert.match(schema, /app_is_admin_or_operation_manager/);
  assert.match(controller, /function openReturnLocationPicker/);
  assert.match(controller, /data-return-location/);
  assert.match(controller, /supabase\.rpc\('return_course_print_kit_to_location'/);
  assert.match(controller, /if \(row\?\.source_location === 'unrecorded'\)/);
  assert.match(controller, /function patchPrintKitReturn\(data, courseId, instructorName, returnLocation = null\)/);
});

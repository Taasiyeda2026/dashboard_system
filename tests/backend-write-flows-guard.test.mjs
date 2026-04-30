import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const actions = fs.readFileSync(new URL('../backend/actions.gs', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../backend/router.gs', import.meta.url), 'utf8');
const snapshot = fs.readFileSync(new URL('../backend/activities-snapshot.gs', import.meta.url), 'utf8');

function mustMatch(source, re, msg) {
  assert.match(source, re, msg);
}

test('addActivity chooses target sheet by source and always generates RowID with LONG/SHORT prefix', () => {
  mustMatch(actions, /var source = text_\(activity\.source \|\| 'short'\)\.toLowerCase\(\);/);
  mustMatch(actions, /var targetSheet = source === 'long' \? CONFIG\.SHEETS\.DATA_LONG : CONFIG\.SHEETS\.DATA_SHORT;/);
  mustMatch(actions, /var rowId = nextId_\(targetSheet, targetSheet === CONFIG\.SHEETS\.DATA_LONG \? 'LONG-' : 'SHORT-'\);/);
});

test('addActivity writes critical columns, Date1-Date35 and start/end dates', () => {
  mustMatch(actions, /appendRow_\(targetSheet, \{[\s\S]*RowID: common\.RowID,[\s\S]*activity_name: common\.activity_name,[\s\S]*start_date: firstStartDate[\s\S]*end_date:[\s\S]*Date1:[\s\S]*Date35:/);
  mustMatch(actions, /function meetingScheduleFromPayload_\([\s\S]*for \(var i = 0; i < count; i\+\+\)[\s\S]*d = shiftDate_\(d, 7\);/);
});

test('saveActivity updates by source_sheet/source_row_id and merges meeting/date patches', () => {
  mustMatch(actions, /var sourceRowId = text_\(payload\.source_row_id \|\| payload\.RowID\);/);
  mustMatch(actions, /var sourceSheet = text_\(payload\.source_sheet \|\| \(sourceRowId\.indexOf\('LONG-'\) === 0 \? CONFIG\.SHEETS\.DATA_LONG : CONFIG\.SHEETS\.DATA_SHORT\)\);/);
  mustMatch(actions, /updateRowByKey_\(sourceSheet, 'RowID', sourceRowId, changes\);/);
  mustMatch(actions, /if \(!sourceRowId\) throw new Error\('source_row_id is required'\);/);
});

test('submitEditRequest writes pending request row with requester identity and timestamp', () => {
  mustMatch(actions, /appendRow_\(CONFIG\.SHEETS\.EDIT_REQUESTS, \{[\s\S]*source_sheet: sourceSheet,[\s\S]*source_row_id: sourceRowId,[\s\S]*requested_by_user_id: text_\(user\.user_id\),[\s\S]*requested_at: new Date\(\)\.toISOString\(\),[\s\S]*status: 'pending'/);
  mustMatch(actions, /if \(!changedFields\.length\) \{[\s\S]*throw new Error\('No changes to submit'\);/);
});

test('reviewEditRequest handles approve/reject, missing requests and already reviewed guard', () => {
  mustMatch(actions, /if \(!requestRows\.length\) throw new Error\('Request not found'\);/);
  mustMatch(actions, /if \(text_\(requestRows\[0\]\.status\) !== 'pending'\) throw new Error\('Request already reviewed'\);/);
  mustMatch(actions, /if \(status === 'approved'\) \{[\s\S]*updateRowByKey_\(sourceSheet, 'RowID', sourceRowId, changes\);/);
  mustMatch(actions, /updateEditRequestRows_\(requestId, \{[\s\S]*status: status,[\s\S]*reviewed_at: new Date\(\)\.toISOString\(\)/);
});

test('router triggers snapshot refresh or cache version bump after write actions', () => {
  mustMatch(router, /if \(action === 'addActivity' \|\|[\s\S]*action === 'saveActivity' \|\|[\s\S]*action === 'reviewEditRequest'/);
  mustMatch(router, /if \(action === 'addActivity' \|\| action === 'saveActivity' \|\| action === 'reviewEditRequest'\) \{[\s\S]*refreshActivitiesSnapshot_\(\);[\s\S]*\} catch \(_activitiesSnapshotErr\) \{[\s\S]*bumpDataViewsCacheVersion_\(\);/);
});

test('activities snapshot refresh persists rows and bumps data-views version', () => {
  mustMatch(snapshot, /function refreshActivitiesSnapshot_\(\) \{/);
  mustMatch(snapshot, /JSON\.stringify\(payload\.rows \|\| \[\]\)/);
  mustMatch(snapshot, /bumpDataViewsCacheVersion_\(\);/);
});


test('activities snapshot normalizes instructor aliases and merges missing instructor fields by RowID fallback', () => {
  mustMatch(snapshot, /normalized\.instructor_name = instructor1;/);
  mustMatch(snapshot, /normalized\.EmployeeID2 = text_\(src\.EmployeeID2 \|\| src\.EmployeeID_2 \|\| src\.employee_id_2 \|\| emp2\);/);
  mustMatch(snapshot, /function mergeInstructorFieldsByRowId_\(snapshotRows, legacyRows\)/);
  mustMatch(snapshot, /var match = legacyMap\[text_\(normalized && normalized\.RowID\)\];/);
  mustMatch(snapshot, /needsFallbackMerge = filtered\.some\(function\(row\) \{/);
  mustMatch(snapshot, /var fallbackData = actionActivitiesLegacy_\(user, payload \|\| \{\}\);/);
});

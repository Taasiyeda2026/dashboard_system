import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isZoomLocationReport } from '../attendance/src/services/attendance-location-policy.js';

const newReport = await readFile(new URL('../attendance/src/screens/new-report-screen.js', import.meta.url), 'utf8');
const myReports = await readFile(new URL('../attendance/src/screens/my-reports-screen.js', import.meta.url), 'utf8');
const service = await readFile(new URL('../attendance/src/services/attendance.service.js', import.meta.url), 'utf8');
const display = await readFile(new URL('../attendance/src/components/report-summary-row.js', import.meta.url), 'utf8');

test('legacy Zoom reports are virtual locations without a required authority or school', () => {
  assert.equal(isZoomLocationReport({ activityType: 'זום' }), true);
  assert.equal(isZoomLocationReport({ activityType: 'מקוון' }), true);
  assert.match(newReport, /!isOpen && !isOnline && reportType !== TRAINING_REPORT_TYPE/);
  assert.match(newReport, /const hasNoLocation = isOpen \|\| isOnline;/);
  assert.match(myReports, /reportType !== 'הכשרה' && !isZoom/);
});

test('online training is Zoom while physical training keeps its original checks', () => {
  assert.equal(isZoomLocationReport({ activityType: 'הכשרה', trainingMode: 'online' }), true);
  assert.equal(isZoomLocationReport({ activityType: 'הכשרה', scheduledOnline: true }), true);
  assert.equal(isZoomLocationReport({ activityType: 'הכשרה', trainingMode: 'physical' }), false);
  assert.match(newReport, /const physicalTraining = training && !isOnlineActivity\(\)/);
  assert.match(myReports, /authField\.wrap\.hidden = isOperations \|\| reportType === 'הכשרה' \|\| isZoom/);
});

test('operational Zoom meeting needs no physical address, including team and other Zoom types', () => {
  assert.equal(isZoomLocationReport({ activityType: 'תפעול', operationMeetingMode: 'online', operationName: 'צוות' }), true);
  assert.equal(isZoomLocationReport({ activityType: 'תפעול', operationName: 'זום' }), true);
  assert.equal(isZoomLocationReport({ activityType: 'תפעול', operationName: 'ישיבת זום' }), true);
  assert.equal(isZoomLocationReport({ activityType: 'תפעול', operationName: 'פגישת זום' }), true);
  assert.match(newReport, /teamModeField\.input\.value === 'physical' && !teamLocationField\.input\.value\.trim\(\)/);
  assert.match(myReports, /teamModeField\.input\.value === 'physical' && !teamLocationField\.input\.value\.trim\(\)/);
});

test('physical operational meetings and actual site work still require location when applicable', () => {
  assert.equal(isZoomLocationReport({ activityType: 'תפעול', operationMeetingMode: 'physical', operationName: 'צוות' }), false);
  assert.equal(isZoomLocationReport({ activityType: 'תפעול', operationName: 'הכנת ציוד לזום' }), false);
  assert.equal(isZoomLocationReport({ activityType: 'קורס' }), false);
  assert.equal(isZoomLocationReport({ activityType: 'סיור' }), false);
});

test('Zoom hides place inputs and zeroes travel instead of omitting the activity or its hours', () => {
  assert.match(newReport, /zoomLocationInfo\.textContent = 'מיקום: זום/);
  assert.match(myReports, /virtualLocationInfo\.textContent = 'מיקום: זום/);
  assert.match(newReport, /const showsLocation = !isOpenFieldType\(\) && !isOnlineActivity\(\)/);
  assert.match(newReport, /getReportType\(\) !== TRAINING_REPORT_TYPE/);
  assert.match(service, /usesPublicTransport = !onlineLocation/);
  assert.match(service, /\(onlineLocation \|\| usesPublicTransport\) \? \{ roundtrip_km: 0 \}/);
  assert.match(myReports, /public_transport:\s+!isZoom && publicTransportToggle\.checked/);
  assert.match(display, /secondary\.push\('זום'\)/);
  assert.match(myReports, /\}\)\) return 'זום';/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const actions = fs.readFileSync(new URL('../backend/actions.gs', import.meta.url), 'utf8');
const dashboardScreen = fs.readFileSync(new URL('../frontend/src/screens/dashboard.js', import.meta.url), 'utf8');

function mustMatch(source, re, msg) {
  assert.match(source, re, msg);
}

test('exceptions model exposes single-source fields and both totals', () => {
  mustMatch(actions, /function computeExceptionsModel_\(rows, ym, opts\)/);
  mustMatch(actions, /totalExceptionInstances:\s*payload\.total_exception_instances \|\| 0/);
  mustMatch(actions, /totalExceptionRows:\s*payload\.total_exception_rows \|\| 0/);
  mustMatch(actions, /counts:\s*payload\.counts \|\| \{\}/);
  mustMatch(actions, /byManager:\s*byManager/);
});

test('exceptions endpoint returns totals and optional debug payload', () => {
  mustMatch(actions, /include_debug:\s*yesNo_\(payload && payload\.debug\) === 'yes'/);
  mustMatch(actions, /totalExceptionInstances:\s*exceptionSummary\.totalExceptionInstances \|\| 0/);
  mustMatch(actions, /totalExceptionRows:\s*exceptionSummary\.totalExceptionRows \|\| 0/);
  mustMatch(actions, /debug:\s*exceptionSummary\.debug \|\| null/);
});

test('dashboard summary does not reconcile exceptions with Math.max fallback', () => {
  assert.doesNotMatch(dashboardScreen, /Math\.max\(exceptionsTotalField\.value/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  getPreviewApproval,
  getPreviewApprovalStatus,
  setPreviewApprovalStatus,
} from '../attendance/src/preview/preview-mode.js';
import { canEditMonth } from '../attendance/src/services/month-gate.service.js';

const appSource = await readFile(new URL('../attendance/src/app.js', import.meta.url), 'utf8');

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;
const monthKey = `${year}-${String(month).padStart(2, '0')}`;

test('admin preview exposes all attendance approval workflow statuses', () => {
  for (const label of [
    'פתוח לדיווח',
    'הוגש / בבקרת מנהל',
    'אושר על ידי המנהל',
    'הוחזר לתיקון',
    'אושר סופית לשכר',
  ]) {
    assert.match(appSource, new RegExp(label));
  }
  assert.match(appSource, /setPreviewApprovalStatus/);
  assert.match(appSource, /getPreviewApprovalStatus/);
});

test('preview status simulator models employee, manager, reopen and final payroll stages', () => {
  setPreviewApprovalStatus(monthKey, 'open');
  assert.equal(getPreviewApprovalStatus(monthKey), 'open');
  assert.equal(getPreviewApproval(monthKey), null);

  const submitted = setPreviewApprovalStatus(monthKey, 'submitted', { employeeName: 'עובד בדיקה' });
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.submitted_by_name, 'עובד בדיקה');
  assert.ok(submitted.submitted_at);
  assert.equal(canEditMonth(year, month, submitted), false);

  const locked = setPreviewApprovalStatus(monthKey, 'locked');
  assert.equal(locked.status, 'locked');
  assert.equal(locked.manager_approved_by_name, 'מנהל/ת לדוגמה');
  assert.ok(locked.manager_approved_at);
  assert.ok(locked.manager_pdf_sharepoint_url);
  assert.equal(canEditMonth(year, month, locked), false);

  const reopened = setPreviewApprovalStatus(monthKey, 'reopened');
  assert.equal(reopened.status, 'reopened');
  assert.ok(reopened.reopened_at);
  assert.equal(canEditMonth(year, month, reopened), true);

  const approved = setPreviewApprovalStatus(monthKey, 'approved_for_payroll', { adminName: 'אדמין בדיקה' });
  assert.equal(approved.status, 'approved_for_payroll');
  assert.equal(approved.payroll_approved_by_name, 'אדמין בדיקה');
  assert.ok(approved.payroll_approved_at);
  assert.equal(canEditMonth(year, month, approved), false);

  setPreviewApprovalStatus(monthKey, 'open');
});

test('attendance edit window distinguishes normal grace and reopened correction days', () => {
  const current = [2026, 9];
  const previous = [2026, 8];
  const older = [2026, 7];
  const at = (day) => new Date(2026, 8, day, 12, 0, 0);

  assert.equal(canEditMonth(...current, null, at(15)), true, 'current month');
  assert.equal(canEditMonth(...previous, null, at(2)), true, 'normal previous-month grace through day 2');
  assert.equal(canEditMonth(...previous, null, at(3)), false, 'normal previous month blocked after day 2');
  assert.equal(canEditMonth(...previous, { status: 'reopened' }, at(3)), true, 'reopened on day 3');
  assert.equal(canEditMonth(...previous, { status: 'reopened' }, at(7)), true, 'reopened through day 7');
  assert.equal(canEditMonth(...previous, { status: 'reopened' }, at(8)), false, 'reopened blocked on day 8');
  assert.equal(canEditMonth(...older, { status: 'reopened' }, at(2)), false, 'older month blocked');
  assert.equal(canEditMonth(...current, { status: 'submitted' }, at(15)), false, 'submitted blocked');
  assert.equal(canEditMonth(...current, { status: 'locked' }, at(15)), false, 'locked blocked');
  assert.equal(canEditMonth(...current, { status: 'approved_for_payroll' }, at(15)), false, 'payroll-approved blocked');
});

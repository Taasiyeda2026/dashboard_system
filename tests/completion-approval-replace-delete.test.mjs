import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { completionApprovalStatusInfo } from '../frontend/src/screens/shared/completion-approval-status.js';

const apiSource = readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const instructorSource = readFileSync(new URL('../frontend/src/screens/instructor-completion-approvals.js', import.meta.url), 'utf8');
const opsSource = readFileSync(new URL('../frontend/src/screens/operations-management.js', import.meta.url), 'utf8');


test('completion approval status ignores signed URL storage failures when a file reference exists', () => {
  assert.deepEqual(completionApprovalStatusInfo(null), { key: 'missing', label: 'טרם הועלה' });
  assert.deepEqual(
    completionApprovalStatusInfo({ status: 'approved', file_path: 'signed/path.pdf', storage_exists: false, storage_status: 'signed_url_failed' }),
    { key: 'approved', label: 'אושר' }
  );
  assert.deepEqual(
    completionApprovalStatusInfo({ status: 'uploaded', file_path: 'signed/path.pdf', storage_exists: false, storage_status: 'signed_url_failed' }),
    { key: 'uploaded', label: 'הועלה לבדיקה' }
  );
  assert.deepEqual(
    completionApprovalStatusInfo({ status: 'uploaded', file_name: 'approval.pdf', storage_exists: false, storage_status: 'missing' }),
    { key: 'uploaded', label: 'הועלה לבדיקה' }
  );
});

test('completion approval uploads expose storage existence and ignore missing storage in activity checks', () => {
  assert.match(apiSource, /storage_exists/);
  assert.match(apiSource, /storage_status/);
  assert.match(apiSource, /completionApprovalStorageExists\(upload\)/);
  assert.match(apiSource, /completionApprovalStorageExists\(upload\) && approvalUploadMatchesActivity/);
});

test('completion approval replacement creates a new storage path, updates row fields, resets review fields, then removes old object', () => {
  assert.match(apiSource, /replaceCompletionApprovalUpload: async/);
  assert.match(apiSource, /completionApprovalUploadPath\(\{ approval, file, instructorEmpId: existing\.data\?\.instructor_emp_id \}\)/);
  assert.match(apiSource, /upsert: false/);
  assert.match(apiSource, /status: 'uploaded'/);
  assert.match(apiSource, /reviewed_by: null/);
  assert.match(apiSource, /reviewed_at: null/);
  assert.match(apiSource, /review_note: null/);
  assert.ok(apiSource.indexOf("update(patch)") < apiSource.indexOf("remove([oldPath])"));
  assert.match(apiSource, /console\.warn\('\[completion-approval-replace\] failed to delete old file'/);
});

test('completion approval deletion removes storage and upload row', () => {
  assert.match(apiSource, /deleteCompletionApprovalUpload: async/);
  assert.ok(apiSource.indexOf("remove([filePath])") < apiSource.indexOf("delete().eq('id', uploadId)"));
});

test('instructor UI shows view, replace and delete for completion approval file references', () => {
  assert.match(instructorSource, /data-view-file-path/);
  assert.match(instructorSource, /החלף/);
  assert.match(instructorSource, /data-delete-upload-id/);
  assert.match(instructorSource, /replaceCompletionApprovalUpload/);
  assert.match(instructorSource, /deleteCompletionApprovalUpload/);
});

test('operations UI allows managers to replace or delete instructor uploads', () => {
  assert.match(opsSource, /data-ops-upload-delete/);
  assert.match(opsSource, /replaceCompletionApprovalUpload/);
  assert.match(opsSource, /deleteCompletionApprovalUpload/);
  assert.match(opsSource, /האם למחוק את הקובץ\? לאחר המחיקה יהיה ניתן להעלות קובץ חדש\./);
});

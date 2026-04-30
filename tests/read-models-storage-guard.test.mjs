import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readModels = fs.readFileSync(new URL('../backend/read-models.gs', import.meta.url), 'utf8');

function mustMatch(source, re, msg) {
  assert.match(source, re, msg);
}

test('read models sheet is metadata-only; payload lives in Drive', () => {
  mustMatch(readModels, /var READ_MODEL_HEADERS_ = \[[\s\S]*'storage_ref'[\s\S]*\];/);
  mustMatch(readModels, /'storage_type',[\s\S]*'storage_ref'/);
  mustMatch(readModels, /readModelsWritePayloadDrive_/);
  mustMatch(readModels, /readModelsLoadPayloadFromDrive_/);
  var hdr = readModels.match(/var READ_MODEL_HEADERS_ = (\[[\s\S]*?\]);/);
  assert.ok(hdr, 'READ_MODEL_HEADERS_ block');
  assert.doesNotMatch(hdr[1], /payload_json|rows_json/, 'no inline JSON columns in header list');
});

test('markReadModelStatus_ patches row cells without rewriting storage payload', () => {
  mustMatch(readModels, /function markReadModelStatus_\([\s\S]*patchReadModelRowCells_\(rowNum, \{ status: st, updated_at: nowIso, last_error: err \}\)/);
});

test('persistReadModelPayload_ writes Drive file and upserts metadata row only', () => {
  mustMatch(readModels, /function persistReadModelPayload_[\s\S]*readModelsWritePayloadDrive_/);
  mustMatch(readModels, /storage_type: READ_MODEL_STORAGE_DRIVE_/);
});

test('actionReadModelGet_ loads from Drive when storage_ref is set', () => {
  mustMatch(readModels, /readModelsLoadPayloadFromDrive_/);
  mustMatch(readModels, /function actionReadModelGet_/);
});

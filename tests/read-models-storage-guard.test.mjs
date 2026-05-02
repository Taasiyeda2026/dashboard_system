import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readModels = fs.readFileSync(new URL('../backend/read-models.gs', import.meta.url), 'utf8');
const sheetSchema = fs.readFileSync(new URL('../backend/sheet-schema.gs', import.meta.url), 'utf8');

function mustMatch(source, re, msg) {
  assert.match(source, re, msg);
}

test('read models sheet is metadata-only; payload lives in Drive', () => {
  mustMatch(readModels, /function readModelHeaders_\(\)/);
  mustMatch(readModels, /getSystemSheetSpec_\('read_models'\)/);
  mustMatch(readModels, /readModelsWritePayloadDrive_/);
  mustMatch(readModels, /readModelsLoadPayloadFromDrive_/);
  const rmSpec = sheetSchema.match(/read_models:\s*\{[\s\S]*?\n  \},/);
  assert.ok(rmSpec, 'read_models sheet spec');
  assert.match(rmSpec[0], /'storage_ref'/);
  assert.doesNotMatch(rmSpec[0], /payload_json|rows_json/, 'no inline JSON columns in sheet-schema read_models headers');
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

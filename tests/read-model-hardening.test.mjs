import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const apiSource = fs.readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const readModelsSource = fs.readFileSync(new URL('../backend/read-models.gs', import.meta.url), 'utf8');
const routerSource = fs.readFileSync(new URL('../backend/router.gs', import.meta.url), 'utf8');

test('frontend read-model allow list includes end-dates and endDates uses requestReadModel', () => {
  assert.match(apiSource, /READ_MODEL_ENABLED_KEY_LIST\s*=\s*\[[^\]]*'end-dates'[^\]]*\]/);
  assert.match(apiSource, /endDates:\s*\(options\)\s*=>\s*requestReadModel\('end-dates',\s*\{\},\s*'endDates',\s*\{\},\s*options \|\| \{\}\)/);
});

test('requestReadModel fallback metadata includes reason and explicit fallback flags', () => {
  assert.match(apiSource, /legacy_fallback_reason:\s*'read_model_get_failed'/);
  assert.match(apiSource, /legacy_fallback_reason:\s*'read_model_refresh_failed'/);
  assert.match(apiSource, /fallback_used:\s*true/);
  assert.match(apiSource, /used_read_model:\s*false/);
  assert.match(apiSource, /read_model_screen_key:\s*key/);
});

test('read-model refresh batch includes adjacent week and month models', () => {
  assert.match(readModelsSource, /refreshWeekReadModelForOffset_\(-1\)/);
  assert.match(readModelsSource, /refreshWeekReadModelForOffset_\(0\)/);
  assert.match(readModelsSource, /refreshWeekReadModelForOffset_\(1\)/);
  assert.match(readModelsSource, /refreshMonthReadModelForYm_\(shiftYm_\(curYm, -1\)\)/);
  assert.match(readModelsSource, /refreshMonthReadModelForYm_\(curYm\)/);
  assert.match(readModelsSource, /refreshMonthReadModelForYm_\(shiftYm_\(curYm, 1\)\)/);
});

test('materializeScreenDataFromReadModel supports adjacent week/month and keeps outer fallback', () => {
  assert.match(readModelsSource, /if \(wo < -1 \|\| wo > 1\)/);
  assert.match(readModelsSource, /buildReadModelStorageKey_\('week', \{ week_offset: wo \}\)/);
  assert.match(readModelsSource, /if \(ym !== curYm && ym !== prevYm && ym !== nextYm\)/);
  assert.match(readModelsSource, /month_outside_supported_period/);
});

test('normal writes do not call refreshAllReadModels directly', () => {
  assert.doesNotMatch(routerSource, /refreshAllReadModels_\(/);
});

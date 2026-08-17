import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeOnboardingPhone,
  isValidOnboardingPhone
} from '../frontend/src/screens/instructor-onboarding.js';

test('onboarding phone normalization keeps only phone characters used by the backend', () => {
  assert.equal(normalizeOnboardingPhone('050-123 4567'), '0501234567');
  assert.equal(normalizeOnboardingPhone('+972 (50) 123-4567'), '+972501234567');
  assert.equal(normalizeOnboardingPhone('בדיקה'), '');
});

test('onboarding blocks text and accepts realistic local or international phone numbers', () => {
  assert.equal(isValidOnboardingPhone('בדיקה'), false);
  assert.equal(isValidOnboardingPhone('123'), false);
  assert.equal(isValidOnboardingPhone('050-123 4567'), true);
  assert.equal(isValidOnboardingPhone('+972 50 123 4567'), true);
});

test('onboarding UI and RPC wrapper both enforce phone validation before Supabase', async () => {
  const source = await readFile(new URL('../frontend/src/screens/instructor-onboarding.js', import.meta.url), 'utf8');
  assert.match(source, /if \(!isValidOnboardingPhone\(instructor\?\.phone\)\)/);
  assert.match(source, /const phoneValid = isValidOnboardingPhone\(phone\.value\)/);
  assert.match(source, /prepare\.disabled = [\s\S]*!phoneValid/);
  assert.match(source, /if \(!isValidOnboardingPhone\(phone\.value\)\)/);
});

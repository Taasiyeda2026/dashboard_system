import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authPasswordCandidatesForLogin,
  encodeNewEntryCodeForAuth,
  isValidNewEntryCode
} from '../frontend/src/entry-code-policy.js';

test('new entry codes accept 4 to 6 digits including leading zeros', () => {
  assert.equal(isValidNewEntryCode('0123'), true);
  assert.equal(isValidNewEntryCode('01234'), true);
  assert.equal(isValidNewEntryCode('012345'), true);
  assert.equal(isValidNewEntryCode('123'), false);
  assert.equal(isValidNewEntryCode('1234567'), false);
  assert.equal(isValidNewEntryCode('12ab'), false);
  assert.equal(isValidNewEntryCode('Abcdef1!'), false);
});

test('short numeric codes are encoded to satisfy Auth minimum length', () => {
  assert.equal(encodeNewEntryCodeForAuth('0123'), 'c:0123');
  assert.equal(encodeNewEntryCodeForAuth('01234'), 'c:01234');
  assert.equal(encodeNewEntryCodeForAuth('012345'), '012345');
  assert.throws(() => encodeNewEntryCodeForAuth('123'), /invalid_new_entry_code/);
});

test('login candidates preserve existing secrets and add encoded short-code fallback', () => {
  assert.deepEqual(authPasswordCandidatesForLogin('Noshi88!'), ['Noshi88!']);
  assert.deepEqual(authPasswordCandidatesForLogin('1234567'), ['1234567']);
  assert.deepEqual(authPasswordCandidatesForLogin('012345'), ['012345']);
  assert.deepEqual(authPasswordCandidatesForLogin('0123'), ['0123', 'c:0123']);
  assert.deepEqual(authPasswordCandidatesForLogin('01234'), ['01234', 'c:01234']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  mergeFetchedContactsWithInserted,
  persistNewClientContact,
} from '../frontend/src/client-contact-persistence.js';

const validContact = {
  client_type: 'school',
  client_name: 'בית ספר לדוגמה',
  authority_id: 12,
  school_id: 34,
  semel_mosad: '123456',
  authority: 'רשות לדוגמה',
  school: 'בית ספר לדוגמה',
  contact_name: 'ישראל ישראלי',
  contact_role: 'מנהל',
  mobile: '0501234567',
  phone: '',
  email: 'israel@example.com',
};

const screenSource = await readFile(new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8');

test('new client contact persists once with the returned database identity and associations', async () => {
  const inserts = [];
  const api = {
    addContact: async (payload) => {
      inserts.push(payload);
      return { ok: true, row: { ...payload.row, id: 987, created_at: '2026-08-11T00:00:00Z' } };
    },
  };

  const saved = await persistNewClientContact(api, {
    ...validContact,
    id: 'temporary',
    source_id: 'temporary',
    source_table: 'contacts_unified_view',
  });

  assert.equal(inserts.length, 1);
  assert.equal('id' in inserts[0].row, false);
  assert.equal('source_id' in inserts[0].row, false);
  assert.equal('source_table' in inserts[0].row, false);
  assert.equal(saved.id, 987);
  assert.equal(saved.source_id, 987);
  assert.equal(saved.source_table, 'contacts_schools');
  for (const key of ['client_type', 'client_name', 'authority_id', 'school_id', 'semel_mosad', 'authority', 'school']) {
    assert.equal(saved[key], validContact[key]);
  }
});

test('contact refresh keeps a just-inserted row and then uses the real unified-view row', () => {
  const inserted = { ...validContact, id: 987, source_id: 987, source_table: 'contacts_schools' };
  const staleRefresh = mergeFetchedContactsWithInserted([{ id: 1, contact_name: 'קיים' }], [inserted]);
  assert.equal(staleRefresh.some((row) => row.id === 987), true);

  const unifiedRow = { ...inserted, id: 987, source_id: 987, source_table: 'contacts_schools', active: 'פעיל' };
  const freshRefresh = mergeFetchedContactsWithInserted([unifiedRow], [inserted]);
  assert.equal(freshRefresh.filter((row) => row.id === 987).length, 1);
  assert.equal(freshRefresh.find((row) => row.id === 987).active, 'פעיל');
});

test('missing database identity rejects contact creation', async () => {
  await assert.rejects(
    persistNewClientContact({ addContact: async () => ({ ok: true, row: {} }) }, validContact),
    /client_contact_insert_verification_failed/,
  );
});

test('client-file submit keeps invalid form data, focuses mobile, and prevents duplicate inserts', () => {
  assert.match(screenSource, /if \(contactForm\.dataset\.paContactSaving === 'yes'\) return/);
  assert.match(screenSource, /if \(!contactFields\.mobile\)[\s\S]*יש להזין מספר נייד[\s\S]*querySelector\('\[name="mobile"\]'\)\?\.focus/);
  assert.match(screenSource, /יש להזין מספר נייד ישראלי תקין/);
  assert.match(screenSource, /contactForm\.dataset\.paContactSaving = 'yes'/);
  assert.match(screenSource, /data\.contactOptions = contactOptions;[\s\S]*renderClientWorkspace\(\)/);
});

test('existing-contact update path remains routed through the existing APIs', () => {
  assert.match(screenSource, /await api\.saveContact\(\{ kind: 'school', row: updateRow, _supabase_orig: original \}\)/);
  assert.match(screenSource, /api\.updateUnifiedContactRecord/);
});

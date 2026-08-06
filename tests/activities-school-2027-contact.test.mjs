import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSchool2027Contact, withResolvedSchool2027Contact } from '../frontend/src/screens/shared/school-2027-contact.js';

test('school_2027 contact resolver uses saved school_contact_id', () => {
  const resolved = resolveSchool2027Contact(
    { activity_season: 'school_2027', school_id: '10', school_contact_id: '2', contact_name: '', contact_phone: '' },
    [
      { id: '1', school_id: '10', contact_name: 'לא נבחר', mobile: '050-1111111', phone: '03-1111111', active: 'פעיל' },
      { id: '2', school_id: '10', contact_name: 'נבחר מפורש', mobile: '050-2222222', phone: '03-2222222', email: 'chosen@example.com', active: 'פעיל' }
    ]
  );
  assert.equal(resolved.name, 'נבחר מפורש');
  assert.equal(resolved.phone, '050-2222222');
  assert.equal(resolved.email, 'chosen@example.com');
  assert.equal(resolved.source, 'school_contact_id');
});

test('school_2027 contact resolver uses only active single contact when school_contact_id is missing', () => {
  const resolved = resolveSchool2027Contact(
    { activity_season: 'school_2027', school_id: '20', school_contact_id: '', contact_name: '', contact_phone: '' },
    [{ id: '3', school_id: '20', contact_name: 'יחיד פעיל', phone: '03-3333333', active: 'פעיל' }]
  );
  assert.equal(resolved.name, 'יחיד פעיל');
  assert.equal(resolved.phone, '03-3333333');
  assert.equal(resolved.source, 'single_school_id');
});

test('school_2027 contact resolver does not auto-pick among multiple contacts without school_contact_id', () => {
  const resolved = resolveSchool2027Contact(
    { activity_season: 'school_2027', school_id: '30', school_contact_id: '', contact_name: '', contact_phone: '' },
    [
      { id: '4', school_id: '30', contact_name: 'ראשון', mobile: '050-4444444', active: 'פעיל' },
      { id: '5', school_id: '30', contact_name: 'שני', mobile: '050-5555555', active: 'פעיל' }
    ]
  );
  assert.equal(resolved.name, '');
  assert.equal(resolved.phone, '');
  assert.equal(resolved.source, 'activity');
});

test('school_2027 contact resolver prefers mobile over phone and exact authority plus school fallback', () => {
  const resolved = resolveSchool2027Contact(
    { activity_season: 'school_2027', school_id: '', authority: 'רשות א', school: 'בית ספר א', school_contact_id: '', contact_phone: '03-activity' },
    [{ id: '6', authority: 'רשות א', school: 'בית ספר א', contact_name: 'התאמה מדויקת', mobile: '050-mobile', phone: '03-phone', active: 'פעיל' }]
  );
  assert.equal(resolved.name, 'התאמה מדויקת');
  assert.equal(resolved.phone, '050-mobile');
  assert.equal(resolved.source, 'single_authority_school');
});

test('school_2027 contact resolver does not affect regular or summer_2026 activities', () => {
  for (const season of ['regular', 'summer_2026']) {
    const activity = { activity_season: season, school_id: '40', contact_name: '', contact_phone: '' };
    const resolved = withResolvedSchool2027Contact(activity, [{ id: '7', school_id: '40', contact_name: 'לא אמור להופיע', mobile: '050-7777777', active: 'פעיל' }]);
    assert.equal(resolved.resolved_contact_name, undefined);
    assert.equal(resolved.contact_name, '');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';

const {
  sanitizeContactSchoolSource,
  hydrateContactSourceFromPicker
} = await import('../frontend/src/proposal-editor-compact-fixes.js');

function fakeForm(fields = {}, optionPayload = null) {
  const inputs = new Map(Object.entries(fields).map(([name, value]) => [name, { value }]));
  const option = optionPayload
    ? { dataset: { paContactOption: encodeURIComponent(JSON.stringify(optionPayload)) } }
    : null;

  return {
    inputs,
    querySelector(selector) {
      if (selector === '[data-pa-contact-select] option:checked[data-pa-contact-option]') return option;
      const match = selector.match(/^input\[name="([^"]+)"\]$/);
      return match ? (inputs.get(match[1]) || null) : null;
    }
  };
}

test('proposal contact FK source is cleared for a school catalogue row', () => {
  const form = fakeForm({
    contact_source_id: '404',
    contact_source_table: 'schools',
    contact_source_authority_id: '10',
    contact_source_school_id: '20'
  });

  assert.equal(sanitizeContactSchoolSource(form), true);
  assert.equal(form.inputs.get('contact_source_id').value, '');
  assert.equal(form.inputs.get('contact_source_authority_id').value, '10');
  assert.equal(form.inputs.get('contact_source_school_id').value, '20');
});

test('proposal contact FK source is preserved for contacts_schools', () => {
  const form = fakeForm({
    contact_source_id: '9001',
    contact_source_table: 'contacts_schools'
  });

  assert.equal(sanitizeContactSchoolSource(form), false);
  assert.equal(form.inputs.get('contact_source_id').value, '9001');
});

test('legacy saved contact id without an explicit source table is preserved', () => {
  const form = fakeForm({
    contact_source_id: '9001',
    contact_source_table: ''
  });

  assert.equal(sanitizeContactSchoolSource(form), false);
  assert.equal(form.inputs.get('contact_source_id').value, '9001');
});

test('picker hydration never promotes an explicit schools id into contact_school_id', () => {
  const form = fakeForm({
    contact_source_id: '',
    contact_source_table: '',
    contact_source_authority_id: '',
    contact_source_school_id: '',
    contact_source_semel_mosad: '',
    contact_source_authority: '',
    contact_source_school: '',
    contact_source_name: '',
    contact_source_role: '',
    contact_source_mobile: '',
    contact_source_email: ''
  }, {
    id: '404',
    source_table: 'schools',
    authority_id: '10',
    school_id: '20',
    semel_mosad: '123456',
    authority: 'רשות בדיקה',
    school: 'בית ספר בדיקה'
  });

  hydrateContactSourceFromPicker(form);

  assert.equal(form.inputs.get('contact_source_id').value, '');
  assert.equal(form.inputs.get('contact_source_table').value, 'schools');
  assert.equal(form.inputs.get('contact_source_authority_id').value, '10');
  assert.equal(form.inputs.get('contact_source_school_id').value, '20');
});

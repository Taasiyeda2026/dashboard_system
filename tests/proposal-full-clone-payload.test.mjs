import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEditableProposalClonePayload,
  cloneProposalItems
} from '../frontend/src/proposal-full-clone-payload.js';

test('full proposal clone keeps all editable business fields and resets workflow fields', () => {
  const source = {
    id: '11111111-1111-1111-1111-111111111111',
    client_type: 'school',
    authority_id: 12,
    school_id: 34,
    semel_mosad: '555555',
    contact_school_id: 56,
    client_authority: 'עיריית בדיקה',
    school_framework: 'בית ספר בדיקה',
    document_type: 'הצעת מחיר',
    activity_type_group: 'gefen',
    proposal_domain: 'Y',
    proposal_date: '2026-07-29',
    valid_until: '2026-08-29',
    activity_names: ['ביומימיקרי', 'יישומי הבינה המלאכותית'],
    contact_name: 'ישראל ישראלי',
    contact_role: 'מנהל בית הספר',
    phone: '050-0000000',
    email: 'school@example.com',
    notes: 'הערה מלאה',
    total_amount: 18600,
    custom_document_sections: [{ section_key: 'terms', section_body: 'נוסח מותאם' }],
    include_catalog: true,
    combine_gefen_approval: true,
    quote_number: '10165',
    status: 'approved',
    approval_note: 'מאושר',
    signature_meta: { image: 'signature.png' },
    approved_by: '8000',
    approved_at: '2026-07-29T10:00:00Z',
    locked_at: '2026-07-29T10:01:00Z',
    final_pdf_path: 'proposal-final-pdfs/10165.pdf'
  };

  const clone = buildEditableProposalClonePayload(source, {
    supersedes_proposal_id: source.id,
    client_authority: source.client_authority
  });

  assert.equal(clone.status, 'draft');
  assert.equal(clone.approval_note, '');
  assert.equal(Object.hasOwn(clone, 'supersedes_proposal_id'), false);
  assert.equal(clone.client_type, 'school');
  assert.equal(clone.school_id, 34);
  assert.equal(clone.semel_mosad, '555555');
  assert.equal(clone.proposal_domain, 'Y');
  assert.equal(clone.total_amount, 18600);
  assert.equal(clone.include_catalog, true);
  assert.equal(clone.combine_gefen_approval, true);
  assert.deepEqual(clone.activity_names, source.activity_names);
  assert.deepEqual(clone.custom_document_sections, source.custom_document_sections);

  assert.notStrictEqual(clone.activity_names, source.activity_names);
  assert.notStrictEqual(clone.custom_document_sections, source.custom_document_sections);
  assert.notStrictEqual(clone.custom_document_sections[0], source.custom_document_sections[0]);

  for (const systemField of [
    'quote_number', 'signature_meta', 'approved_by', 'approved_at',
    'locked_at', 'final_pdf_path', 'created_at', 'updated_at',
    'proposal_series_id', 'version_number', 'archived_at'
  ]) {
    assert.equal(Object.hasOwn(clone, systemField), false, `${systemField} must not be cloned`);
  }
});

test('repeated duplication does not reuse source version lineage', () => {
  const source = {
    id: '11111111-1111-1111-1111-111111111111',
    client_authority: 'אשדוד',
    school_framework: "מקיף ה' כללי",
    activity_type_group: 'next_year',
    proposal_series_id: '11111111-1111-1111-1111-111111111111',
    version_number: 2,
    archived_at: '2026-07-29T11:50:27Z'
  };

  const firstClone = buildEditableProposalClonePayload(source, { supersedes_proposal_id: source.id });
  const secondClone = buildEditableProposalClonePayload(source, { supersedes_proposal_id: source.id });

  for (const clone of [firstClone, secondClone]) {
    assert.equal(clone.status, 'draft');
    assert.equal(Object.hasOwn(clone, 'supersedes_proposal_id'), false);
    assert.equal(Object.hasOwn(clone, 'proposal_series_id'), false);
    assert.equal(Object.hasOwn(clone, 'version_number'), false);
    assert.equal(Object.hasOwn(clone, 'archived_at'), false);
  }
});

test('internal next-year item groups are normalized on the proposal record', () => {
  for (const internalGroup of ['next_year_courses', 'next_year_workshops']) {
    const clone = buildEditableProposalClonePayload({
      id: '11111111-1111-1111-1111-111111111111',
      activity_type_group: internalGroup
    }, { supersedes_proposal_id: '11111111-1111-1111-1111-111111111111' });
    assert.equal(clone.activity_type_group, 'next_year');
  }
});

test('proposal item cloning keeps content and removes record-specific identifiers', () => {
  const sourceItems = [{
    id: 'item-1',
    proposal_agreement_id: 'source-proposal',
    proposalAgreementId: 'source-proposal',
    item_name: 'ביומימיקרי',
    quantity: 2,
    unit_price: 9000,
    selected_bundle_items: [{ pricing_key: 'bundle-a' }],
    created_at: '2026-07-29T10:00:00Z',
    updated_at: '2026-07-29T10:00:00Z'
  }];

  const items = cloneProposalItems(sourceItems);

  assert.equal(items.length, 1);
  assert.equal(items[0].item_name, 'ביומימיקרי');
  assert.equal(items[0].quantity, 2);
  assert.equal(Object.hasOwn(items[0], 'id'), false);
  assert.equal(Object.hasOwn(items[0], 'proposal_agreement_id'), false);
  assert.equal(Object.hasOwn(items[0], 'proposalAgreementId'), false);
  assert.equal(Object.hasOwn(items[0], 'created_at'), false);
  assert.equal(Object.hasOwn(items[0], 'updated_at'), false);
  assert.notStrictEqual(items[0].selected_bundle_items, sourceItems[0].selected_bundle_items);
  assert.notStrictEqual(items[0].selected_bundle_items[0], sourceItems[0].selected_bundle_items[0]);
});

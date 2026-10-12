import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { proposalProgramDisplay, PROPOSAL_PROGRAM_DISPLAY_VERSION } from '../frontend/src/proposal-program-display.js';

globalThis.sessionStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const s = await import('../frontend/src/screens/proposals-agreements.js');
const { normalizeProposalPricingTables, normalizeProposalPricingHtml, installProposalNextYearPricingDisplay } = await import('../frontend/src/proposal-next-year-pricing-display.js');
const { normalizeProposalWorkflowDocument } = await import('../frontend/src/proposal-workflow-completion.js');

const { alias, programs, configureGroups: initializeGroups, row, sections } = await import('./fixtures/proposal-program-display.mjs');
const configureGroups = () => initializeGroups(s);
const parse = (html) => new JSDOM(html).window.document;
configureGroups();

test('pure display rule requires exact original identity and explicit document/course context', () => {
  const frozen = Object.freeze({ ...programs[0] });
  assert.deepEqual(proposalProgramDisplay(frozen, { enabled: true, isCourse: true }), { name: alias, gefenNumber: '52279' });
  for (const item of [
    { ...frozen, gefen_number: '52279_old' }, { ...frozen, gefen_number: '3604_old' },
    { ...frozen, gefen_number: '' }, { ...frozen, source_pricing_key: 'manual' },
    { ...frozen, activity_no: '52279' }, { ...frozen, is_manual_course: true }, programs[1]
  ]) assert.deepEqual(proposalProgramDisplay(item, { enabled: true, isCourse: true }), { name: item.item_name, gefenNumber: item.gefen_number });
  assert.equal(proposalProgramDisplay(frozen).name, frozen.item_name);
  assert.equal(proposalProgramDisplay(frozen, { enabled: true, isCourse: false }).name, frozen.item_name);
  assert.equal(proposalProgramDisplay({ ...programs[1], item_name: 'אופק יזמות פרימיום בתעשייה' }, {
    enabled: true, isCourse: true
  }).name, 'אופק יזמות פרימיום בתעשייה');
});

for (const group of ['gefen', 'next_year', 'combined']) {
  for (const indices of [[0], [1], [0, 1]]) {
    test(`${group}: customer table keeps ${indices.join('+')} identities, prices and repeated normalization`, () => {
      configureGroups();
      const items = indices.map(i => ({ ...programs[i], proposal_group: group === 'gefen' ? 'gefen' : 'next_year' }));
      const before = structuredClone(items);
      const document = parse(s.proposalPreviewBodyHtml(row(group), items, sections(group), { showSignatureImage: true }));
      assert.match(document.body.textContent, indices.includes(0) ? /אופק פרימיום \(פורצות דרך\)/ : /אופק פרימיום/);
      normalizeProposalWorkflowDocument(document);
      const table = document.querySelector('.pa-gefen-course-table, .pa-next-year-course-table, .pa-cost-table');
      assert.ok(table, 'real group metadata must produce a course table, including combined');
      const rows = [...table.querySelectorAll('tbody tr')];
      assert.equal(rows.length, items.length);
      for (let i = 0; i < rows.length; i++) {
        assert.equal(rows[i].querySelector('.pa-course-name')?.textContent || rows[i].cells[0].textContent, indices[i] === 0 ? alias : 'אופק פרימיום');
        const visibleGefen = rows[i].querySelector('[data-program-gefen]')?.textContent
          || (group === 'combined' ? '' : rows[i].cells[1].textContent);
        assert.equal(visibleGefen, group === 'combined' && indices[i] === 1 ? '' : '52279');
        assert.equal(rows[i].dataset.sourceGefenNumber, indices[i] === 0 ? '3604' : undefined);
        assert.equal(rows[i].hasAttribute('data-program-gefen-inline'), group === 'combined' && indices[i] === 0);
        assert.match(rows[i].cells[group === 'combined' ? 3 : 6].textContent, indices[i] === 0 ? /12,000/ : /13,500/);
      }
      const html = document.body.innerHTML;
      normalizeProposalPricingTables(document); normalizeProposalPricingTables(document);
      assert.equal(document.body.innerHTML, html, 'normalization is idempotent');
      assert.deepEqual(items, before);
    });
  }
}

test('independent Premium and unrelated courses retain existing names and table layout in combined quotes', () => {
  configureGroups();
  const fullPremium = { ...programs[1], item_name: 'אופק יזמות פרימיום בתעשייה' };
  const unrelated = { ...programs[0], id: 'unrelated', item_name: 'ביומימיקרי', gefen_number: '6089', activity_no: '6089', source_pricing_key: '6089' };
  const input = [fullPremium, unrelated];
  const before = structuredClone(input);
  const document = parse(s.proposalPreviewBodyHtml(row('combined'), input, sections('combined')));
  normalizeProposalWorkflowDocument(document);
  const rows = [...document.querySelectorAll('.pa-cost-table tbody tr')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cells[0].textContent, fullPremium.item_name);
  assert.equal(rows[1].cells[0].textContent, unrelated.item_name);
  assert.equal(document.querySelectorAll('.pa-cost-table [data-program-gefen-inline]').length, 0);
  assert.equal(document.querySelectorAll('.pa-cost-table [data-source-gefen-number]').length, 0);
  assert.doesNotMatch(document.querySelector('.pa-cost-table').textContent, /מס׳ גפ״ן:/);
  assert.deepEqual(input, before);
});

test('combined quotes add the inline GEFEN display only to source 3604', () => {
  configureGroups();
  const document = parse(s.proposalPreviewBodyHtml(row('combined'), programs, sections('combined')));
  normalizeProposalWorkflowDocument(document);
  const rows = [...document.querySelectorAll('.pa-cost-table tbody tr')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cells[0].querySelector('.pa-course-name')?.textContent, alias);
  assert.equal(rows[0].cells[0].querySelector('[data-program-gefen]')?.textContent, '52279');
  assert.equal(rows[0].dataset.sourceGefenNumber, '3604');
  assert.equal(rows[1].cells[0].textContent, programs[1].item_name);
  assert.equal(rows[1].dataset.sourceGefenNumber, undefined);
  assert.equal(rows[1].querySelector('[data-program-gefen]'), null);
});

test('generated lists/placeholders map long source names without changing free text', () => {
  configureGroups();
  const document = parse(s.proposalPreviewBodyHtml(row('next_year'), programs, [
    ...sections('next_year'), { template_key: 'next_year', section_key: 'notes', section_title: 'הערות', section_body: 'טקסט חופשי: פורצות דרך 3604' }
  ]));
  assert.match(document.querySelector('.pa-section').textContent, /אופק פרימיום \(פורצות דרך\)/);
  assert.match(document.body.textContent, /טקסט חופשי: פורצות דרך 3604/);
});

test('more than two programs, manual courses, workshops and discounts retain source values', () => {
  configureGroups();
  const other = { ...programs[0], id: 'other', item_name: 'ביומימיקרי', gefen_number: '6089', activity_no: '6089', source_pricing_key: '6089' };
  const manual = { ...programs[0], id: 'manual', item_name: 'תוכנית ידנית', gefen_number: '', activity_no: '', source_pricing_key: 'manual' };
  const discount = { item_name: 'הנחה', quantity: 1, unit_price: -500, total_price: -500 };
  const items = [...programs, other, manual, discount];
  const before = structuredClone(items);
  const document = parse(s.proposalPreviewBodyHtml(row('next_year'), items, sections('next_year')));
  normalizeProposalPricingTables(document);
  assert.equal(document.querySelectorAll('.pa-next-year-course-table tbody tr').length, 4);
  assert.match(document.body.textContent, /ביומימיקרי/);
  assert.match(document.body.textContent, /תוכנית ידנית/);
  assert.match(document.body.textContent, /49,000/); // 12000 + 13500 + 12000 + 12000 - 500
  assert.deepEqual(items, before);
  const workshop = { ...programs[0], item_type: 'סדנה', proposal_group: 'next_year_workshops' };
  assert.doesNotMatch(s.proposalPreviewBodyHtml(row('next_year'), [workshop], []), /אופק פרימיום \(פורצות דרך\)/);
});

test('approval and proposal+approval documents preserve both rows and use original pricing lookup', () => {
  configureGroups();
  assert.equal(s.gefenEligibleItems(programs).length, 2);
  const current = programs.map(i => ({ ...i }));
  const priced = s.nextYearGefenApprovalItems(row('next_year'), programs, current);
  assert.deepEqual(priced.map(i => i.total_price), [12000, 13500]);
  assert.deepEqual(priced.map(i => i.gefen_number), ['3604', '52279']);
  for (const html of [s.gefenApprovalDocumentHtml(row('next_year'), priced), s.proposalPreviewBodyHtml(row('gefen', { combine_gefen_approval: true }), programs, sections('gefen'))]) {
    const document = parse(html); normalizeProposalWorkflowDocument(document);
    const rows = document.querySelectorAll('.pa-gefen-approval-table tbody tr');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].cells[1].textContent, alias);
    assert.equal(rows[1].cells[1].textContent, 'אופק פרימיום');
    assert.equal(rows[0].cells[2].textContent, '52279');
  }
});

test('snapshots preserve original business data and catalog annexes stay distinct', () => {
  configureGroups();
  const before = structuredClone(programs);
  const snapshot = s.buildProposalDocumentSnapshot(row('gefen'), programs, []);
  assert.equal(snapshot.presentation_version, PROPOSAL_PROGRAM_DISPLAY_VERSION);
  assert.deepEqual(snapshot.items.map(i => i.gefen_number), ['3604', '52279']);
  assert.deepEqual(snapshot.items.map(i => i.item_name), programs.map(i => i.item_name));
  assert.deepEqual(snapshot.items.map(i => i.total_price), [12000, 13500]);
  const entries = s.buildProposalCatalogPdfEntries(row('gefen'), programs);
  assert.ok(entries.some(i => i.path?.endsWith('/3604.pdf')));
  assert.ok(entries.some(i => i.path?.endsWith('/52279.pdf')));
  assert.deepEqual(programs, before);
});

test('form extraction and save payload retain original names, numbers, keys and activity links', () => {
  configureGroups();
  const dom = new JSDOM(`<form data-pa-form>${programs.map(i => `<tr></tr><div data-pa-item-row>${Object.entries(i).map(([k,v]) => `<input name="${k === 'source_pricing_key' ? 'item_source_pricing_key' : k}" value="${String(v).replaceAll('"','&quot;')}">`).join('')}</div>`).join('')}</form>`);
  const form = dom.window.document.querySelector('form');
  const extracted = s.extractItemsFromForm(form);
  assert.deepEqual(extracted.map(i => i.gefen_number), ['3604', '52279']);
  assert.deepEqual(extracted.map(i => i.item_name), programs.map(i => i.item_name));
  assert.deepEqual(extracted.map(i => i.source_pricing_key), ['3604', '52279']);
  assert.deepEqual(extracted.map(i => i.list_id), ['11', '12']);
  s.proposalPreviewBodyHtml(row('gefen'), extracted, []);
  assert.equal(s.proposalPreviewBodyHtml(row('gefen'), extracted, []), s.proposalPreviewBodyHtml(row('gefen'), s.extractItemsFromForm(form), []), 'reopening/re-rendering original form data keeps the same customer document');
  assert.equal(form.querySelector('[name="gefen_number"]').value, '3604');
  assert.doesNotMatch(JSON.stringify(extracted), /אופק פרימיום \(פורצות דרך\)/);
});

test('agreements, sent legacy documents, existing PDFs and old snapshots never receive the alias', () => {
  configureGroups();
  for (const overrides of [{ document_type: 'הסכם' }, { status: 'sent' }, { locked_at: '2026-10-01T00:00:00Z' }, { status: 'approved', final_pdf_path: 'existing.pdf' }]) {
    const html = s.proposalPreviewBodyHtml(row('gefen', overrides), programs, sections('gefen'));
    const document = parse(html); normalizeProposalWorkflowDocument(document);
    assert.doesNotMatch(document.body.textContent, /אופק פרימיום \(פורצות דרך\)/);
  }
  const old = s.buildProposalDocumentSnapshot(row('gefen'), programs, []);
  delete old.presentation_version;
  const html = s.proposalPreviewHtmlFromSnapshot(old);
  const document = parse(html); normalizeProposalWorkflowDocument(document);
  assert.doesNotMatch(document.body.textContent, /אופק פרימיום \(פורצות דרך\)/);
  const stored = '<div class="proposal-document">פורצות דרך 3604 — HTML היסטורי</div>';
  assert.equal(s.proposalLockedPreviewHtml({ document_html_snapshot: stored }), stored);
  const modern = s.buildProposalDocumentSnapshot(row('gefen'), programs, []);
  assert.match(s.proposalPreviewHtmlFromSnapshot(modern), /אופק פרימיום \(פורצות דרך\)/);
});

test('upload/lock adapters normalize new HTML without mutating snapshot business values', async () => {
  configureGroups();
  const document = parse('');
  const calls = [];
  const fake = { uploadProposalFinalPdf: async (...args) => calls.push(args), lockAndSendProposalAgreement: async (...args) => calls.push(args) };
  installProposalNextYearPricingDisplay(fake, { document });
  const payload = { documentSnapshot: s.buildProposalDocumentSnapshot(row('gefen'), programs, []), documentHtmlSnapshot: s.proposalPreviewBodyHtml(row('gefen'), programs, []) };
  const before = structuredClone(payload);
  await fake.uploadProposalFinalPdf('test', payload); await fake.lockAndSendProposalAgreement('test', payload);
  for (const [,sent] of calls) {
    assert.match(sent.documentHtmlSnapshot, /אופק פרימיום \(פורצות דרך\)/);
    assert.deepEqual(sent.documentSnapshot.items.map(i => i.gefen_number), ['3604', '52279']);
    assert.equal(normalizeProposalPricingHtml(sent.documentHtmlSnapshot, document), sent.documentHtmlSnapshot);
  }
  assert.deepEqual(payload, before);
});

test('historical JSON snapshot HTML stays byte-identical through the entire workflow normalizer', () => {
  configureGroups();
  const snapshot = s.buildProposalDocumentSnapshot(row('next_year'), programs, sections('next_year'));
  delete snapshot.presentation_version;
  const document = parse(s.proposalPreviewHtmlFromSnapshot(snapshot));
  const before = document.body.innerHTML;
  normalizeProposalWorkflowDocument(document);
  assert.equal(document.body.innerHTML, before);
});

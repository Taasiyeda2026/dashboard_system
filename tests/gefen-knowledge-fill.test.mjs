import test from 'node:test';
import assert from 'node:assert/strict';
import {
  proposeProgramDetailFills, applyDetailProposals,
  countSyllabusMeetings, uniformSessionDuration, catalogRefForExport
} from '../frontend/src/gefen-tender/knowledge-fill.js';
import { rowsForForm } from '../frontend/src/gefen-tender/excel-templates.js';

test('propose fills empty fields from knowledge without inventing research yes', () => {
  const proposals = proposeProgramDetailFills({
    details: { name: 'ביומימיקרי' },
    grades: 'ד׳–ו׳',
    knowledge_items: [
      { id: 'k1', type: 'מטרה', content: 'לפתח חשיבה יצירתית דרך הטבע', source: 'קטלוג' },
      { id: 'k2', type: 'תוכן', content: 'תקציר תוכנית על השראה מהטבע', source: 'קטלוג' },
      { id: 'k3', type: 'מיומנות', content: 'חשיבה יצירתית ואוריינות מדעית', source: 'סילבוס' },
      { id: 'k4', type: 'קהל יעד', content: 'תלמידים ביסודי', source: 'קטלוג' }
    ],
    syllabus_sessions: [{ meeting_from: 1, meeting_to: 11, topic: 'x', duration_minutes: 90 }]
  });
  const byField = Object.fromEntries(proposals.map((p) => [p.field, p]));
  assert.equal(byField.goal.value.includes('חשיבה'), true);
  assert.equal(byField.summary.value.includes('תקציר'), true);
  assert.equal(byField.audience.value, 'תלמידים');
  assert.ok(byField.skills.value.includes('חשיבה יצירתית'));
  assert.equal(byField.research, undefined);
});

test('research כן only with explicit evidence; apply does not wipe others', () => {
  const yes = proposeProgramDetailFills({
    details: {},
    knowledge_items: [{
      id: 'r1', type: 'מקור', title: 'מחקר',
      content: 'מצורף מסמך מחקר אקדמי מהאוניברסיטה', source: 'תיק מסמכים'
    }]
  });
  assert.equal(yes.find((p) => p.field === 'research')?.value, 'כן');

  const applied = applyDetailProposals({ name: 'נשמר', summary: 'קיים' }, [
    { field: 'goal', value: 'חדש' },
    { field: 'summary', value: 'דריסה' }
  ], ['goal']);
  assert.equal(applied.name, 'נשמר');
  assert.equal(applied.goal, 'חדש');
  assert.equal(applied.summary, 'קיים');
});

test('syllabus meeting count respects ranges; catalog export never invents', () => {
  assert.equal(countSyllabusMeetings([
    { meeting_from: 1, meeting_to: 1 },
    { meeting_from: 8, meeting_to: 9 },
    { meeting_from: 10, meeting_to: 12 }
  ]), 12);
  assert.equal(uniformSessionDuration([{ duration_minutes: 90 }, { duration_minutes: 90 }]), 90);
  assert.equal(uniformSessionDuration([{ duration_minutes: 90 }, { duration_minutes: 60 }]), 0);
  assert.equal(catalogRefForExport({ source: 'קטלוג', source_page: 3 }), '');
  assert.equal(catalogRefForExport({ catalog_item_number: '12', catalog_item_url: 'https://x' }), '12 | https://x');
});

test('form 174 rows use seven official columns without source-page catalog noise', () => {
  const rows = rowsForForm(174, {
    payload: {
      grades: 'ד׳–ו׳',
      syllabus_sessions: [{
        meeting_label: '1',
        age_stage: 'יסודי',
        topic: 'פתיחה',
        content: 'תיאור',
        methods: 'קבוצות',
        skills_values: 'יצירתיות',
        source: 'קטלוג פנימי',
        source_page: 4
      }]
    }
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].audience.includes('יסודי'), true);
  assert.equal(rows[0].topics, 'פתיחה');
  assert.equal(rows[0].catalog_ref, '');
});

test('forms 159/160 expand person experience records', () => {
  const people = [{
    id: 'o-1',
    title: 'ישראל ישראלי',
    payload: {
      cv_attached: true,
      person_experience_records: [{
        domain: 'יזמות',
        detail: 'פיתוח תוכנית',
        contact_name: 'רותם',
        phone: '050',
        relation: 'מנהל'
      }],
      person_recommenders: []
    }
  }];
  const rows = rowsForForm(159, { payload: { developer_ids: ['o-1'] } }, people);
  assert.equal(rows[0].name, 'ישראל ישראלי');
  assert.equal(rows[0].domain, 'יזמות');
  assert.equal(rows[0].cv, 'כן');
  assert.equal(rows[0].relation, 'מנהל');
});

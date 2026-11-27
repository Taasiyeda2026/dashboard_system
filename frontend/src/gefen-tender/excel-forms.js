import { EXCEL_FORMS, SHAREPOINT_BASE } from './constants.js';
import { answerText, isFinalAnswer } from './final-answers.js';
import { buildSubmissionAnswers } from './questionnaires.js';

function sheetName(label, index) {
  return `${String(label).replace(/[\\/?*\[\]:]/g, ' ').slice(0, 25)} ${index + 1}`;
}

function peopleRows(program, peopleRows, idsKey, textKey) {
  const ids = program.payload?.[idsKey] || [];
  const fromIds = (peopleRows || []).filter((r) => ids.includes(r.id));
  if (fromIds.length) {
    return fromIds.map((r) => {
      const p = r.payload || {};
      return {
        name: r.title,
        domain: p.experience_domain || p.roles || '',
        detail: p.experience || p.teaching_experience || p.development_experience || '',
        contact_name: p.recommender_name || '',
        phone: '', // never export personal phone into public artifacts from UI without explicit field
        relation: p.recommender_relation || '',
        cv: p.cv_url || '',
        verified: p.verification_status || p.eligibility || ''
      };
    });
  }
  const text = answerText(program.payload?.[textKey]);
  if (!text.trim()) return [];
  return text.split(/\n+/).map((line) => ({
    name: line.trim(),
    domain: '',
    detail: '',
    contact_name: '',
    phone: '',
    relation: '',
    cv: '',
    verified: 'טיוטה מטקסט חופשי'
  })).filter((r) => r.name);
}

function syllabusRows(program) {
  const sessions = program.payload?.syllabus_sessions;
  if (Array.isArray(sessions) && sessions.length) {
    return sessions.map((item, i) => ({
      meeting: item.meeting_label || item.meeting_number || item.meeting || (i + 1),
      audience: item.age_stage || item.audience || '',
      topics: item.topic || item.topics || '',
      content: item.content || '',
      methods: item.methods || '',
      skills: item.skills_values || item.skills || '',
      catalog_ref: item.source
        ? `${item.source}${item.source_page ? ` | עמוד ${item.source_page}` : ''}${item.catalog_only ? ' · קטלוגי (לא 174 מאושר)' : ''}`
        : (item.catalog_ref || '')
    }));
  }
  const structured = program.payload?.syllabus_items;
  if (Array.isArray(structured) && structured.length) {
    return structured.map((item, i) => ({
      meeting: item.meeting ?? i + 1,
      audience: item.audience || '',
      topics: item.topics || '',
      content: item.content || '',
      methods: item.methods || '',
      skills: item.skills || '',
      catalog_ref: item.catalog_ref || ''
    }));
  }
  const text = answerText(program.payload?.syllabus);
  if (!text.trim()) return [];
  return text.split(/\n+/).filter(Boolean).map((line, i) => ({
    meeting: i + 1,
    audience: '',
    topics: line.trim(),
    content: '',
    methods: '',
    skills: '',
    catalog_ref: ''
  }));
}

function stemRows(program) {
  const groups = program.payload?.stem_criteria;
  if (Array.isArray(groups) && groups.length) {
    return groups.flatMap((g) => (g.criteria || []).map((c) => ({
      group: g.group || '',
      group_min: g.minimum ?? '',
      criterion: c.label || c.id || '',
      students: c.students || '',
      educators: c.educators || '',
      verified: c.verified === true ? 'אומת' : 'לא אומת'
    })));
  }
  // Do not invent the 18 official criteria labels — export an empty scaffold note.
  return [{
    group: 'טרם מופה',
    group_min: '',
    criterion: '18 קריטריונים בחמש קבוצות — יש לייבא ממסמך STEM הרשמי / STEM_TECHUMIM_151',
    students: '',
    educators: '',
    verified: 'מיפוי לא אומת'
  }];
}

export function officialTemplateLink(form) {
  return `${SHAREPOINT_BASE}/${('02 - תבניות וטפסים/' + form.file).split('/').map(encodeURIComponent).join('/')}`;
}

export async function exportApprovedAnswersWorkbook(XLSX, program) {
  const answers = buildSubmissionAnswers(program);
  const wb = XLSX.utils.book_new();
  const groups = [...new Set(answers.map((a) => a.group))];
  groups.forEach((g, gi) => {
    const entries = answers.filter((a) => a.group === g);
    const ws = XLSX.utils.aoa_to_sheet([
      ['שאלה', 'מזהה', 'תשובה', 'תווים', 'מצב', 'מיפוי'],
      ...entries.map((a) => [
        a.label,
        a.question_id || a.key,
        isFinalAnswer(program.payload?.final_answers, a.key, a.value) ? a.value : '',
        isFinalAnswer(program.payload?.final_answers, a.key, a.value) ? a.value.length : '',
        isFinalAnswer(program.payload?.final_answers, a.key, a.value) ? 'מאושרת' : 'להשלמה',
        a.mapping_verified === true ? 'אומת' : 'לא אומת'
      ])
    ]);
    ws['!cols'] = [{ wch: 55 }, { wch: 24 }, { wch: 85 }, { wch: 10 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, sheetName(g, gi));
  });
  wb.Workbook = { Views: [{ RTL: true }] };
  return wb;
}

/**
 * Build field-aligned workbooks matching official form columns.
 * These are data packages for filling the SharePoint templates — not a substitute
 * for the official binary templates (formulas/merges/validation live only there).
 */
export async function exportOfficialFormPackage(XLSX, program, allRows, { approvedOnly = false } = {}) {
  const wb = XLSX.utils.book_new();
  const people = allRows.filter((r) => r.kind === 'operator');
  const stamp = approvedOnly ? 'מאושר_להגשה' : 'טיוטה';

  const meta = XLSX.utils.aoa_to_sheet([
    ['שדה', 'ערך'],
    ['תוכנית', program.title],
    ['מספר', program.payload?.number ?? ''],
    ['record_id', program.id],
    ['revision', program.revision],
    ['מצב החבילה', stamp],
    ['הערה', 'יש להעתיק את הנתונים לטפסי המקור ב־SharePoint. קובץ זה אינו מחליף את התבנית הרשמית.']
  ]);
  XLSX.utils.book_append_sheet(wb, meta, 'מטא');

  const dev = peopleRows(program, people, 'developer_ids', 'developers');
  const ws159 = XLSX.utils.aoa_to_sheet([
    ['שם המפתח', 'תחום ניסיון', 'פירוט הניסיון', 'שם איש קשר', 'טלפון', 'מהות הקשר', 'קישור קורות חיים', 'סטטוס אימות'],
    ...dev.map((r) => [r.name, r.domain, r.detail, r.contact_name, r.phone, r.relation, r.cv, r.verified])
  ]);
  XLSX.utils.book_append_sheet(wb, ws159, '159 מפתחים');

  const ops = peopleRows(program, people, 'operator_ids', 'operators');
  const ws160 = XLSX.utils.aoa_to_sheet([
    ['שם המפעיל', 'תחום ניסיון', 'פירוט ניסיון', 'שם ממליץ', 'טלפון', 'מהות הקשר', 'קישור קורות חיים', 'סטטוס אימות'],
    ...ops.map((r) => [r.name, r.domain, r.detail, r.contact_name, r.phone, r.relation, r.cv, r.verified])
  ]);
  XLSX.utils.book_append_sheet(wb, ws160, '160 מפעילים');

  const syl = syllabusRows(program);
  const ws174 = XLSX.utils.aoa_to_sheet([
    ['מפגש', 'קהל יעד ושכבת גיל', 'נושאי המפגש', 'פירוט התכנים', 'דרכי הפעלה', 'מיומנויות וערכים', 'קישור/מספר בקטלוג'],
    ...syl.map((r) => [r.meeting, r.audience, r.topics, r.content, r.methods, r.skills, r.catalog_ref])
  ]);
  XLSX.utils.book_append_sheet(wb, ws174, '174 תוכנית למידה');

  if ((program.payload?.associations || []).some((a) => Number(a.code) === 706)) {
    const stem = stemRows(program);
    const ws151 = XLSX.utils.aoa_to_sheet([
      ['קבוצה', 'מכסת מינימום בקבוצה', 'קריטריון', 'מענה לתלמידים', 'מענה לצוותי חינוך', 'אימות'],
      ...stem.map((r) => [r.group, r.group_min, r.criterion, r.students, r.educators, r.verified])
    ]);
    XLSX.utils.book_append_sheet(wb, ws151, '151 STEM');
  }

  if (approvedOnly) {
    const answers = buildSubmissionAnswers(program)
      .filter((a) => isFinalAnswer(program.payload?.final_answers, a.key, a.value));
    const ws = XLSX.utils.aoa_to_sheet([
      ['שאלה', 'תשובה מאושרת'],
      ...answers.map((a) => [a.label, a.value])
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'תשובות מאושרות');
  }

  wb.Workbook = { Views: [{ RTL: true }] };
  return { wb, stamp, forms: EXCEL_FORMS };
}

export function downloadWorkbook(XLSX, wb, filename) {
  XLSX.writeFile(wb, filename);
}

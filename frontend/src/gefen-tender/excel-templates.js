import { EXCEL_FORMS } from './constants.js';

/** Default empty cell maps — user completes after uploading official templates. */
export const DEFAULT_TEMPLATE_MAPS = {
  159: {
    sheet: 'גיליון1',
    columns: {
      name: 'A',
      domain: 'B',
      detail: 'C',
      contact_name: 'D',
      phone: 'E',
      relation: 'F',
      cv: 'G'
    },
    start_row: 2,
    notes: 'יש לאמת מול NISAYON_MEFATCHIM_159 לאחר העלאת תבנית המקור'
  },
  160: {
    sheet: 'גיליון1',
    columns: {
      name: 'A',
      domain: 'B',
      detail: 'C',
      contact_name: 'D',
      phone: 'E',
      relation: 'F',
      cv: 'G'
    },
    start_row: 2,
    notes: 'יש לאמת מול NISAYON_MAFIILIM_160 לאחר העלאת תבנית המקור'
  },
  174: {
    sheet: 'גיליון1',
    columns: {
      meeting: 'A',
      audience: 'B',
      topics: 'C',
      content: 'D',
      methods: 'E',
      skills: 'F',
      catalog_ref: 'G'
    },
    start_row: 2,
    notes: 'יש לאמת מול TOCHNIT_LEMIDA_174 לאחר העלאת תבנית המקור'
  }
};

export function templateMeta(code, payload = {}) {
  const form = EXCEL_FORMS.find((f) => f.code === Number(code));
  return {
    code: Number(code),
    title: form?.title || String(code),
    file: form?.file || '',
    sharepoint_url: payload.sharepoint_url || '',
    storage_path: payload.storage_path || '',
    mapping: payload.mapping || DEFAULT_TEMPLATE_MAPS[Number(code)] || { sheet: '', columns: {}, start_row: 2 },
    uploaded_at: payload.uploaded_at || null,
    mapping_verified: payload.mapping_verified === true
  };
}

function setCell(ws, addr, value) {
  const v = value == null ? '' : value;
  ws[addr] = { t: typeof v === 'number' ? 'n' : 's', v };
}

/**
 * Fill an uploaded official workbook in-memory using a cell map.
 * Does not invent structure — copies the uploaded template and writes mapped cells only.
 */
export function fillTemplateWorkbook(XLSX, templateArrayBuffer, mapping, rows) {
  const wb = XLSX.read(templateArrayBuffer, { type: 'array', cellStyles: true });
  const sheetName = mapping.sheet && wb.SheetNames.includes(mapping.sheet)
    ? mapping.sheet
    : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error('גיליון לא נמצא בתבנית');
  const start = Number(mapping.start_row || 2);
  const cols = mapping.columns || {};
  rows.forEach((row, i) => {
    const r = start + i;
    Object.entries(cols).forEach(([key, col]) => {
      if (!col) return;
      setCell(ws, `${col}${r}`, row[key] ?? '');
    });
  });
  // refresh range
  if (!ws['!ref']) ws['!ref'] = 'A1';
  return wb;
}

export function rowsForForm(code, program, peopleRows = []) {
  const p = program.payload || {};
  if (Number(code) === 159) {
    const ids = p.developer_ids || [];
    const fromIds = peopleRows.filter((r) => ids.includes(r.id));
    if (fromIds.length) {
      return fromIds.map((r) => ({
        name: r.title,
        domain: r.payload?.experience_domain || r.payload?.roles || '',
        detail: r.payload?.development_experience || r.payload?.experience || '',
        contact_name: r.payload?.recommender_name || '',
        phone: '',
        relation: r.payload?.recommender_relation || '',
        cv: r.payload?.cv_url || ''
      }));
    }
    return String(p.developers || '').split(/\n+/).filter(Boolean).map((name) => ({
      name: name.trim(), domain: '', detail: '', contact_name: '', phone: '', relation: '', cv: ''
    }));
  }
  if (Number(code) === 160) {
    const ids = p.operator_ids || [];
    const fromIds = peopleRows.filter((r) => ids.includes(r.id));
    if (fromIds.length) {
      return fromIds.map((r) => ({
        name: r.title,
        domain: r.payload?.experience_domain || r.payload?.roles || '',
        detail: r.payload?.teaching_experience || r.payload?.experience || '',
        contact_name: r.payload?.recommender_name || '',
        phone: '',
        relation: r.payload?.recommender_relation || '',
        cv: r.payload?.cv_url || ''
      }));
    }
    return String(p.operators || '').split(/\n+/).filter(Boolean).map((name) => ({
      name: name.trim(), domain: '', detail: '', contact_name: '', phone: '', relation: '', cv: ''
    }));
  }
  if (Number(code) === 174) {
    if (Array.isArray(p.syllabus_sessions) && p.syllabus_sessions.length) {
      return p.syllabus_sessions.map((item, i) => ({
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
    if (Array.isArray(p.syllabus_items) && p.syllabus_items.length) {
      return p.syllabus_items.map((item, i) => ({
        meeting: item.meeting ?? i + 1,
        audience: item.audience || '',
        topics: item.topics || '',
        content: item.content || '',
        methods: item.methods || '',
        skills: item.skills || '',
        catalog_ref: item.catalog_ref || ''
      }));
    }
    return String(p.syllabus || '').split(/\n+/).filter(Boolean).map((line, i) => ({
      meeting: i + 1,
      audience: '',
      topics: line.trim(),
      content: '',
      methods: '',
      skills: '',
      catalog_ref: ''
    }));
  }
  return [];
}

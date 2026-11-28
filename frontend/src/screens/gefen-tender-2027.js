import './../styles/gefen-tender-2027.css';
import { supabase, waitForSupabaseAuthSession } from '../supabase-client.js';
import { state } from '../state.js';
import {
  ADMIN_SECTIONS, ADMIN_STATUSES, BASKETS, EXCEL_FORMS, GOOGLE_DRIVE_PROGRAMS,
  KNOWLEDGE_TYPES, PROGRAM_DETAIL_FIELDS, RECOMMENDATION_FOLDER_BY_PROGRAM,
  SHAREPOINT_BASE, SHAREPOINT_FOLDERS, TABLE, VERIFICATION_STATUSES,
  recommendationsFolderUrl
} from '../gefen-tender/constants.js';
import { buildContextPacket, relevantKnowledge } from '../gefen-tender/context-packet.js';
import {
  approveAnswer, answerText, isFinalAnswer, reconcileFinalAnswers,
  revokeAnswer, withinLimit
} from '../gefen-tender/final-answers.js';
import {
  appendKnowledgeItems, assignKnowledgeToProgram, createKnowledgeItem, knowledgeFromCatalog,
  isFactualKnowledgeItem
} from '../gefen-tender/knowledge.js';
import {
  appendHistoricalAnswers, historicalForQuestion, parseHistoricalImport
} from '../gefen-tender/historical-answers.js';
import {
  filterKnowledgeItems, pendingKnowledgeItems, planKnowledgeWorkbook
} from '../gefen-tender/knowledge-import.js';
import {
  buildSubmissionAnswers, ensureAssociationQuestions
} from '../gefen-tender/questionnaires.js';
import {
  BASKET_112, BASKET_112_TITLE, CHAPTERS_112, association112, countWords,
  enrichQuestion112, programsWith112, withinWordLimit,
  limitAppliesToExtra, limitedAnswerText, professionalRequirementText
} from '../gefen-tender/questionnaire-112.js';
import { applyCatalog112 } from '../gefen-tender/catalog-112.js';
import { administrativeCompleted, programReadinessRows112 } from '../gefen-tender/readiness.js';
import { thresholdsPayload } from '../gefen-tender/thresholds-112.js';
import {
  downloadWorkbook, exportApprovedAnswersWorkbook, exportOfficialFormPackage, officialTemplateLink
} from '../gefen-tender/excel-forms.js';
import { fillTemplateWorkbook, rowsForForm, templateMeta } from '../gefen-tender/excel-templates.js';
import {
  fileRuleForArea, makeLinkedDocument, normalizeDocuments, primaryDocumentUrl,
  renderDocumentUploader, uploadGefenDocument, gefenSharePointInvoke
} from '../gefen-tender/document-upload.js';
import {
  normalizeExperienceRecords, emptyExperienceRecord,
  normalizeRecommendationRecords, emptyRecommendationRecord, RECOMMENDATION_STATUSES,
  SYLLABUS_AGE_STAGES, normalizeSyllabusSessions, emptySyllabusSession, reorderSyllabusSessions,
  historicalAsKnowledgeItems, inferAgeStageFromGrades,
  experienceFilled, recommendationsFilled, syllabusFilled, documentsFilled,
  normalizePersonExperienceRecords, emptyPersonExperienceRecord,
  normalizePersonRecommenders, emptyPersonRecommender, RECOMMENDER_RELATIONS
} from '../gefen-tender/program-records.js';
import {
  proposeProgramDetailFills, applyDetailProposals,
  countSyllabusMeetings, uniformSessionDuration, catalogRefForExport
} from '../gefen-tender/knowledge-fill.js';

const SP_ROOT = 'ניהול/מכרז גפן 2027';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const isAdmin = () => String(state?.user?.role || state?.user?.display_role || '').trim() === 'admin';
const link = (folder, label) =>
  `<a class="gt-doc-link" target="_blank" rel="noopener noreferrer" href="${SHAREPOINT_BASE}/${folder.split('/').map(encodeURIComponent).join('/')}">${icon('folder')}${esc(label)}</a>`;
const opts = (values, current) => values.map((v) =>
  `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('');

const I = {
  admin: 'M9 4h6l1 2h3v15H5V6h3zM9 4v3h6V4M9 13l2 2 4-4',
  programs: 'M4 6h16M4 12h16M4 18h10',
  people: 'M9 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19c.6-3.5 2.6-5.5 5.5-5.5s4.9 2 5.5 5.5M17 10a2.5 2.5 0 1 0 0-5',
  docs: 'M7 3h7l4 4v14H7zM14 3v5h5M10 12h5M10 16h5',
  ready: 'M12 3l7 3v5c0 4.4-2.8 8.4-7 10-4.2-1.6-7-5.6-7-10V6zM9.5 12l1.8 1.8 3.5-4',
  submit: 'M12 3l9 5-9 5-9-5zM3 8v8l9 5 9-5V8M12 13v8',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  copy: 'M8 8h10v12H8zM6 16H4V4h10v2',
  edit: 'M4 20h4l10-10-4-4L4 16v4zM12 6l4 4',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7M8 16h8',
  check: 'M5 12l5 5L20 7',
  link: 'M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 5M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 1 0 7.07 7.07L13 19',
  folder: 'M3 7h6l2 2h10v10H3z',
  upload: 'M12 16V6M8 10l4-4 4 4M4 20h16',
  download: 'M12 4v10M8 10l4 4 4-4M4 20h16',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8h.01M11 12h1v5h1',
  filter: 'M4 6h16M7 12h10M10 18h4',
  chevL: 'M14 6l-6 6 6 6',
  chevR: 'M10 6l6 6-6 6'
};

function icon(name) {
  const d = I[name] || I.info;
  return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="${d}"/></svg>`;
}

function statusBadge(label, tone = 'muted') {
  return `<span class="gt-badge gt-badge--${tone}">${esc(label)}</span>`;
}

function toneForAdmin(status) {
  if (status === ADMIN_STATUSES[5]) return 'ok';
  if (!status || status === ADMIN_STATUSES[0]) return 'muted';
  if (/ממתין/.test(status)) return 'warn';
  return 'info';
}

function answerTone(state) {
  if (state === 'ok') return 'ok';
  if (state === 'over') return 'danger';
  if (state === 'draft') return 'info';
  return 'muted';
}

function answerState(row, a) {
  const has = Boolean(String(a.value || '').trim());
  const limited = limitedAnswerText(a);
  const over = (a.limit && !withinLimit(limited, a.limit))
    || (a.limit_words && !withinWordLimit(limited, a.limit_words));
  if (over) return 'over';
  if (isFinalAnswer(row.payload?.final_answers, a.key, a.value)) return 'ok';
  if (has) return 'draft';
  return 'empty';
}

function answerStateLabel(s) {
  return { ok: 'מאושרת', draft: 'טיוטה', over: 'חריגה', empty: 'טרם הוזן' }[s] || s;
}

function shortUrlLabel(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const file = u.searchParams.get('file');
    if (file) return decodeURIComponent(file);
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || u.hostname;
    return decodeURIComponent(last).slice(0, 48);
  } catch {
    return String(url).slice(0, 28);
  }
}

function formatCount(current, limit) {
  const n = Number(current) || 0;
  const lim = Number(limit) || 0;
  // LTR isolate so RTL does not reverse "n / limit"
  return `\u2066${n} / ${lim}\u2069`;
}

function sourceLinkHtml(source) {
  const s = String(source || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) {
    return `<a class="gt-doc-link" target="_blank" rel="noopener noreferrer" href="${esc(s)}">${icon('link')}${esc(shortUrlLabel(s))}</a>`;
  }
  return esc(s.length > 48 ? `${s.slice(0, 48)}…` : s);
}

function requirementsBlockHtml(qObj, current) {
  const reqInfo = professionalRequirementText(qObj || current || {});
  const conditions = qObj?.threshold_conditions || current?.conditions || '';
  const criteria = qObj?.professional_criteria || current?.criteria || '';
  const attachments = qObj?.attachments || current?.attachments || '';
  const source = qObj?.source || current?.source || '';
  const verified = qObj?.mapping_verified === true || current?.mapping_verified === true;
  const lines = [];
  if (reqInfo.kind === 'professional') {
    lines.push(`<p><strong>דרישות מקצועיות:</strong> ${esc(reqInfo.text)}</p>`);
  } else if (reqInfo.kind === 'format_only') {
    lines.push(`<p><strong>פורמט מענה:</strong> ${esc(reqInfo.format)} <span class="gt-badge gt-badge--muted">אינו דרישה מקצועית</span></p>`);
    lines.push('<p class="gt-header__sub">דרישה מקצועית מפורטת ממסמכי המכרז — טרם אומתה או לא צוינה במקור.</p>');
  } else {
    lines.push('<p><strong>דרישות מקצועיות:</strong> <span class="gt-badge gt-badge--muted">לא צוינו / טרם אומתו</span></p>');
  }
  if (conditions && String(conditions).trim() && String(conditions).trim() !== '—') {
    lines.push(`<p><strong>תנאי סף:</strong> ${esc(conditions)}</p>`);
  }
  if (criteria && String(criteria).trim() && String(criteria).trim() !== '—') {
    lines.push(`<p><strong>קריטריונים:</strong> ${esc(criteria)}</p>`);
  }
  if (attachments && String(attachments).trim() && String(attachments).trim() !== '—') {
    lines.push(`<p><strong>מסמכים:</strong> ${esc(attachments)}</p>`);
  }
  if (source) {
    lines.push(`<p><strong>מקור:</strong> ${sourceLinkHtml(source)} ${verified ? statusBadge('מיפוי אומת', 'ok') : statusBadge('מיפוי טרם אומת', 'muted')}</p>`);
  }
  return lines.join('');
}

function relatedQuestionLabel(id, answers = []) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  const byId = answers.find((a) => String(a.question_id) === raw || String(a.id) === raw || String(a.key) === raw);
  if (byId?.number) return String(byId.number);
  const m = raw.match(/112\.(\d+)/);
  if (m) return m[1];
  if (/^\d+$/.test(raw)) return raw;
  return raw.replace(/^112\./, '');
}

function fileIcon(name = '') {
  const n = String(name).toLowerCase();
  if (n.includes('pdf')) return '<span class="gt-file-icon gt-file-icon--pdf">PDF</span>';
  if (/\.xls|xlsx|excel/.test(n)) return '<span class="gt-file-icon gt-file-icon--xls">XLS</span>';
  if (/\.doc|docx|word/.test(n)) return '<span class="gt-file-icon gt-file-icon--doc">DOC</span>';
  return '<span class="gt-file-icon gt-file-icon--folder">תיק</span>';
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso).slice(0, 16);
  }
}

export async function mountGefenTender(root) {
  if (!root || !isAdmin()) return;
  root.innerHTML = '<p role="status">טוען נתונים...</p>';

  let rows = [];
  let tab = 'administrative';
  let selected = '';
  let programSub = 'details';
  let submissionId = '';
  let questionIndex = 0;
  let busy = false;
  let dirty = false;
  let autosaveTimer = null;
  let filterAdmin = '';
  let searchAdmin = '';
  let filterProgram = '';
  let filterValidity = '';
  let searchProgram = '';
  let filterOperator = '';
  let searchOperator = '';
  let searchKnowledge = '';
  let filterKnowledgeType = '';
  let filterKnowledgeVer = '';
  let filterKnowledgeTopic = '';
  let knowledgeOpen = '';
  let showUnassigned = false;
  let importPreview = null;
  let filterQ = '';
  let searchQ = '';
  let toastTimer = null;
  let docsListing = null;
  let docsFolderPath = '';
  let syllabusAge = '';
  let syllabusEditMode = false;
  let syllabusSourceOpen = false;
  let contextPreview = null;
  let peoplePickerQ = '';
  let knowledgeSourceFilter = 'all';
  let knowledgeFillProposals = null;

  const pendingLeave = () => {
    if (!dirty) return true;
    return window.confirm('קיימים שינויים שלא נשמרו. לצאת ללא שמירה?');
  };
  const get = () => rows.find((r) => r.id === selected);
  const administrative = () => rows.find((r) => r.kind === 'administrative');
  const setStatus = (msg, tone = '') => {
    const el = root.querySelector('[data-gt-status]');
    if (!el) return;
    el.textContent = msg || '';
    el.dataset.tone = tone || '';
  };
  const toast = (msg) => {
    let el = document.querySelector('.gt-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'gt-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
  };

  const field = (key, label, value = '', limit = 0, choices = null, multi = false) => {
    const attr = ` data-field="${esc(key)}"`;
    let input;
    if (choices) {
      input = multi
        ? `<div data-multi="${esc(key)}">${choices.map((v) =>
          `<label><input type="checkbox" value="${esc(v)}"${Array.isArray(value) && value.includes(v) ? ' checked' : ''}>${esc(v)}</label>`
        ).join(' ')}</div>`
        : `<select${attr}><option value="">בחרו</option>${opts(choices, value)}</select>`;
    } else {
      const lim = Number(limit) || 0;
      const useTextarea = lim > 200;
      if (useTextarea) {
        const rowsN = lim > 400 ? 4 : 2;
        input = `<textarea rows="${rowsN}"${attr} maxlength="${lim}">${esc(value)}</textarea>` +
          `<small class="gt-count" data-count="${esc(key)}" data-count-limit="${lim}">${formatCount(String(value ?? '').length, lim)}</small>`;
      } else {
        input = `<input type="text"${attr}${lim ? ` maxlength="${lim}"` : ''} value="${esc(value)}">` +
          (lim ? `<small class="gt-count" data-count="${esc(key)}" data-count-limit="${lim}">${formatCount(String(value ?? '').length, lim)}</small>` : '');
      }
    }
    return `<div class="gt-field"><label>${esc(label)}${limit && Number(limit) > 0 ? ` (עד ${limit} תווים)` : ''}</label>${input}</div>`;
  };

  const readyCell = (status, { openSub = '', programId = '', gotoSubmission = false } = {}) => {
    const filled = status === 'הוזן' || status === 'נבדק' || status === 'הושלם' || status === 'מוכן';
    const short = filled ? (status === 'נבדק' || status === 'הושלם' || status === 'מוכן' ? status : 'הוזן') : 'חסר';
    const tone = filled ? 'ok' : 'muted';
    let nav = '';
    if (gotoSubmission && programId) nav = ` data-goto-submission="${esc(programId)}"`;
    else if (openSub && programId) nav = ` data-open-program-sub="${esc(openSub)}" data-program-id="${esc(programId)}"`;
    else if (openSub) nav = ` data-open-program-sub="${esc(openSub)}"`;
    return `<button type="button" class="gt-ready-cell"${nav}><span class="gt-dot gt-dot--${tone}"></span>${esc(short)}</button>`;
  };

  async function saveViaRpc(row, payload, mode = 'save_payload') {
    if (!isAdmin() || busy) return false;
    busy = true;
    const enabled = [...root.querySelectorAll('button,select,textarea,input')].filter((e) => !e.disabled);
    enabled.forEach((e) => { e.disabled = true; });
    setStatus('שומר...', '');
    try {
      const { data, error } = await supabase.rpc('gefen_tender_2027_save', {
        p_id: row.id,
        p_expected_revision: row.revision,
        p_payload: payload,
        p_mode: mode
      });
      if (error) {
        const missingRpc = /function .*gefen_tender_2027_save/i.test(error.message) || error.code === 'PGRST202';
        const badMode = mode === 'append_historical' && /invalid_mode/i.test(error.message || '');
        if (missingRpc || badMode) {
          let nextPayload = { ...payload };
          if (mode === 'append_historical') {
            nextPayload = {
              ...row.payload,
              historical_answers: appendHistoricalAnswers(
                row.payload?.historical_answers,
                payload.historical_answers
              ),
              final_answers: row.payload?.final_answers || {}
            };
            mode = 'save_payload';
            if (!missingRpc) {
              const retry = await supabase.rpc('gefen_tender_2027_save', {
                p_id: row.id,
                p_expected_revision: row.revision,
                p_payload: nextPayload,
                p_mode: 'save_payload'
              });
              if (retry.error) throw retry.error;
              if (!retry.data) throw new Error('הרשומה השתנתה. יש לטעון מחדש.');
              Object.assign(row, retry.data);
              dirty = false;
              setStatus('נשמר', 'ok');
              toast('נשמר');
              return true;
            }
          } else if (mode === 'save_payload' || mode === 'set_answers') {
            const map = new Map(buildSubmissionAnswers({ ...row, payload: nextPayload }).map((a) => [a.key, a.value]));
            nextPayload.final_answers = reconcileFinalAnswers(nextPayload.final_answers, map);
          } else if (mode === 'append_knowledge') {
            nextPayload = {
              ...row.payload,
              knowledge_items: appendKnowledgeItems(
                row.payload?.knowledge_items,
                payload.knowledge_items
              ),
              final_answers: row.payload?.final_answers || {}
            };
          }
          const { data: updated, error: upErr } = await supabase.from(TABLE)
            .update({ payload: nextPayload, revision: row.revision + 1, updated_at: new Date().toISOString() })
            .eq('id', row.id).eq('revision', row.revision).select().maybeSingle();
          if (upErr) throw upErr;
          if (!updated) throw new Error('הרשומה השתנתה. יש לטעון מחדש.');
          Object.assign(row, updated);
        } else throw error;
      } else {
        if (!data) throw new Error('הרשומה השתנתה. יש לטעון מחדש.');
        Object.assign(row, data);
      }
      dirty = false;
      setStatus('נשמר', 'ok');
      toast('נשמר');
      return true;
    } catch (e) {
      setStatus(`השמירה נכשלה: ${e.message}`, 'err');
      return false;
    } finally {
      busy = false;
      enabled.forEach((e) => { e.disabled = false; });
    }
  }

  function collectProgramPayload(row) {
    const v = {};
    root.querySelectorAll('[data-field]').forEach((x) => { v[x.dataset.field] = x.value; });
    root.querySelectorAll('[data-multi]').forEach((x) => {
      v[x.dataset.multi] = [...x.querySelectorAll(':checked')].map((c) => c.value);
    });
    const p = { ...row.payload };
    p.details = { ...p.details };
    PROGRAM_DETAIL_FIELDS.forEach(([k]) => {
      if (k in v) p.details[k] = v[k];
    });
    p.associations = (p.associations || []).map((a, i) => {
      const ensured = ensureAssociationQuestions(a);
      // Do not re-apply catalog on every save — preserves production template limits.
      if (Array.isArray(ensured.questions) && ensured.questions.length) {
        return {
          ...ensured,
          questions: ensured.questions.map((q, j) => {
            const key = `q_${i}_${j}`;
            const extraKey = `q_${i}_${j}_extra`;
            const next = { ...q };
            if (key in v) next.answer = v[key];
            if (extraKey in v) next.answer_extra = v[extraKey];
            return next;
          })
        };
      }
      return { ...ensured, answers: v[`answer_${i}`] ?? ensured.answers };
    });
    ['knowledge_notes', 'source_notes', 'historical_notes', 'syllabus', 'experience', 'recommendations',
      'developers', 'operators', 'drive_folder_url', 'sharepoint_notes'].forEach((k) => {
      if (k in v) p[k] = v[k];
    });
    if (root.querySelector('[data-exp-field]')) {
      const byId = new Map();
      root.querySelectorAll('[data-exp-id][data-exp-field]').forEach((el) => {
        const id = el.dataset.expId;
        if (!byId.has(id)) byId.set(id, { id });
        byId.get(id)[el.dataset.expField] = el.value;
      });
      p.experience_records = normalizeExperienceRecords([...byId.values()]);
    }
    if (root.querySelector('[data-rec-field]')) {
      const byId = new Map();
      root.querySelectorAll('[data-rec-id][data-rec-field]').forEach((el) => {
        const id = el.dataset.recId;
        if (!byId.has(id)) byId.set(id, { id });
        byId.get(id)[el.dataset.recField] = el.value;
      });
      p.recommendation_records = normalizeRecommendationRecords([...byId.values()]);
    }
    // Collect syllabus DOM only in edit mode — view mode omits cell values to avoid wiping content.
    if (syllabusEditMode && root.querySelector('[data-syl-field]')) {
      const byId = new Map();
      root.querySelectorAll('[data-syl-id][data-syl-field]').forEach((el) => {
        const id = el.dataset.sylId;
        if (!byId.has(id)) byId.set(id, { id });
        const key = el.dataset.sylField;
        byId.get(id)[key] = el.type === 'number' ? Number(el.value) || 0 : el.value;
      });
      const edited = normalizeSyllabusSessions([...byId.values()]);
      const editedIds = new Set(edited.map((s) => s.id));
      const kept = normalizeSyllabusSessions(p.syllabus_sessions).filter((s) => !editedIds.has(s.id));
      p.syllabus_sessions = normalizeSyllabusSessions([...kept, ...edited]);
    }
    if (root.querySelector('[data-pexp-field]')) {
      const byId = new Map();
      root.querySelectorAll('[data-pexp-id][data-pexp-field]').forEach((el) => {
        const id = el.dataset.pexpId;
        if (!byId.has(id)) byId.set(id, { id });
        byId.get(id)[el.dataset.pexpField] = el.value;
      });
      p.person_experience_records = normalizePersonExperienceRecords([...byId.values()]);
    }
    if (root.querySelector('[data-prec-field]')) {
      const byId = new Map();
      root.querySelectorAll('[data-prec-id][data-prec-field]').forEach((el) => {
        const id = el.dataset.precId;
        if (!byId.has(id)) byId.set(id, { id });
        byId.get(id)[el.dataset.precField] = el.value;
      });
      p.person_recommenders = normalizePersonRecommenders([...byId.values()]);
    }
    if (RECOMMENDATION_FOLDER_BY_PROGRAM[row.id] && !p.recommendations_folder_url) {
      p.recommendations_folder_url = recommendationsFolderUrl(row.id, row.title);
      p.recommendations_folder_name = RECOMMENDATION_FOLDER_BY_PROGRAM[row.id];
    }
    p.thresholds_112 = thresholdsPayload(p.thresholds_112);
    if (root.querySelector('[data-dev-id], [data-op-id]')) {
      p.developer_ids = [...root.querySelectorAll('[data-dev-id]:checked')].map((x) => x.value);
      p.operator_ids = [...root.querySelectorAll('[data-op-id]:checked')].map((x) => x.value);
    }
    const map = new Map(buildSubmissionAnswers({ ...row, payload: p }).map((a) => [a.key, a.value]));
    p.final_answers = reconcileFinalAnswers(p.final_answers, map);
    return p;
  }

  function headerHtml() {
    const programs = programsWith112(rows);
    const readiness = programReadinessRows112(rows);
    const inProgress = readiness.filter((r) => r.work_state === 'בתהליך' || r.drafts > 0).length;
    const latest = rows.reduce((m, r) => Math.max(m, new Date(r.updated_at || 0).getTime()), 0);
    return `<header class="gt-header">
      <div>
        <h1 class="gt-header__title">מכרז גפ״ן 2027</h1>
        <p class="gt-header__sub">${esc(BASKET_112_TITLE)} | תת סל ${BASKET_112}</p>
      </div>
      <div class="gt-header__meta">
        <span>${programs.length} תוכניות</span>
        <span>${inProgress} הגשות בטיפול</span>
        <span>עדכון אחרון: ${latest ? fmtDate(new Date(latest).toISOString()) : '—'}</span>
      </div>
    </header>`;
  }

  function tabsHtml() {
    const tabs = [
      ['administrative', 'הגשה מנהלית', 'admin'],
      ['program', 'תוכניות והגשות', 'programs'],
      ['operator', 'מפתחים ומפעילים', 'people'],
      ['documents', 'מסמכים ותבניות', 'docs'],
      ['readiness', 'בקרת מוכנות', 'ready'],
      ['submission', 'הגשה למכרז', 'submit']
    ];
    return `<nav class="gt-nav" aria-label="לשוניות מכרז">${tabs.map(([k, t, ic]) =>
      `<button type="button" class="gt-nav__btn" data-tab="${k}" aria-current="${tab === k}">${icon(ic)}<span>${t}</span></button>`
    ).join('')}</nav>`;
  }

  function adminTab() {
    const a = administrative();
    const sections = a?.payload?.sections || {};
    const done = administrativeCompleted(a);
    let list = ADMIN_SECTIONS.map((t, i) => {
      const n = i + 1;
      const v = sections[n] || {};
      return { n, t, v, done: v.status === ADMIN_STATUSES[5] };
    });
    if (filterAdmin === 'pending') list = list.filter((x) => !x.done);
    if (filterAdmin === 'done') list = list.filter((x) => x.done);
    if (searchAdmin) {
      const q = searchAdmin.trim().toLowerCase();
      list = list.filter((x) => `${x.n} ${x.t}`.toLowerCase().includes(q));
    }
    return `<div class="gt-toolbar">
      <strong>${done} / 19 הושלמו</strong>
      ${link('11 - טופס מנהלי והצהרות', 'תיקיית SharePoint')}
      <select data-filter-admin>
        <option value="">כל הסטטוסים</option>
        <option value="pending"${filterAdmin === 'pending' ? ' selected' : ''}>להשלמה</option>
        <option value="done"${filterAdmin === 'done' ? ' selected' : ''}>הושלמו</option>
      </select>
      <input type="search" data-search-admin placeholder="חיפוש סעיף" value="${esc(searchAdmin)}">
    </div>
    <div class="gt-overflow"><table class="gt-table"><thead><tr>
      <th>#</th><th>דרישה</th><th>סוג מסמך</th><th>תוקף</th><th>סטטוס</th><th>מסמך</th><th>פעולות</th>
    </tr></thead><tbody>${list.map(({ n, t, v }) => {
      const law = [5, 6, 10, 12].includes(n);
      const file = n <= 6 || [10, 12].includes(n);
      const kind = law ? 'הצהרה + עו״ד' : file ? 'קובץ' : 'הצהרה מקוונת';
      return `<tr data-admin-expand="${n}">
        <td>${n}</td>
        <td>${esc(t)}</td>
        <td>${kind}</td>
        <td>${esc(v.expiry || '—')}</td>
        <td>${statusBadge(v.status || ADMIN_STATUSES[0], toneForAdmin(v.status))}</td>
        <td>${(() => {
          const docs = normalizeDocuments(v.documents || v.url);
          const first = docs[0];
          if (!first?.url) return '<span class="gt-badge gt-badge--muted">טרם הוזן</span>';
          return `<a class="gt-doc-link" target="_blank" rel="noopener noreferrer" href="${esc(first.url)}">${icon('link')}${esc(first.name || shortUrlLabel(first.url))}</a>${docs.length > 1 ? ` <span class="gt-badge gt-badge--muted">+${docs.length - 1}</span>` : ''}`;
        })()}</td>
        <td><button type="button" class="gt-btn--sm" data-admin-edit="${n}">${icon('edit')}עריכה</button></td>
      </tr>
      <tr data-admin-panel="${n}" hidden><td colspan="7">
        <div class="gt-panel">
          <div class="gt-grid-2">
            <div class="gt-field"><label>סטטוס</label><select data-a="status">${opts(ADMIN_STATUSES, v.status || ADMIN_STATUSES[0])}</select></div>
            ${file ? `<div class="gt-field"><label>תוקף</label><input data-a="expiry" type="date" value="${esc(v.expiry || '')}"></div>` : '<div></div>'}
            ${law ? `<div class="gt-field"><label>קישור לתבנית</label><input data-a="template_url" type="url" value="${esc(v.template_url || '')}"></div>` : ''}
          </div>
          <div class="gt-field"><label>מסמכים</label>
            ${renderDocumentUploader({
              docs: normalizeDocuments(v.documents || v.url),
              area: 'administrative',
              scopeKey: `admin:${n}`,
              sectionNumber: n,
              allowLink: true
            })}
            <small class="gt-header__sub">העלאת מסמך אינה מסמנת את הסעיף כהושלם.</small>
          </div>
          <div class="gt-field"><label>הערות</label><textarea data-a="notes" rows="2">${esc(v.notes || '')}</textarea></div>
          <button type="button" class="gt-btn--primary" data-save-admin="${n}">${icon('save')}שמירה</button>
        </div>
      </td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function programList() {
    let items = rows.filter((r) => r.kind === 'program');
    if (searchProgram) {
      const q = searchProgram.trim().toLowerCase();
      items = items.filter((r) => `${r.title} ${r.payload?.number || ''}`.toLowerCase().includes(q));
    }
    if (filterProgram) {
      items = items.filter((r) => (r.payload?.associations || []).some((a) => String(a.status || '').includes(filterProgram)));
    }
    if (filterValidity) {
      items = items.filter((r) => (r.payload?.associations || []).some((a) => String(a.validity || '') === filterValidity));
    }
    const statuses = [...new Set(rows.flatMap((r) => (r.payload?.associations || []).map((a) => a.status).filter(Boolean)))];
    const validities = [...new Set(rows.flatMap((r) => (r.payload?.associations || []).map((a) => a.validity).filter(Boolean)))];
    return `<div class="gt-toolbar">
      <input type="search" data-search-program placeholder="חיפוש תוכנית" value="${esc(searchProgram)}">
      <select data-filter-program><option value="">כל הסטטוסים</option>${statuses.map((s) =>
        `<option value="${esc(s)}"${filterProgram === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select data-filter-validity><option value="">כל התוקפים</option>${validities.map((s) =>
        `<option value="${esc(s)}"${filterValidity === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <strong>${items.length} תוכניות</strong>
    </div>
    <div class="gt-overflow"><table class="gt-table"><thead><tr>
      <th>מס׳</th><th>שם התוכנית</th><th>שיוך</th><th>תוקף</th><th>סטטוס הגשה</th><th>התקדמות תשובות</th><th>פעולות</th>
    </tr></thead><tbody>${items.map((r) => {
      const a112 = association112(r.payload || {}).association;
      const ready = programReadinessRows112([administrative(), r])[0];
      const assocLabel = (r.payload?.associations || [])
        .map((a) => `${a.code}`)
        .join(', ') || '—';
      return `<tr class="gt-row--clickable" data-select="${esc(r.id)}">
        <td>${esc(r.payload?.number ?? '—')}</td>
        <td>${esc(r.title)}</td>
        <td>${esc(assocLabel)}</td>
        <td>${esc(a112?.validity || '—')}</td>
        <td>${statusBadge(a112?.status || '—', a112?.status === 'בתוקף' ? 'ok' : 'info')}</td>
        <td>${ready?.applicable
          ? `<span class="gt-progress" title="${ready.approved}/${ready.total}"><span style="width:${ready.progress_pct}%"></span></span> ${ready.approved}/${ready.total}`
          : '—'}</td>
        <td><button type="button" class="gt-btn--sm" data-select="${esc(r.id)}">${icon('edit')}פתיחה</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="7"><div class="gt-empty">אין תוכניות להצגה</div></td></tr>'}</tbody></table></div>`;
  }

  function knowledgePanel(p) {
    const admin = administrative();
    const unassignedAll = admin?.payload?.unassigned_knowledge_items || [];
    const unassigned = pendingKnowledgeItems(unassignedAll);
    const programId = get()?.id || '';
    const histItems = showUnassigned ? [] : historicalAsKnowledgeItems(p.historical_answers, programId);
    const baseItems = showUnassigned ? unassigned : [...(p.knowledge_items || []), ...histItems];
    const topics = [...new Set(baseItems.map((i) => i.topic).filter(Boolean))];
    const typeOptions = [...new Set([...KNOWLEDGE_TYPES, 'היסטורי', 'תשובה היסטורית'])];
    let items = filterKnowledgeItems(baseItems, {
      search: searchKnowledge,
      topic: filterKnowledgeTopic,
      type: filterKnowledgeType,
      verification: filterKnowledgeVer
    });
    if (!showUnassigned && knowledgeSourceFilter === 'historical') {
      items = items.filter((i) => i._historical || i.type === 'היסטורי' || i.info_kind === 'היסטורי' || i.type === 'תשובה היסטורית');
    } else if (!showUnassigned && knowledgeSourceFilter === 'current') {
      items = items.filter((i) => !i._historical && i.type !== 'היסטורי' && i.info_kind !== 'היסטורי');
    }
    const programOptions = rows.filter((r) => r.kind === 'program')
      .map((r) => `<option value="${esc(r.id)}">${esc(r.title)}</option>`).join('');

    const hasItems = baseItems.length > 0;
    return `<div class="gt-toolbar">
      ${hasItems || showUnassigned ? `<input type="search" data-search-knowledge placeholder="חיפוש במאגר" value="${esc(searchKnowledge)}">` : ''}
      ${hasItems ? `<select data-filter-k-topic><option value="">כל הנושאים</option>${
        topics.map((t) => `<option value="${esc(t)}"${filterKnowledgeTopic === t ? ' selected' : ''}>${esc(t)}</option>`).join('')
      }</select>
      <select data-filter-k-type><option value="">כל הסוגים</option>${opts(typeOptions, filterKnowledgeType)}</select>
      <select data-filter-k-ver><option value="">כל הסטטוסים</option>${opts(VERIFICATION_STATUSES, filterKnowledgeVer)}</select>
      <select data-filter-k-hist>
        <option value="all"${knowledgeSourceFilter === 'all' ? ' selected' : ''}>כל המקורות</option>
        <option value="current"${knowledgeSourceFilter === 'current' ? ' selected' : ''}>נוכחי</option>
        <option value="historical"${knowledgeSourceFilter === 'historical' ? ' selected' : ''}>היסטורי</option>
      </select>` : ''}
      <button type="button" class="gt-btn--primary gt-btn--sm" data-toggle-add-knowledge title="הוספת פריט ידע ידני">${icon('edit')}הוספת מידע</button>
      <button type="button" class="gt-btn--sm" data-import-catalog title="ייבוא ממיפוי הקטלוג הקיים">ייבוא מקטלוג</button>
      <button type="button" class="gt-btn--sm" data-import-knowledge-xlsx title="ייבוא מקובץ Excel">${icon('upload')}ייבוא Excel</button>
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-knowledge-xlsx-file hidden>
      ${unassigned.length
        ? `<button type="button" class="gt-btn--sm" data-toggle-unassigned aria-current="${showUnassigned}">ממתינים לשיוך (${unassigned.length})</button>`
        : ''}
      <strong>${items.length} פריטים</strong>
    </div>
    <details class="gt-details gt-details--compact"><summary>מידע משלים על מאגר הידע</summary>
      <div class="gt-details__body"><p class="gt-header__sub">מאגר ידע מצטבר בלבד — אינו תשובה מאושרת להגשה 2027. יש להבחין בין מקור מצטבר לבין תשובה מאושרת.</p></div>
    </details>
    ${importPreview ? `<div class="gt-panel">
      <div class="gt-panel__title">תצוגה מקדימה לייבוא</div>
      <p>גיליון: ${esc(importPreview.sheet)} · שורות: ${importPreview.total_rows} · לקליטה: ${importPreview.to_ingest}
        · משויכים: ${importPreview.assigned_count} · ממתינים: ${importPreview.pending_count}
        · כפילויות שנמנעו: ${importPreview.duplicates_skipped}</p>
      <div class="gt-toolbar" style="margin-top:8px">
        <button type="button" class="gt-btn--primary" data-confirm-knowledge-import>קליטת המידע</button>
        <button type="button" data-cancel-knowledge-import>ביטול</button>
      </div>
    </div>` : ''}
    ${!items.length
      ? `<div class="gt-empty">${showUnassigned ? 'אין פריטים ממתינים לשיוך.' : 'טרם נוסף מידע.'}</div>`
      : `<div class="gt-overflow gt-overflow--sticky"><table class="gt-table gt-table--compact"><thead><tr>
          <th>כותרת / שאלה</th><th>נושא</th><th>סוג</th><th>תקציר</th><th>מקור</th><th>שאלות</th><th>סטטוס</th><th></th>
        </tr></thead><tbody>${items.map((item) => {
          const open = knowledgeOpen === item.id;
          const factual = isFactualKnowledgeItem(item);
          const hist = Boolean(item._historical || item.type === 'היסטורי' || item.info_kind === 'היסטורי');
          const related = (item.related_questions || []).map((id) => relatedQuestionLabel(id)).filter(Boolean);
          const src = String(item.source || '');
          const srcShort = src.includes('|') ? src.split('|').pop().trim() : (src.length > 36 ? `${src.slice(0, 36)}…` : src);
          return `<tr>
            <td>${esc(item.original_question || item.title || '—')}</td>
            <td>${esc(item.topic || '—')}</td>
            <td>${esc(item.info_kind || item.type || '—')}${hist ? ` ${statusBadge('אינו מאושר ל־2027', 'warn')}` : (factual ? '' : ` ${statusBadge('לא עובדתי', 'muted')}`)}</td>
            <td title="${esc(String(item.content || ''))}">${esc(String(item.content || '').slice(0, 72))}${String(item.content || '').length > 72 ? '…' : ''}</td>
            <td title="${esc(src)}">${esc(srcShort || '—')}</td>
            <td>${esc(related.length ? related.join(', ') : '—')}</td>
            <td>${statusBadge(item.verification_status || 'לא אומת', item.verification_status === 'אומת' ? 'ok' : 'muted')}</td>
            <td><button type="button" class="gt-btn--sm" data-k-open="${esc(item.id)}">${open ? 'סגירה' : 'פתיחה'}</button></td>
          </tr>${open ? `<tr><td colspan="8"><div class="gt-panel">
            ${hist ? '<p class="gt-header__sub">מידע היסטורי ממכרז קודם — אינו מאושר ל־2027.</p>' : ''}
            ${item.original_question ? `<p><strong>שאלה במקור:</strong> ${esc(item.original_question)}</p>` : ''}
            <pre style="white-space:pre-wrap;margin:0;font:inherit">${esc(item.content)}</pre>
            <p class="gt-header__sub">${esc(item.source || '')}</p>
            ${item.control_notes ? `<p class="gt-header__sub">בקרה: ${esc(item.control_notes)}</p>` : ''}
            ${hist ? '' : `<div class="gt-field"><label>שיוך לשאלות 112 (מספרים)</label>
              <input data-k-related="${esc(item.id)}" value="${esc(related.join(','))}" placeholder="לדוגמה: 1,12,27">
            </div>
            <div class="gt-toolbar">
              <button type="button" class="gt-btn--sm" data-save-k-related="${esc(item.id)}">שמירת שיוך שאלות</button>
              ${showUnassigned ? `<label>שיוך לתוכנית
                <select data-assign-program="${esc(item.id)}"><option value="">בחרו</option>${programOptions}</select>
              </label>
              <button type="button" class="gt-btn--primary gt-btn--sm" data-assign-knowledge="${esc(item.id)}">שיוך</button>` : ''}
            </div>`}
          </div></td></tr>` : ''}`;
        }).join('')}</tbody></table></div>`}
    <div class="gt-panel" data-add-knowledge-form hidden>
      <div class="gt-panel__title">הוספת פריט ידע</div>
      <div class="gt-grid-2">
        <div class="gt-field"><label>כותרת</label><input data-k-title></div>
        <div class="gt-field"><label>סוג</label><select data-k-type>${opts(KNOWLEDGE_TYPES, 'עובדה')}</select></div>
        <div class="gt-field"><label>נושא</label><input data-k-topic></div>
        <div class="gt-field"><label>שאלה מקורית</label><input data-k-original-q></div>
        <div class="gt-field"><label>מקור</label><input data-k-source></div>
        <div class="gt-field"><label>קישור</label><input data-k-url type="url"></div>
        <div class="gt-field"><label>תאריך מקור</label><input data-k-date type="date"></div>
        <div class="gt-field"><label>סטטוס אימות</label><select data-k-ver>${opts(VERIFICATION_STATUSES, 'לא אומת')}</select></div>
      </div>
      <div class="gt-field"><label>תוכן</label><textarea data-k-content rows="4"></textarea></div>
      <div class="gt-field"><label>הערות</label><textarea data-k-notes rows="2"></textarea></div>
      <button type="button" class="gt-btn--primary" data-add-knowledge>${icon('save')}שמירת פריט</button>
    </div>
    ${field('knowledge_notes', 'הערות ידע כלליות', p.knowledge_notes || '')}`;
  }

  function historicalPanel(p) {
    const items = p.historical_answers || [];
    const knowledgeHist = (p.knowledge_items || []).some((i) =>
      i?.type === 'היסטורי' || i?.info_kind === 'היסטורי' || i?.type === 'תשובה היסטורית' || i?.content_role === 'historical'
    );
    const hasPriorKnowledge = knowledgeHist || Boolean((p.knowledge_items || []).length && !items.length);
    return `<div class="gt-toolbar">
      <strong>תשובות היסטוריות</strong>
      <button type="button" class="gt-btn--primary gt-btn--sm" data-import-historical>${icon('upload')}ייבוא מידע</button>
      <input type="file" accept="application/json,.json" data-historical-file hidden>
    </div>
    ${!items.length
      ? (hasPriorKnowledge
        ? `<div class="gt-panel">
            <p>המידע ממכרזים קודמים זמין במאגר הידע</p>
            <button type="button" class="gt-btn--primary gt-btn--sm" data-filter-k-hist="historical" data-program-sub="knowledge">מעבר למאגר הידע</button>
          </div>`
        : '<div class="gt-empty">טרם יובאו תשובות היסטוריות.</div>')
      : `<div class="gt-overflow"><table class="gt-table"><thead><tr>
          <th>שנה</th><th>שאלה</th><th>מקור</th><th>שיוך</th><th>תשובה קודמת</th>
        </tr></thead><tbody>${items.map((h) => `<tr>
          <td>${esc(h.tender_year || '—')}</td>
          <td>${esc(h.original_question || h.question_id || '—')}</td>
          <td>${esc(h.source || '—')}</td>
          <td>${esc(h.program_id || '—')}</td>
          <td><details class="gt-details"><summary>הצגה</summary><div class="gt-details__body">${esc(h.answer)}</div></details>
            <span class="gt-hist__tag">היסטורית · אינה מאושרת ל־2027</span></td>
        </tr>`).join('')}</tbody></table></div>`}
    ${field('historical_notes', 'הערות תשובות קודמות', p.historical_notes || '')}`;
  }

  function programDetail() {
    const row = get();
    if (!row || row.kind !== 'program') return programList();
    const p = row.payload || {};
    const a112 = association112(p);
    const subs = [
      ['details', 'פרטי תוכנית'],
      ['knowledge', 'מאגר ידע'],
      ['historical', 'תשובות היסטוריות'],
      ['experience', 'ניסיון והמלצות'],
      ['people', 'מפתחים ומפעילים'],
      ['syllabus', 'סילבוס'],
      ['documents', 'מסמכים ומקורות']
    ];
    let body = '';
    if (programSub === 'details') {
      const fillPanel = knowledgeFillProposals?.length
        ? `<div class="gt-panel gt-panel--fill" data-knowledge-fill-panel>
            <div class="gt-panel__title">הצעות ממאגר הידע</div>
            <p class="gt-header__sub">מוצגות רק הצעות לשדות ריקים, עם מקור. אין דריסה אוטומטית.</p>
            <div class="gt-overflow"><table class="gt-table"><thead><tr>
              <th></th><th>שדה</th><th>הצעה</th><th>מקור</th>
            </tr></thead><tbody>
              ${knowledgeFillProposals.map((pr, i) => `<tr>
                <td><input type="checkbox" data-fill-pick="${esc(pr.field)}" checked></td>
                <td>${esc(pr.label)}</td>
                <td>${esc(Array.isArray(pr.value) ? pr.value.join(', ') : String(pr.value).slice(0, 180))}</td>
                <td>${esc(pr.source || '—')}</td>
              </tr>`).join('')}
            </tbody></table></div>
            <div class="gt-toolbar">
              <button type="button" class="gt-btn--sm gt-btn--primary" data-fill-apply-selected>אישור מסומנים</button>
              <button type="button" class="gt-btn--sm gt-btn--primary" data-fill-apply-all>אישור מרוכז</button>
              <button type="button" class="gt-btn--sm" data-fill-cancel>ביטול</button>
            </div>
          </div>`
        : '';
      body = `<div class="gt-toolbar">
          <button type="button" class="gt-btn--primary gt-btn--sm" data-knowledge-fill>${icon('check')}השלמת פרטים ממאגר הידע</button>
        </div>
        ${fillPanel}
        <div class="gt-grid-2 gt-grid-2--dense">${PROGRAM_DETAIL_FIELDS.map(([k, l, lim, choices, multi]) =>
          field(k, l, p.details?.[k] ?? (k === 'name' ? row.title : ''), lim, choices, multi)
        ).join('')}</div>
        <div class="gt-panel"><div class="gt-panel__title">שיוכים</div>
          <div class="gt-overflow"><table class="gt-table gt-table--assoc"><thead><tr>
            <th>תת סל</th><th>שם</th><th>תוקף</th><th>סטטוס הגשה</th>
          </tr></thead><tbody>
          ${(p.associations || []).map((raw) => {
            const assoc = ensureAssociationQuestions(raw);
            return `<tr class="gt-assoc-row">
              <td>${esc(assoc.code)}</td>
              <td>${esc(BASKETS[assoc.code] || '')}</td>
              <td>${esc(assoc.validity || '—')}</td>
              <td>${statusBadge(assoc.status || '—', Number(assoc.code) === BASKET_112 && assoc.status === 'בתוקף' ? 'ok' : 'info')}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="4"><div class="gt-empty">אין שיוכים</div></td></tr>'}
          </tbody></table></div>
        </div>`;
    } else if (programSub === 'knowledge') {
      body = knowledgePanel(p);
    } else if (programSub === 'historical') {
      body = historicalPanel(p);
    } else if (programSub === 'experience') {
      const recUrl = p.recommendations_folder_url || recommendationsFolderUrl(row.id, row.title);
      const hasRecFolder = Boolean(RECOMMENDATION_FOLDER_BY_PROGRAM[row.id] || p.recommendations_folder_url);
      const expRows = normalizeExperienceRecords(p.experience_records);
      const recRows = normalizeRecommendationRecords(p.recommendation_records);
      body = `<div class="gt-panel"><div class="gt-panel__title">רשומות ניסיון</div>
        <div class="gt-toolbar"><button type="button" class="gt-btn--sm gt-btn--primary" data-exp-add>הוספת רשומה</button></div>
        <div class="gt-overflow" data-exp-table><table class="gt-table"><thead><tr>
          <th>ארגון</th><th>תקופה</th><th>קהל</th><th>פעילות</th><th>איש קשר</th><th>אסמכתא</th><th>הערות</th><th></th>
        </tr></thead><tbody>${expRows.map((r) => `<tr>
          <td><input data-exp-id="${esc(r.id)}" data-exp-field="organization" value="${esc(r.organization)}"></td>
          <td><input data-exp-id="${esc(r.id)}" data-exp-field="period" value="${esc(r.period)}"></td>
          <td><input data-exp-id="${esc(r.id)}" data-exp-field="audience" value="${esc(r.audience)}"></td>
          <td><input data-exp-id="${esc(r.id)}" data-exp-field="activity" value="${esc(r.activity)}"></td>
          <td><input data-exp-id="${esc(r.id)}" data-exp-field="contact" value="${esc(r.contact)}"></td>
          <td><input data-exp-id="${esc(r.id)}" data-exp-field="evidence_url" value="${esc(r.evidence_url)}" placeholder="URL"></td>
          <td><input data-exp-id="${esc(r.id)}" data-exp-field="notes" value="${esc(r.notes)}"></td>
          <td><button type="button" class="gt-btn--sm" data-exp-remove="${esc(r.id)}">הסרה</button></td>
        </tr>`).join('') || '<tr><td colspan="8"><div class="gt-empty">טרם נוספו רשומות ניסיון.</div></td></tr>'}
        </tbody></table></div>
        <div class="gt-field"><label>מסמכי ניסיון</label>${renderDocumentUploader({
          docs: p.experience_documents, area: 'experience', scopeKey: `program:${row.id}:experience_documents`
        })}</div>
        <details class="gt-details"><summary>הערות כלליות (טקסט ישן)</summary>
          <div class="gt-details__body">${field('experience', 'הערות ניסיון', p.experience || '')}</div>
        </details>
      </div>
      <div class="gt-panel"><div class="gt-panel__title">המלצות</div>
        <div class="gt-toolbar">
          <button type="button" class="gt-btn--sm gt-btn--primary" data-rec-add>הוספת המלצה</button>
          ${hasRecFolder
            ? `<a class="gt-btn--sm" style="display:inline-flex" target="_blank" rel="noopener noreferrer" href="${esc(recUrl)}">${icon('folder')}תיקיית המלצות</a>`
            : '<span class="gt-badge gt-badge--muted">אין תיקיית המלצות משויכת</span>'}
        </div>
        <div class="gt-overflow" data-rec-table><table class="gt-table"><thead><tr>
          <th>ארגון</th><th>ממליץ</th><th>תפקיד</th><th>יצירת קשר</th><th>תאריך</th><th>מסמך</th><th>סטטוס</th><th>הערות</th><th></th>
        </tr></thead><tbody>${recRows.map((r) => `<tr>
          <td><input data-rec-id="${esc(r.id)}" data-rec-field="organization" value="${esc(r.organization)}"></td>
          <td><input data-rec-id="${esc(r.id)}" data-rec-field="recommender" value="${esc(r.recommender)}"></td>
          <td><input data-rec-id="${esc(r.id)}" data-rec-field="role" value="${esc(r.role)}"></td>
          <td><input data-rec-id="${esc(r.id)}" data-rec-field="contact" value="${esc(r.contact)}"></td>
          <td><input data-rec-id="${esc(r.id)}" data-rec-field="date" type="date" value="${esc(r.date)}"></td>
          <td><input data-rec-id="${esc(r.id)}" data-rec-field="document_url" value="${esc(r.document_url)}" placeholder="URL"></td>
          <td><select data-rec-id="${esc(r.id)}" data-rec-field="status">${opts(RECOMMENDATION_STATUSES, r.status)}</select></td>
          <td><input data-rec-id="${esc(r.id)}" data-rec-field="notes" value="${esc(r.notes)}"></td>
          <td><button type="button" class="gt-btn--sm" data-rec-remove="${esc(r.id)}">הסרה</button></td>
        </tr>`).join('') || '<tr><td colspan="9"><div class="gt-empty">טרם נוספו המלצות.</div></td></tr>'}
        </tbody></table></div>
        <div class="gt-field"><label>מסמכי המלצות</label>${renderDocumentUploader({
          docs: p.recommendations_documents, area: 'recommendations', scopeKey: `program:${row.id}:recommendations_documents`
        })}</div>
        <details class="gt-details"><summary>הערות כלליות (טקסט ישן)</summary>
          <div class="gt-details__body">${field('recommendations', 'הערות המלצות', p.recommendations || '')}</div>
        </details>
      </div>`;
    } else if (programSub === 'people') {
      const people = rows.filter((r) => r.kind === 'operator');
      const dev = new Set(p.developer_ids || []);
      const ops = new Set(p.operator_ids || []);
      const assigned = people.filter((r) => dev.has(r.id) || ops.has(r.id));
      const q = peoplePickerQ.trim().toLowerCase();
      const hits = q.length >= 2
        ? people.filter((r) => !dev.has(r.id) && !ops.has(r.id)
          && `${r.title} ${r.payload?.roles || ''}`.toLowerCase().includes(q)).slice(0, 12)
        : [];
      body = `<div class="gt-toolbar">
        <input type="search" data-people-picker-q placeholder="חיפוש להוספה ממאגר" value="${esc(peoplePickerQ)}">
        <span class="gt-header__sub">${q.length < 2 ? 'הקלידו לפחות 2 תווים לחיפוש' : (hits.length ? `${hits.length} תוצאות` : 'לא נמצאו')}</span>
      </div>
      ${hits.length ? `<div class="gt-panel"><div class="gt-panel__title">הוספה ממאגר</div>
        <div class="gt-overflow"><table class="gt-table"><thead><tr><th>שם</th><th>תפקיד</th><th></th></tr></thead><tbody>
          ${hits.map((r) => `<tr>
            <td>${esc(r.title)}</td>
            <td>${esc(r.payload?.roles || '—')}</td>
            <td><button type="button" class="gt-btn--sm gt-btn--primary" data-people-add="${esc(r.id)}">הוספה</button></td>
          </tr>`).join('')}
        </tbody></table></div></div>` : ''}
      <div class="gt-overflow"><table class="gt-table"><thead><tr>
        <th>שם</th><th>מפתח</th><th>מפעיל</th><th>השכלה</th><th>הכשרה</th><th>ניסיון</th><th>אימות</th>
      </tr></thead><tbody>
        ${assigned.map((r) => `<tr>
          <td>${esc(r.title)}</td>
          <td><input type="checkbox" data-dev-id value="${esc(r.id)}"${dev.has(r.id) ? ' checked' : ''}></td>
          <td><input type="checkbox" data-op-id value="${esc(r.id)}"${ops.has(r.id) ? ' checked' : ''}></td>
          <td>${esc(String(r.payload?.education || '—').slice(0, 48))}</td>
          <td>${esc(r.payload?.training_hours != null ? `${r.payload.training_hours} שעות` : String(r.payload?.training || '—').slice(0, 40))}</td>
          <td>${esc(String(r.payload?.experience || '—').slice(0, 48))}</td>
          <td>${statusBadge(r.payload?.verification_status || 'טרם נבדק',
            r.payload?.verification_status === 'נבדק' ? 'ok' : 'muted')}</td>
        </tr>`).join('') || '<tr><td colspan="7"><div class="gt-empty">לא שויכו אנשי צוות. חפשו במאגר להוספה.</div></td></tr>'}
      </tbody></table></div>`;
    } else if (programSub === 'syllabus') {
      const allSessions = normalizeSyllabusSessions(p.syllabus_sessions);
      const inferred = inferAgeStageFromGrades(p.grades || p.details?.grades || '') || '';
      const sessions = allSessions.filter((s) => !syllabusAge || s.age_stage === syllabusAge);
      const grades = p.grades || p.details?.grades || '';
      const meetingCount = countSyllabusMeetings(sessions.length ? sessions : allSessions);
      const uniformDur = uniformSessionDuration(sessions.length ? sessions : allSessions);
      const editing = syllabusEditMode;
      const audienceOf = (s) => {
        const own = String(s.audience || '').trim();
        if (own) return own;
        const stage = s.age_stage && s.age_stage !== 'כללי' ? s.age_stage : '';
        return [stage, grades].filter(Boolean).join(' · ') || '—';
      };
      const catalogOf = (s) => catalogRefForExport(s) || '—';
      body = `<div class="gt-syl-head">
        <div class="gt-syl-head__meta">
          <strong>${esc(row.title)}</strong>
          <span>שכבות גיל: ${esc(grades || '—')}</span>
          <span>מפגשים: ${meetingCount}</span>
          ${uniformDur ? `<span>משך מפגש: ${uniformDur} דק׳</span>` : ''}
        </div>
        <div class="gt-toolbar gt-toolbar--actions">
          <button type="button" class="gt-btn--sm${editing ? ' gt-btn--primary' : ''}" data-syl-toggle-edit>${icon('edit')}${editing ? 'סיום עריכה' : 'עריכה'}</button>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-template-file="174" hidden>
          <button type="button" class="gt-btn--sm" data-upload-template="174">${icon('upload')}ייבוא סילבוס</button>
          <button type="button" class="gt-btn--sm" data-export-form-global="174">${icon('download')}הפקת טופס 174</button>
          <button type="button" class="gt-btn--sm" data-fill-template="174" hidden aria-hidden="true"></button>
          <button type="button" class="gt-btn--sm" data-syl-source-toggle>${icon('folder')}מסמך מקור</button>
          <label class="gt-inline-label">שכבה <select data-syllabus-age>
            <option value=""${!syllabusAge ? ' selected' : ''}>הכל</option>
            ${opts(SYLLABUS_AGE_STAGES, syllabusAge)}
          </select></label>
          ${editing ? '<button type="button" class="gt-btn--sm gt-btn--primary" data-syl-add>הוספת מפגש</button>' : ''}
        </div>
      </div>
      ${syllabusSourceOpen ? `<div class="gt-panel"><div class="gt-panel__title">מסמך מקור</div>
        ${renderDocumentUploader({
          docs: p.syllabus_documents, area: 'syllabus', scopeKey: `program:${row.id}:syllabus_documents`
        })}
      </div>` : ''}
      <div class="gt-overflow gt-overflow--natural" data-syl-table><table class="gt-table gt-table--syllabus"><thead><tr>
        <th>מפגש</th><th>קהל היעד</th><th>נושאי מפגש</th><th class="gt-col--wide">פירוט תכני המפגש</th>
        <th>דרכי הפעלה</th><th>מיומנויות וערכים</th><th>קטלוג חינוכי</th>
        ${editing ? '<th></th>' : ''}
      </tr></thead><tbody>${sessions.map((s, i) => {
        const hidden = `
          <input type="hidden" data-syl-id="${esc(s.id)}" data-syl-field="meeting_number" value="${esc(s.meeting_number)}">
          <input type="hidden" data-syl-id="${esc(s.id)}" data-syl-field="meeting_from" value="${esc(s.meeting_from)}">
          <input type="hidden" data-syl-id="${esc(s.id)}" data-syl-field="meeting_to" value="${esc(s.meeting_to)}">
          <input type="hidden" data-syl-id="${esc(s.id)}" data-syl-field="age_stage" value="${esc(s.age_stage || inferred || 'כללי')}">
          <input type="hidden" data-syl-id="${esc(s.id)}" data-syl-field="source_group_id" value="${esc(s.source_group_id)}">
          <input type="hidden" data-syl-id="${esc(s.id)}" data-syl-field="source" value="${esc(s.source)}">
          <input type="hidden" data-syl-id="${esc(s.id)}" data-syl-field="source_page" value="${esc(s.source_page || 0)}">
          <input type="hidden" data-syl-id="${esc(s.id)}" data-syl-field="duration_minutes" value="${esc(s.duration_minutes || 90)}">
          <input type="hidden" data-syl-id="${esc(s.id)}" data-syl-field="optional" value="${s.optional ? '1' : ''}">`;
        if (!editing) {
          return `<tr>
            <td>${esc(s.meeting_label)}${s.optional ? ` ${statusBadge('אופציונלי', 'muted')}` : ''}${hidden}</td>
            <td>${esc(audienceOf(s))}</td>
            <td>${esc(s.topic || '—')}</td>
            <td class="gt-col--wide gt-cell--wrap">${esc(s.content || '—')}</td>
            <td class="gt-cell--wrap">${esc(s.methods || '—')}</td>
            <td class="gt-cell--wrap">${esc(s.skills_values || '—')}</td>
            <td class="gt-cell--wrap">${esc(catalogOf(s))}</td>
          </tr>`;
        }
        return `<tr>
          <td>
            <input data-syl-id="${esc(s.id)}" data-syl-field="meeting_label" value="${esc(s.meeting_label)}" style="width:4.5rem">
            ${hidden}
            ${s.optional ? statusBadge('אופציונלי', 'muted') : ''}
          </td>
          <td><input data-syl-id="${esc(s.id)}" data-syl-field="audience" value="${esc(s.audience || (audienceOf(s) === '—' ? '' : audienceOf(s)))}"></td>
          <td><input data-syl-id="${esc(s.id)}" data-syl-field="topic" value="${esc(s.topic)}"></td>
          <td class="gt-col--wide"><textarea rows="3" data-syl-id="${esc(s.id)}" data-syl-field="content">${esc(s.content)}</textarea></td>
          <td><textarea rows="2" data-syl-id="${esc(s.id)}" data-syl-field="methods">${esc(s.methods)}</textarea></td>
          <td><textarea rows="2" data-syl-id="${esc(s.id)}" data-syl-field="skills_values">${esc(s.skills_values)}</textarea></td>
          <td>
            <input data-syl-id="${esc(s.id)}" data-syl-field="catalog_item_number" value="${esc(s.catalog_item_number)}" placeholder="מספר פריט">
            <input data-syl-id="${esc(s.id)}" data-syl-field="catalog_item_url" value="${esc(s.catalog_item_url)}" placeholder="קישור">
          </td>
          <td>
            <button type="button" class="gt-btn--sm" data-syl-move="${esc(s.id)}" data-dir="up" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="gt-btn--sm" data-syl-move="${esc(s.id)}" data-dir="down" ${i === sessions.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="gt-btn--sm" data-syl-remove="${esc(s.id)}">הסרה</button>
          </td>
        </tr>`;
      }).join('') || `<tr><td colspan="${editing ? 8 : 7}"><div class="gt-empty">טרם נוספו מפגשים.</div></td></tr>`}
      </tbody></table></div>
      ${(p.syllabus || editing) ? `<details class="gt-details"${editing && p.syllabus ? ' open' : ''}><summary>הערות נוספות</summary>
        <div class="gt-details__body">${field('syllabus', 'הערות נוספות', p.syllabus || '')}</div>
      </details>` : ''}`;
    } else {
      const recUrl = p.recommendations_folder_url || recommendationsFolderUrl(row.id, row.title);
      body = field('drive_folder_url', 'תיקיית Google Drive', p.drive_folder_url || '')
        + `<p><a target="_blank" rel="noopener noreferrer" href="${GOOGLE_DRIVE_PROGRAMS}">תיקיית תוכניות תעשיידע</a></p>`
        + field('sharepoint_notes', 'הערות מסמכים', p.sharepoint_notes || '')
        + `<div class="gt-field"><label>מסמכים ואסמכתאות</label>${renderDocumentUploader({
          docs: p.documents, area: 'evidence', scopeKey: `program:${row.id}:documents`
        })}</div>`
        + field('source_notes', 'מקורות ואסמכתאות (טקסט)', p.source_notes || '')
        + (RECOMMENDATION_FOLDER_BY_PROGRAM[row.id] || p.recommendations_folder_url
          ? `<p><a class="gt-btn--sm" style="display:inline-flex" target="_blank" rel="noopener noreferrer" href="${esc(recUrl)}">${icon('folder')}תיקיית המלצות</a></p>`
          : '');
    }

    const recBtn = (RECOMMENDATION_FOLDER_BY_PROGRAM[row.id] || p.recommendations_folder_url)
      ? `<a class="gt-btn--sm" style="display:inline-flex" target="_blank" rel="noopener noreferrer" href="${esc(p.recommendations_folder_url || recommendationsFolderUrl(row.id, row.title))}" title="תיקיית המלצות">${icon('folder')}המלצות</a>`
      : '';
    return `<div class="gt-toolbar gt-toolbar--sticky">
      <button type="button" data-list-back>${icon('chevR')}חזרה לרשימה</button>
      <strong style="font-size:18px;font-weight:600">${esc(row.title)}</strong>
      <span class="gt-header__sub">${p.number != null && p.number !== '' ? `#${esc(p.number)} · ` : ''}שיוך ${a112.association ? BASKET_112 : '—'}</span>
      ${a112.association ? statusBadge(a112.association.status || '—', 'info') : ''}
      ${recBtn}
      <button type="button" class="gt-btn--primary" data-save-program>${icon('save')}שמירה</button>
      <button type="button" data-goto-submission="${esc(row.id)}">הגשה למכרז</button>
    </div>
    <div class="gt-subnav">${subs.map(([k, t]) =>
      `<button type="button" data-program-sub="${k}" aria-current="${programSub === k}">${t}</button>`
    ).join('')}</div>
    ${body}`;
  }

  function operatorTab() {
    let items = rows.filter((r) => r.kind === 'operator');
    if (searchOperator) {
      const q = searchOperator.trim().toLowerCase();
      items = items.filter((r) => `${r.title} ${r.payload?.roles || ''}`.toLowerCase().includes(q));
    }
    if (filterOperator === 'developers') items = items.filter((r) => /מפתח/.test(String(r.payload?.roles || '')));
    if (filterOperator === 'operators') items = items.filter((r) => /מפעיל/.test(String(r.payload?.roles || '')));
    if (filterOperator === 'unchecked') items = items.filter((r) => r.payload?.verification_status !== 'נבדק');
    if (filterOperator === 'missing') items = items.filter((r) => !r.payload?.cv_url && !r.payload?.documents);
    if (filterOperator === 'checked') items = items.filter((r) => r.payload?.verification_status === 'נבדק');

    const row = get();
    if (row && row.kind === 'operator') {
      const p = row.payload || {};
      const pexps = normalizePersonExperienceRecords(p.person_experience_records);
      const precs = normalizePersonRecommenders(p.person_recommenders);
      return `<div class="gt-toolbar">
        <button type="button" data-list-back>${icon('chevR')}חזרה</button>
        <strong style="font-size:18px">${esc(row.title)}</strong>
        <button type="button" class="gt-btn--primary" data-save-operator>${icon('save')}שמירה</button>
      </div>
      <div class="gt-panel"><div class="gt-panel__title">פרטים כלליים</div>
        <div class="gt-grid-2">
          ${field('roles', 'תפקיד / תפקידים', p.roles || '')}
          ${field('cv_url', 'קישור לקורות חיים', p.cv_url || '')}
          ${field('cv_attached', 'צורפו קורות חיים', p.cv_attached === true ? 'כן' : (p.cv_attached === false ? 'לא' : ''), 0, ['כן', 'לא'])}
          ${field('eligibility', 'התאמה לתנאי סף 112', p.eligibility || '')}
        </div>
      </div>
      <div class="gt-panel"><div class="gt-panel__title">השכלה</div>
        <div class="gt-grid-2">
          ${field('education', 'השכלה', p.education || '')}
          ${field('degrees', 'תארים', p.degrees || '')}
        </div>
      </div>
      <div class="gt-panel"><div class="gt-panel__title">הכשרות</div>
        <div class="gt-grid-2">
          ${field('training', 'הכשרות', p.training || '')}
          ${field('training_hours', 'שעות הכשרה', p.training_hours ?? '')}
        </div>
      </div>
      <div class="gt-panel"><div class="gt-panel__title">ניסיון מקצועי (טפסים 159/160)</div>
        <div class="gt-toolbar"><button type="button" class="gt-btn--sm gt-btn--primary" data-pexp-add>הוספת רשומת ניסיון</button></div>
        <div class="gt-overflow"><table class="gt-table"><thead><tr>
          <th>תחום ניסיון</th><th>פירוט</th><th>תוכנית</th><th>תפקיד</th><th>איש קשר</th><th>טלפון</th><th>מהות הקשר</th><th></th>
        </tr></thead><tbody>${pexps.map((r) => `<tr>
          <td><input data-pexp-id="${esc(r.id)}" data-pexp-field="domain" value="${esc(r.domain)}"></td>
          <td><textarea rows="2" data-pexp-id="${esc(r.id)}" data-pexp-field="detail">${esc(r.detail)}</textarea></td>
          <td>
            <select data-pexp-id="${esc(r.id)}" data-pexp-field="program_id">
              <option value="">—</option>
              ${rows.filter((pr) => pr.kind === 'program').map((pr) =>
                `<option value="${esc(pr.id)}"${pr.id === r.program_id ? ' selected' : ''}>${esc(pr.title)}</option>`).join('')}
            </select>
          </td>
          <td><select data-pexp-id="${esc(r.id)}" data-pexp-field="role">
            <option value="">—</option>
            ${opts(['מפתח', 'מפעיל'], r.role)}
          </select></td>
          <td><input data-pexp-id="${esc(r.id)}" data-pexp-field="contact_name" value="${esc(r.contact_name)}"></td>
          <td><input data-pexp-id="${esc(r.id)}" data-pexp-field="phone" value="${esc(r.phone)}"></td>
          <td><select data-pexp-id="${esc(r.id)}" data-pexp-field="relation">
            <option value="">—</option>
            ${opts(RECOMMENDER_RELATIONS, r.relation)}
          </select></td>
          <td><button type="button" class="gt-btn--sm" data-pexp-remove="${esc(r.id)}">הסרה</button></td>
        </tr>`).join('') || '<tr><td colspan="8"><div class="gt-empty">טרם הוזן ניסיון. המידע יתווסף בהמשך.</div></td></tr>'}
        </tbody></table></div>
        <details class="gt-details"><summary>טקסט ישן (משלים)</summary>
          <div class="gt-details__body gt-grid-2">
            ${field('experience', 'ניסיון', p.experience || '')}
            ${field('teaching_experience', 'ניסיון הוראה', p.teaching_experience || '')}
            ${field('development_experience', 'ניסיון פיתוח', p.development_experience || '')}
            ${field('experience_domain', 'תחום ניסיון (כללי)', p.experience_domain || '')}
          </div>
        </details>
      </div>
      <div class="gt-panel"><div class="gt-panel__title">ממליצים</div>
        <div class="gt-toolbar"><button type="button" class="gt-btn--sm gt-btn--primary" data-prec-add>הוספת ממליץ</button></div>
        <div class="gt-overflow"><table class="gt-table"><thead><tr>
          <th>שם</th><th>טלפון</th><th>מהות הקשר</th><th></th>
        </tr></thead><tbody>${precs.map((r) => `<tr>
          <td><input data-prec-id="${esc(r.id)}" data-prec-field="name" value="${esc(r.name)}"></td>
          <td><input data-prec-id="${esc(r.id)}" data-prec-field="phone" value="${esc(r.phone)}"></td>
          <td><select data-prec-id="${esc(r.id)}" data-prec-field="relation">
            <option value="">—</option>
            ${opts(RECOMMENDER_RELATIONS, r.relation)}
          </select></td>
          <td><button type="button" class="gt-btn--sm" data-prec-remove="${esc(r.id)}">הסרה</button></td>
        </tr>`).join('') || '<tr><td colspan="4"><div class="gt-empty">טרם הוזנו ממליצים.</div></td></tr>'}
        </tbody></table></div>
      </div>
      <div class="gt-panel"><div class="gt-panel__title">מסמכים — קורות חיים, תעודות ואסמכתאות</div>
        ${renderDocumentUploader({
          docs: normalizeDocuments(p.documents),
          area: 'operator',
          scopeKey: `operator:${row.id}`
        })}
      </div>`;
    }

    return `<div class="gt-toolbar">
      <input type="search" data-search-operator placeholder="חיפוש" value="${esc(searchOperator)}">
      <select data-filter-operator>
        <option value="">הכל</option>
        <option value="developers"${filterOperator === 'developers' ? ' selected' : ''}>מפתחים</option>
        <option value="operators"${filterOperator === 'operators' ? ' selected' : ''}>מפעילים</option>
        <option value="unchecked"${filterOperator === 'unchecked' ? ' selected' : ''}>טרם נבדקו</option>
        <option value="missing"${filterOperator === 'missing' ? ' selected' : ''}>חסרות אסמכתאות</option>
        <option value="checked"${filterOperator === 'checked' ? ' selected' : ''}>נבדקו</option>
      </select>
      <strong>${items.length}</strong>
    </div>
    <div class="gt-overflow"><table class="gt-table"><thead><tr>
      <th>שם</th><th>תפקיד</th><th>השכלה</th><th>שעות הכשרה</th><th>ניסיון</th><th>סטטוס בדיקה</th><th>פעולות</th>
    </tr></thead><tbody>${items.map((r) => `<tr class="gt-row--clickable" data-select="${esc(r.id)}">
      <td>${esc(r.title)}</td>
      <td>${esc(r.payload?.roles || '—')}</td>
      <td>${esc(String(r.payload?.education || '—').slice(0, 40))}</td>
      <td>${esc(r.payload?.training_hours != null ? r.payload.training_hours : '—')}</td>
      <td>${esc(String(r.payload?.experience || '—').slice(0, 40))}</td>
      <td>${statusBadge(r.payload?.verification_status || 'טרם נבדק',
        r.payload?.verification_status === 'נבדק' ? 'ok' : 'muted')}</td>
      <td><button type="button" class="gt-btn--sm" data-select="${esc(r.id)}">פתיחה</button></td>
    </tr>`).join('') || '<tr><td colspan="7"><div class="gt-empty">אין רשומות</div></td></tr>'}</tbody></table></div>`;
  }

  function documentsTab() {
    const program = get()?.kind === 'program' ? get() : programsWith112(rows)[0];
    const listedPath = docsListing?.folder_path || '';
    const listedOk = Boolean(docsListing && Array.isArray(docsListing.items));
    return `<div class="gt-toolbar"><strong>מנהל מסמכים</strong>
      <a class="gt-doc-link" target="_blank" rel="noopener noreferrer" href="${SHAREPOINT_BASE}">${icon('folder')}שורש SharePoint</a>
      <button type="button" class="gt-btn--sm" data-docs-root>${icon('search')}עיון בשורש</button>
      ${docsFolderPath ? `<span class="gt-header__sub">${esc(docsFolderPath)}</span>` : ''}
    </div>
      ${program ? `<div class="gt-panel">
        <div class="gt-panel__title">אסמכתאות תוכנית · ${esc(program.title)}</div>
        ${renderDocumentUploader({
          docs: program.payload?.documents,
          area: 'evidence',
          scopeKey: `program:${program.id}:documents`
        })}
        <p class="gt-header__sub">נשמר בתיקיית «08 - אישורים ואסמכתאות».</p>
      </div>` : ''}
      <div class="gt-panel">
        <div class="gt-panel__title">תיקיות SharePoint</div>
        <div class="gt-overflow"><table class="gt-table"><thead><tr>
          <th>קטגוריה / שם</th><th>סוג</th><th>עודכן</th><th>פעולות</th>
        </tr></thead><tbody>${SHAREPOINT_FOLDERS.map((f) => {
          const full = `${SP_ROOT}/${f}`;
          const isListed = listedOk && (listedPath === full || listedPath.endsWith(`/${f}`));
          return `<tr>
            <td>${esc(f)}</td>
            <td>תיקייה</td>
            <td>${isListed ? 'נבדק' : '—'}</td>
            <td>
              ${link(f, 'פתיחה')}
              <button type="button" class="gt-btn--sm" data-docs-browse="${esc(full)}">עיון</button>
            </td>
          </tr>`;
        }).join('')}</tbody></table></div>
      </div>
      ${listedOk ? `<div class="gt-panel">
        <div class="gt-panel__title">תוכן תיקייה · ${esc(listedPath.replace(SP_ROOT + '/', '') || 'שורש')}</div>
        <div class="gt-overflow"><table class="gt-table"><thead><tr>
          <th>שם</th><th>סוג</th><th>עודכן</th><th>פעולות</th>
        </tr></thead><tbody>${(docsListing.items || []).map((item) => {
          const isFolder = Boolean(item.is_folder);
          const childPath = isFolder ? `${listedPath}/${item.name}` : '';
          return `<tr>
            <td>${esc(item.name || '—')}</td>
            <td>${isFolder ? 'תיקייה' : 'קובץ'}</td>
            <td>${esc(item.updated_at ? fmtDate(item.updated_at) : '—')}</td>
            <td>
              ${item.url ? `<a class="gt-doc-link" target="_blank" rel="noopener noreferrer" href="${esc(item.url)}">${icon('link')}פתיחה</a>` : '—'}
              ${isFolder ? `<button type="button" class="gt-btn--sm" data-docs-browse="${esc(childPath)}">עיון</button>` : ''}
            </td>
          </tr>`;
        }).join('') || '<tr><td colspan="4"><div class="gt-empty">התיקייה ריקה.</div></td></tr>'}
        </tbody></table></div>
      </div>` : ''}
      <div class="gt-panel">
        <div class="gt-panel__title">טפסים 159 / 160 / 174</div>
        <div class="gt-overflow"><table class="gt-table"><thead><tr>
          <th></th><th>טופס</th><th>מקור</th><th>סטטוס</th><th>פעולות</th>
        </tr></thead><tbody>${EXCEL_FORMS.filter((f) => [159, 160, 174].includes(f.code)).map((f) => {
          const stored = (administrative()?.payload?.excel_templates || {})[f.code] || {};
          const meta = templateMeta(f.code, stored);
          const ready = Boolean(meta.uploaded_at || meta.storage_path || stored.base64);
          return `<tr>
            <td>${fileIcon(f.file)}</td>
            <td>${f.code} – ${esc(f.title)}</td>
            <td>תבנית רשמית</td>
            <td>${ready ? statusBadge('תבנית הועלתה', 'ok') : statusBadge('טרם הועלתה תבנית', 'muted')}</td>
            <td>
              <a class="gt-btn--sm" style="display:inline-flex" target="_blank" rel="noopener noreferrer" href="${officialTemplateLink(f)}">${icon('link')}תבנית מקור</a>
              <button type="button" class="gt-btn--sm" data-upload-template="${f.code}">${icon('upload')}העלאת תבנית</button>
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-template-file="${f.code}" hidden>
              <button type="button" class="gt-btn--sm" data-fill-template="${f.code}" ${ready ? '' : 'disabled title="מילוי זמין לאחר העלאת תבנית"'}>${icon('download')}הפקת קובץ</button>
              <button type="button" class="gt-btn--sm" data-export-form-global="${f.code}">${icon('download')}חבילת נתונים</button>
            </td>
          </tr>`;
        }).join('')}</tbody></table></div>
        <p class="gt-header__sub">העלאת תבנית מקור ואז הפקה — ללא יצירת קבצים רשמיים במקום התבנית.</p>
      </div>`;
  }

  function readinessTab() {
    const list = programReadinessRows112(rows);
    const adminDone = administrativeCompleted(administrative());
    const inProgress = list.filter((x) => x.work_state === 'בתהליך').length;
    const pending = list.filter((x) => x.drafts > 0).length;
    const readyN = list.filter((x) => x.approved === x.total && x.total > 0).length;
    return `<div class="gt-toolbar">
      <strong>${list.length} תוכניות</strong>
      <span class="gt-badge gt-badge--info">בתהליך ${inProgress}</span>
      <span class="gt-badge gt-badge--warn">טיוטות ${pending}</span>
      <span class="gt-badge gt-badge--ok">תשובות מאושרות ${readyN}</span>
      <span class="gt-badge gt-badge--muted">מנהלי ${adminDone}/19</span>
    </div>
    <p class="gt-header__sub">מדד התשובות אינו שווה ערך לעמידה בתנאי סף.</p>
    <div class="gt-overflow"><table class="gt-table"><thead><tr>
      <th>תוכנית</th><th>תשובות מאושרות</th><th>תנאי סף</th><th>מפתחים</th><th>מפעילים</th>
      <th>ניסיון</th><th>המלצות</th><th>סילבוס</th><th>מסמכים</th><th>מצב עבודה</th>
    </tr></thead><tbody>${list.map((item) => {
      const id = item.row.id;
      return `<tr>
      <td>${esc(item.row.title)}</td>
      <td><span class="gt-progress"><span style="width:${item.progress_pct}%"></span></span> ${item.approved}/${item.total}
        ${item.missing ? `<button type="button" class="gt-btn--sm" data-goto-submission="${esc(id)}">${item.missing} חסרים</button>` : ''}</td>
      <td>${readyCell(item.statuses.threshold, { gotoSubmission: true, programId: id })}</td>
      <td>${readyCell(item.statuses.developers, { openSub: 'people', programId: id })}</td>
      <td>${readyCell(item.statuses.operators, { openSub: 'people', programId: id })}</td>
      <td>${readyCell(item.statuses.experience, { openSub: 'experience', programId: id })}</td>
      <td>${readyCell(item.statuses.recommendations, { openSub: 'experience', programId: id })}</td>
      <td>${readyCell(item.statuses.syllabus, { openSub: 'syllabus', programId: id })}</td>
      <td>${readyCell(item.statuses.documents, { openSub: 'documents', programId: id })}</td>
      <td>${statusBadge(item.work_state, item.work_state === 'תשובות מאושרות' ? 'ok' : 'info')}</td>
    </tr>`;
    }).join('') || '<tr><td colspan="10"><div class="gt-empty">אין תוכניות עם שיוך 112</div></td></tr>'}</tbody></table></div>`;
  }

  function renderQuestionInput(a, q) {
    const type = a.answer_type || q.answer_type || 'text';
    const choices = a.choices || q.choices;
    const extraLimited = limitAppliesToExtra({ ...q, ...a, number: a.number || q.number });
    const extraMax = extraLimited && a.limit ? ` maxlength="${Number(a.limit)}"` : '';
    const extraHint = extraLimited && a.limit
      ? `<small class="gt-count" data-extra-count>${String(q.answer_extra || '').length} / ${a.limit} תווים (טקסט משלים)</small>`
      : '';
    if (type === 'yes_no_text' || (choices && a.extra_text)) {
      return `<div class="gt-choice-row">${(choices || ['כן', 'לא']).map((c) =>
        `<label><input type="radio" name="qchoice" data-q-choice value="${esc(c)}"${String(q.answer || '') === c ? ' checked' : ''}>${esc(c)}</label>`
      ).join('')}</div>
      <textarea data-q-extra class="gt-ta--long" rows="4" placeholder="טקסט משלים"${extraMax}>${esc(q.answer_extra || '')}</textarea>${extraHint}`;
    }
    if (type === 'single_choice' && choices) {
      return `<div class="gt-choice-row">${choices.map((c) =>
        `<label><input type="radio" name="qchoice" data-q-choice value="${esc(c)}"${String(q.answer || '') === c ? ' checked' : ''}>${esc(c)}</label>`
      ).join('')}</div>`;
    }
    if (type === 'multi_choice' && choices) {
      const selectedVals = Array.isArray(q.answer) ? q.answer : String(q.answer || '').split(',').map((x) => x.trim()).filter(Boolean);
      return `<div class="gt-choice-row">${choices.map((c) =>
        `<label><input type="checkbox" data-q-multi value="${esc(c)}"${selectedVals.includes(c) ? ' checked' : ''}>${esc(c)}</label>`
      ).join('')}</div>`;
    }
    if (type === 'number' || /מספר/.test(String(a.requirements || ''))) {
      return `<input type="number" data-q-text value="${esc(q.answer || '')}" style="max-width:160px">`;
    }
    const long = !a.limit || a.limit > 200 || a.limit_words;
    return `<textarea data-q-text class="${long ? 'gt-ta--long' : ''}" rows="${long ? 6 : 3}">${esc(typeof q.answer === 'string' ? q.answer : answerText(q.answer))}</textarea>`;
  }

  function submissionTab() {
    const items = programsWith112(rows);
    const row = items.find((r) => r.id === submissionId) || items[0];
    if (row && !submissionId) submissionId = row.id;

    let h = `<div class="gt-toolbar">
      <label>תוכנית <select data-submission-select>
        <option value="">בחרו תוכנית</option>
        ${items.map((r) => `<option value="${esc(r.id)}"${r.id === (row?.id || '') ? ' selected' : ''}>${esc(r.payload?.number || '')} · ${esc(r.title)}</option>`).join('')}
      </select></label>`;
    if (!row) return `${h}</div><div class="gt-empty">אין תוכניות עם שיוך 112</div>`;

    const { index, association } = association112(row.payload || {});
    const questions = (association?.questions || []).map((q, j) => enrichQuestion112({ ...q, number: q.number ?? j + 1 }));
    const answers = buildSubmissionAnswers(row).filter((a) => a.code === BASKET_112 && !a.unmapped);
    const approved = answers.filter((a) => answerState(row, a) === 'ok').length;

    let filtered = answers.map((a, i) => ({ a, i }));
    if (filterQ === 'empty') filtered = filtered.filter(({ a }) => answerState(row, a) === 'empty');
    if (filterQ === 'draft') filtered = filtered.filter(({ a }) => answerState(row, a) === 'draft');
    if (filterQ === 'ok') filtered = filtered.filter(({ a }) => answerState(row, a) === 'ok');
    if (filterQ === 'over') filtered = filtered.filter(({ a }) => answerState(row, a) === 'over');
    if (searchQ) {
      const q = searchQ.trim().toLowerCase();
      filtered = filtered.filter(({ a }) => `${a.number || ''} ${a.label}`.toLowerCase().includes(q));
    }
    if (!filtered.length) filtered = answers.map((a, i) => ({ a, i }));
    if (questionIndex >= answers.length) questionIndex = 0;
    if (filtered.length && !filtered.some(({ i }) => i === questionIndex)) {
      questionIndex = filtered[0].i;
    }
    const current = answers[questionIndex] || filtered[0]?.a;
    const currentIdx = answers.indexOf(current);
    const qObj = questions[currentIdx] || enrichQuestion112({ label: current?.label, number: current?.number });

    h += `
      <strong>${approved} מתוך ${answers.length || 41}</strong>
      <span class="gt-header__sub">תשובות מאושרות</span>
      <span class="gt-progress" style="width:100px"><span style="width:${answers.length ? Math.round(100 * approved / answers.length) : 0}%"></span></span>
      <select data-filter-q>
        <option value="">כל המצבים</option>
        <option value="empty"${filterQ === 'empty' ? ' selected' : ''}>ריקות</option>
        <option value="draft"${filterQ === 'draft' ? ' selected' : ''}>טיוטה</option>
        <option value="ok"${filterQ === 'ok' ? ' selected' : ''}>מאושרות</option>
        <option value="over"${filterQ === 'over' ? ' selected' : ''}>חריגה</option>
      </select>
      <input type="search" data-search-q placeholder="חיפוש שאלה" value="${esc(searchQ)}">
      <button type="button" data-export-answers>יצוא מאושרות</button>
    </div>`;

    if (index < 0 || !questions.length) {
      return `${h}<div class="gt-empty">שאלון 112 לא נמצא ברשומה זו.</div>`;
    }

    const st = answerState(row, current);
    const limited = limitedAnswerText(current);
    const words = countWords(limited);
    const chars = String(limited || '').length;
    const overChars = current.limit && !withinLimit(limited, current.limit);
    const overWords = current.limit_words && !withinWordLimit(limited, current.limit_words);
    const hist = historicalForQuestion(row.payload?.historical_answers, current.question_id, current.label);
    const limitTarget = limitAppliesToExtra(current) ? 'טקסט משלים' : 'תשובה';

    const type = current.answer_type || qObj.answer_type || 'text';
    const showCount = !(type === 'single_choice' || type === 'multi_choice')
      || Boolean(current.extra_text) || type === 'yes_no_text'
      || Boolean(current.limit) || Boolean(current.limit_words);

    const nav = CHAPTERS_112.map((ch) => {
      const qs = answers.filter((a) => Number(a.number) >= ch.from && Number(a.number) <= ch.to);
      return `<div class="gt-qnav__chapter">${esc(ch.label)}</div>
        <div class="gt-qnav__grid">${qs.map((a) => {
          const i = answers.indexOf(a);
          const s = answerState(row, a);
          return `<button type="button" class="gt-qnav__num${i === currentIdx ? ' is-active' : ''}" data-q-goto="${i}" title="${esc(a.label)}">
            ${a.number}<span class="gt-qnav__dot gt-qnav__dot--${s === 'empty' ? '' : s}"></span>
          </button>`;
        }).join('')}</div>`;
    }).join('');

    const limitLabel = current.limit_words && current.limit
      ? `${chars} / ${current.limit} תווים · ${words} / ${current.limit_words} מילים (${limitTarget})`
      : current.limit_words
        ? `${words} / ${current.limit_words} מילים (${limitTarget})`
        : current.limit
          ? `${chars} / ${current.limit} תווים (${limitTarget})`
          : `${String(current.value || '').length} תווים · ${countWords(current.value)} מילים`;

    h += `<div class="gt-submit">
      <aside class="gt-qnav" aria-label="ניווט שאלות">${nav}</aside>
      <section class="gt-qwork">
        <div class="gt-qwork__head">
          <div>
            <h2 class="gt-qwork__title">${current.number}. ${esc(current.label)}</h2>
            <div class="gt-qwork__meta">${esc(current.chapter_label || '')}${current.limit || current.limit_words
              ? ` · מגבלה: ${[
                current.limit ? `${current.limit} תווים` : null,
                current.limit_words ? `${current.limit_words} מילים` : null,
                limitAppliesToExtra(current) ? 'על טקסט משלים' : null
              ].filter(Boolean).join(' · ')}` : ''}</div>
          </div>
          ${statusBadge(answerStateLabel(st), answerTone(st))}
        </div>
        <details class="gt-details gt-details--compact">
          <summary>דרישות ומידע משלים</summary>
          <div class="gt-details__body">
            ${requirementsBlockHtml(qObj, current)}
            ${(() => {
              const rk = relevantKnowledge(row.payload?.knowledge_items, current, row);
              const linkedN = rk.linked_to_question?.length || 0;
              const addN = rk.additional_program_knowledge?.length || 0;
              if (!linkedN && !addN) {
                return hist.length ? '' : '<p class="gt-header__sub">אין תשובה היסטורית ישירה ואין פריטי ידע רלוונטיים שזוהו לשאלה זו.</p>';
              }
              return `<p><strong>ידע רלוונטי במאגר:</strong> ${linkedN} משויכים ישירות · ${addN} נוספים לפי תוכן
                <span class="gt-badge gt-badge--muted">אינו תשובה מאושרת</span></p>
                <ul class="gt-compact-list">${[...(rk.linked_to_question || []), ...(rk.additional_program_knowledge || [])]
                  .slice(0, 6)
                  .map((k) => `<li><strong>${esc(k.title || k.type || '')}</strong> — ${esc(String(k.content || '').slice(0, 120))}${String(k.content || '').length > 120 ? '…' : ''}</li>`)
                  .join('')}</ul>`;
            })()}
            ${hist.length ? hist.map((x) => `<div class="gt-hist"><span class="gt-hist__tag">היסטורית ${esc(x.tender_year || '')} · אינה מאושרת ל־2027</span>
              <div>${esc(x.answer)}</div>
              <button type="button" class="gt-btn--sm" data-import-hist-text="${esc(x.answer)}">ייבוא לטיוטה</button>
            </div>`).join('') : '<p class="gt-header__sub">אין תשובה היסטורית ישירה לשאלה זו.</p>'}
          </div>
        </details>
        <div class="gt-answer-area" data-answer-block="${currentIdx}">
          ${renderQuestionInput(current, qObj)}
        </div>
        <div class="gt-toolbar">
          ${showCount ? `<span class="gt-count${overChars || overWords ? ' is-over' : ''}" data-answer-count>${limitLabel}${overChars || overWords ? ' · חריגה מהמגבלה' : ''}</span>` : '<span></span>'}
          <span data-gt-save-hint class="gt-header__sub"></span>
        </div>
        <div class="gt-q-actions">
          <button type="button" class="gt-btn--primary" data-context-preview="${currentIdx}">${icon('copy')}תצוגה מקדימה ל־ChatGPT</button>
        </div>
        ${contextPreview && contextPreview.idx === currentIdx ? `<div class="gt-panel gt-panel--preview">
          <div class="gt-panel__title">תצוגה מקדימה — חבילת נתונים ל־ChatGPT</div>
          <pre class="gt-preview-text">${esc(contextPreview.text.slice(0, 12000))}${contextPreview.text.length > 12000 ? '\n…' : ''}</pre>
          <div class="gt-toolbar">
            <button type="button" class="gt-btn--primary" data-context-copy="${currentIdx}">${icon('copy')}העתקה ללוח</button>
            <button type="button" data-context-preview-close>סגירה</button>
          </div>
        </div>` : ''}
        <div class="gt-q-actions">
          <button type="button" class="gt-btn--primary" data-save-answer="${currentIdx}">${icon('save')}שמירה</button>
          ${st === 'ok'
            ? `<button type="button" data-final-toggle="${currentIdx}">ביטול אישור</button>`
            : `<button type="button" data-final-toggle="${currentIdx}" ${!String(current.value || '').trim() || overChars || overWords ? 'disabled' : ''}>${icon('check')}אישור תשובה</button>`}
          <button type="button" data-final-copy="${currentIdx}" ${st === 'ok' ? '' : 'disabled'}>${icon('copy')}העתקת תשובה סופית</button>
        </div>
        <div class="gt-q-nav-btns">
          <button type="button" data-q-prev ${currentIdx <= 0 ? 'disabled' : ''}>${icon('chevR')}השאלה הקודמת</button>
          <button type="button" data-q-next ${currentIdx >= answers.length - 1 ? 'disabled' : ''}>השאלה הבאה${icon('chevL')}</button>
        </div>
      </section>
    </div>`;
    return h;
  }

  function draw() {
    if (!isAdmin() || !root.isConnected) return;
    let body = '';
    if (tab === 'administrative') body = adminTab();
    else if (tab === 'program') body = programDetail();
    else if (tab === 'operator') body = operatorTab();
    else if (tab === 'documents') body = documentsTab();
    else if (tab === 'readiness') body = readinessTab();
    else if (tab === 'submission') body = submissionTab();

    root.innerHTML = `<div class="gt" dir="rtl">
      ${headerHtml()}
      ${tabsHtml()}
      <p class="gt-status" data-gt-status role="status" aria-live="polite"></p>
      ${body}
    </div>`;
  }

  function scheduleAutosave() {
    dirty = true;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      const row = get();
      if (!row || !dirty || busy) return;
      if (row.kind === 'program') void saveViaRpc(row, collectProgramPayload(row));
      if (row.kind === 'operator') {
        const p = { ...row.payload };
        root.querySelectorAll('[data-field]').forEach((x) => { p[x.dataset.field] = x.value; });
        void saveViaRpc(row, p);
      }
    }, 1200);
  }

  function readCurrentAnswerValue() {
    const choice = root.querySelector('[data-q-choice]:checked');
    const multi = [...root.querySelectorAll('[data-q-multi]:checked')].map((x) => x.value);
    const text = root.querySelector('[data-q-text]');
    const extra = root.querySelector('[data-q-extra]');
    if (multi.length) return { answer: multi, answer_extra: '' };
    if (choice && extra) return { answer: choice.value, answer_extra: extra.value };
    if (choice) return { answer: choice.value, answer_extra: '' };
    if (text) return { answer: text.value, answer_extra: '' };
    return null;
  }

  function parseDocScope(scopeKey) {
    const parts = String(scopeKey || '').split(':');
    if (parts[0] === 'admin') return { kind: 'admin', id: parts[1], field: null };
    if (parts[0] === 'program') return { kind: 'program', id: parts[1], field: parts[2] || 'documents' };
    if (parts[0] === 'operator') return { kind: 'operator', id: parts[1] || selected, field: 'documents' };
    return { kind: parts[0], id: parts[1], field: parts[2] };
  }

  function docMetaForScope(scopeKey) {
    const { kind, id, field } = parseDocScope(scopeKey);
    if (kind === 'admin') {
      const n = Number(id);
      return {
        area: 'administrative',
        section_number: n,
        section_label: `${String(n).padStart(2, '0')} - ${ADMIN_SECTIONS[n - 1] || id}`,
        rule: fileRuleForArea('administrative', n)
      };
    }
    if (kind === 'program') {
      const program = rows.find((r) => r.id === id) || (get()?.id === id ? get() : null);
      return {
        area: field === 'recommendations_documents' ? 'recommendations'
          : field === 'experience_documents' ? 'experience'
            : field === 'syllabus_documents' ? 'syllabus'
              : field === 'documents' ? 'evidence' : 'program',
        field,
        program_id: program?.id,
        program_title: program?.title,
        recommendations_folder: RECOMMENDATION_FOLDER_BY_PROGRAM[program?.id] || program?.payload?.recommendations_folder_name,
        rule: fileRuleForArea(
          field === 'recommendations_documents' ? 'recommendations'
            : field === 'syllabus_documents' ? 'syllabus'
              : 'program'
        )
      };
    }
    if (kind === 'operator') {
      const operator = rows.find((r) => r.id === id) || get();
      return {
        area: 'operator',
        field: 'documents',
        person_name: operator?.title,
        program_title: operator?.title,
        rule: fileRuleForArea('operator')
      };
    }
    return { area: 'documents', rule: fileRuleForArea('documents') };
  }

  async function saveDocumentsForScope(scopeKey, docs) {
    const list = normalizeDocuments(docs);
    const { kind, id, field } = parseDocScope(scopeKey);
    if (kind === 'admin') {
      const a = administrative();
      if (!a) return false;
      const section = { ...(a.payload?.sections?.[id] || {}) };
      section.documents = list;
      section.url = primaryDocumentUrl(list) || '';
      return saveViaRpc(a, {
        ...a.payload,
        sections: { ...(a.payload?.sections || {}), [id]: section }
      });
    }
    if (kind === 'program') {
      const row = rows.find((r) => r.id === id);
      if (!row || row.kind !== 'program') return false;
      return saveViaRpc(row, { ...row.payload, [field]: list });
    }
    if (kind === 'operator') {
      const row = rows.find((r) => r.id === id);
      if (!row || row.kind !== 'operator') return false;
      return saveViaRpc(row, { ...row.payload, documents: list });
    }
    return false;
  }

  function currentDocsForScope(scopeKey) {
    const { kind, id, field } = parseDocScope(scopeKey);
    if (kind === 'admin') {
      const section = administrative()?.payload?.sections?.[id] || {};
      return normalizeDocuments(section.documents || section.url);
    }
    if (kind === 'program') {
      const row = rows.find((r) => r.id === id);
      return normalizeDocuments(row?.payload?.[field]);
    }
    if (kind === 'operator') {
      const row = rows.find((r) => r.id === id);
      return normalizeDocuments(row?.payload?.documents);
    }
    return [];
  }

  async function handleDocFiles(scopeKey, fileList, { replaceIndex = null } = {}) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const meta = docMetaForScope(scopeKey);
    const rule = meta.rule || fileRuleForArea(meta.area, meta.section_number);
    setStatus('מעלה ל־SharePoint...', '');
    try {
      let docs = currentDocsForScope(scopeKey);
      const uploaded = [];
      for (const file of files) {
        uploaded.push(await uploadGefenDocument(file, meta, rule));
      }
      if (replaceIndex != null && Number.isInteger(replaceIndex) && docs[replaceIndex]) {
        const previous = docs[replaceIndex];
        docs = docs.map((d, i) => (i === replaceIndex ? uploaded[0] : d));
        if (uploaded.length > 1) docs = docs.concat(uploaded.slice(1));
        if (previous?.item_id && previous.source === 'upload') {
          void gefenSharePointInvoke('delete', { item_id: previous.item_id }).catch(() => {});
        }
      } else if (rule.multiple === false) {
        docs = uploaded.slice(0, 1);
      } else {
        docs = docs.concat(uploaded);
      }
      if (await saveDocumentsForScope(scopeKey, docs)) {
        toast('המסמך נשמר ב־SharePoint');
        draw();
      }
    } catch (e) {
      setStatus(`העלאה נכשלה: ${e.message}`, 'err');
    }
  }

  function applyAnswerToPayload(row, answerIdx, valueObj) {
    const answers = buildSubmissionAnswers(row).filter((a) => a.code === BASKET_112 && !a.unmapped);
    const a = answers[answerIdx];
    if (!a) return null;
    const parts = a.key.split('.');
    const ai = Number(parts[1]);
    const qi = Number(parts[2]);
    const p = structuredClone(row.payload || {});
    p.associations = p.associations || [];
    p.associations[ai] = ensureAssociationQuestions(p.associations[ai] || { code: BASKET_112 });
    const q = { ...p.associations[ai].questions[qi] };
    if (valueObj) {
      q.answer = valueObj.answer;
      q.answer_extra = valueObj.answer_extra || '';
    }
    p.associations[ai].questions[qi] = q;
    const nextRow = { ...row, payload: p };
    const map = new Map(buildSubmissionAnswers(nextRow).map((x) => [x.key, x.value]));
    p.final_answers = reconcileFinalAnswers(p.final_answers, map);
    return { payload: p, answer: buildSubmissionAnswers({ ...row, payload: p }).find((x) => x.key === a.key) };
  }

  root.onclick = async (ev) => {
    const t = ev.target.closest('[data-tab],[data-select],[data-list-back],[data-admin-edit],[data-save-admin],[data-program-sub],[data-save-program],[data-save-operator],[data-goto-submission],[data-add-knowledge],[data-toggle-add-knowledge],[data-import-catalog],[data-import-historical],[data-import-knowledge-xlsx],[data-confirm-knowledge-import],[data-cancel-knowledge-import],[data-toggle-unassigned],[data-assign-knowledge],[data-save-k-related],[data-k-open],[data-context-preview],[data-context-preview-close],[data-context-copy],[data-final-copy],[data-final-toggle],[data-save-answer],[data-q-goto],[data-q-prev],[data-q-next],[data-export-answers],[data-export-form-global],[data-upload-template],[data-fill-template],[data-apply-catalog-112],[data-import-hist-text],[data-filter-admin],[data-filter-program],[data-doc-pick],[data-doc-link-add],[data-doc-unlink],[data-doc-replace],[data-exp-add],[data-exp-remove],[data-rec-add],[data-rec-remove],[data-syl-add],[data-syl-remove],[data-syl-move],[data-syl-toggle-edit],[data-syl-source-toggle],[data-knowledge-fill],[data-fill-apply-all],[data-fill-apply-selected],[data-fill-cancel],[data-pexp-add],[data-pexp-remove],[data-prec-add],[data-prec-remove],[data-docs-browse],[data-docs-root],[data-open-program-sub],[data-people-add],[data-filter-k-hist]');
    if (!t) return;

    if (t.matches('[data-tab]')) {
      if (!pendingLeave()) return;
      tab = t.dataset.tab;
      selected = '';
      draw();
      return;
    }
    if (t.matches('[data-select]')) {
      selected = t.dataset.select;
      const picked = rows.find((r) => r.id === selected);
      const hasSyl = picked?.kind === 'program'
        && normalizeSyllabusSessions(picked.payload?.syllabus_sessions).some((s) => s.topic || s.content);
      programSub = hasSyl ? 'syllabus' : 'details';
      syllabusEditMode = false;
      syllabusSourceOpen = false;
      knowledgeFillProposals = null;
      draw();
      return;
    }
    if (t.matches('[data-list-back]')) {
      if (!pendingLeave()) return;
      selected = '';
      draw();
      return;
    }
    if (t.matches('[data-open-program-sub]')) {
      const pid = t.dataset.programId || selected;
      const sub = t.dataset.openProgramSub;
      if (pid) selected = pid;
      if (sub) programSub = sub;
      tab = 'program';
      draw();
      return;
    }
    if (t.matches('[data-filter-k-hist]')) {
      const v = t.dataset.filterKHist;
      if (v === 'all' || v === 'current' || v === 'historical') knowledgeSourceFilter = v;
      if (t.dataset.programSub) programSub = t.dataset.programSub;
      draw();
      return;
    }
    if (t.matches('[data-program-sub]')) {
      programSub = t.dataset.programSub;
      draw();
      return;
    }
    if (t.matches('[data-goto-submission]')) {
      submissionId = t.dataset.gotoSubmission;
      tab = 'submission';
      questionIndex = 0;
      draw();
      return;
    }
    if (t.matches('[data-admin-edit]')) {
      const n = t.dataset.adminEdit;
      const panel = root.querySelector(`[data-admin-panel="${n}"]`);
      if (panel) panel.hidden = !panel.hidden;
      return;
    }
    if (t.matches('[data-doc-pick]')) {
      const input = root.querySelector(`[data-doc-file="${t.dataset.docPick}"]`);
      input?.click();
      return;
    }
    if (t.matches('[data-doc-replace]')) {
      const scope = t.dataset.docReplace;
      const input = root.querySelector(`[data-doc-file="${scope}"]`);
      if (input) {
        input.dataset.replaceIndex = t.dataset.docIndex;
        input.click();
      }
      return;
    }
    if (t.matches('[data-doc-unlink]')) {
      const scope = t.dataset.docUnlink;
      const idx = Number(t.dataset.docIndex);
      const docs = currentDocsForScope(scope);
      const removed = docs[idx];
      const next = docs.filter((_, i) => i !== idx);
      if (await saveDocumentsForScope(scope, next)) {
        if (removed?.item_id && removed.source === 'upload') {
          void gefenSharePointInvoke('delete', { item_id: removed.item_id }).catch(() => {});
        }
        toast('השיוך הוסר');
        draw();
      }
      return;
    }
    if (t.matches('[data-doc-link-add]')) {
      const scope = t.dataset.docLinkAdd;
      const url = root.querySelector(`[data-doc-link-url="${scope}"]`)?.value;
      const name = root.querySelector(`[data-doc-link-name="${scope}"]`)?.value;
      try {
        const linked = makeLinkedDocument(url, name);
        const docs = currentDocsForScope(scope).concat([linked]);
        if (await saveDocumentsForScope(scope, docs)) {
          toast('הקישור שויך');
          draw();
        }
      } catch (e) {
        setStatus(e.message, 'warn');
      }
      return;
    }
    if (t.matches('[data-save-admin]')) {
      const a = administrative();
      if (!a) return;
      const n = t.dataset.saveAdmin;
      const panel = root.querySelector(`[data-admin-panel="${n}"]`);
      const section = { ...(a.payload?.sections?.[n] || {}) };
      panel?.querySelectorAll('[data-a]').forEach((el) => { section[el.dataset.a] = el.value; });
      // Preserve documents; never auto-mark complete from upload alone.
      section.documents = normalizeDocuments(section.documents || section.url);
      section.url = primaryDocumentUrl(section.documents) || section.url || '';
      const payload = {
        ...a.payload,
        sections: { ...(a.payload?.sections || {}), [n]: section }
      };
      if (await saveViaRpc(a, payload)) draw();
      return;
    }
    if (t.matches('[data-save-program]')) {
      const row = get();
      if (row && await saveViaRpc(row, collectProgramPayload(row))) draw();
      return;
    }
    if (t.matches('[data-save-operator]')) {
      const row = get();
      if (!row) return;
      const p = { ...row.payload };
      root.querySelectorAll('[data-field]').forEach((x) => { p[x.dataset.field] = x.value; });
      if (p.cv_attached === 'כן') p.cv_attached = true;
      else if (p.cv_attached === 'לא') p.cv_attached = false;
      if (root.querySelector('[data-pexp-field]')) {
        const byId = new Map();
        root.querySelectorAll('[data-pexp-id][data-pexp-field]').forEach((el) => {
          const id = el.dataset.pexpId;
          if (!byId.has(id)) byId.set(id, { id });
          byId.get(id)[el.dataset.pexpField] = el.value;
        });
        p.person_experience_records = normalizePersonExperienceRecords([...byId.values()]);
      }
      if (root.querySelector('[data-prec-field]')) {
        const byId = new Map();
        root.querySelectorAll('[data-prec-id][data-prec-field]').forEach((el) => {
          const id = el.dataset.precId;
          if (!byId.has(id)) byId.set(id, { id });
          byId.get(id)[el.dataset.precField] = el.value;
        });
        p.person_recommenders = normalizePersonRecommenders([...byId.values()]);
      }
      if (await saveViaRpc(row, p)) draw();
      return;
    }
    if (t.matches('[data-knowledge-fill]')) {
      const row = get();
      if (!row) return;
      const synced = collectProgramPayload(row);
      row.payload = synced;
      knowledgeFillProposals = proposeProgramDetailFills(synced);
      if (!knowledgeFillProposals.length) {
        setStatus('אין הצעות לשדות ריקים על בסיס מאגר הידע', 'warn');
        toast('אין הצעות חדשות');
      }
      draw();
      return;
    }
    if (t.matches('[data-fill-cancel]')) {
      knowledgeFillProposals = null;
      draw();
      return;
    }
    if (t.matches('[data-fill-apply-all], [data-fill-apply-selected]')) {
      const row = get();
      if (!row || !knowledgeFillProposals?.length) return;
      const synced = collectProgramPayload(row);
      let selectedFields = null;
      if (t.matches('[data-fill-apply-selected]')) {
        selectedFields = [...root.querySelectorAll('[data-fill-pick]:checked')].map((el) => el.dataset.fillPick);
      }
      synced.details = applyDetailProposals(synced.details, knowledgeFillProposals, selectedFields);
      row.payload = synced;
      knowledgeFillProposals = null;
      dirty = true;
      toast('ההצעות הוחלו — יש לשמור');
      draw();
      return;
    }
    if (t.matches('[data-syl-toggle-edit]')) {
      const row = get();
      if (syllabusEditMode && row) {
        row.payload = collectProgramPayload(row);
        dirty = true;
      }
      syllabusEditMode = !syllabusEditMode;
      draw();
      return;
    }
    if (t.matches('[data-syl-source-toggle]')) {
      syllabusSourceOpen = !syllabusSourceOpen;
      draw();
      return;
    }
    if (t.matches('[data-pexp-add]')) {
      const row = get();
      if (!row) return;
      const list = normalizePersonExperienceRecords(row.payload?.person_experience_records);
      list.push(emptyPersonExperienceRecord());
      row.payload = { ...row.payload, person_experience_records: list };
      dirty = true;
      draw();
      return;
    }
    if (t.matches('[data-pexp-remove]')) {
      const row = get();
      if (!row) return;
      const id = t.dataset.pexpRemove;
      row.payload = {
        ...row.payload,
        person_experience_records: normalizePersonExperienceRecords(row.payload?.person_experience_records)
          .filter((r) => r.id !== id)
      };
      dirty = true;
      draw();
      return;
    }
    if (t.matches('[data-prec-add]')) {
      const row = get();
      if (!row) return;
      const list = normalizePersonRecommenders(row.payload?.person_recommenders);
      list.push(emptyPersonRecommender());
      row.payload = { ...row.payload, person_recommenders: list };
      dirty = true;
      draw();
      return;
    }
    if (t.matches('[data-prec-remove]')) {
      const row = get();
      if (!row) return;
      const id = t.dataset.precRemove;
      row.payload = {
        ...row.payload,
        person_recommenders: normalizePersonRecommenders(row.payload?.person_recommenders)
          .filter((r) => r.id !== id)
      };
      dirty = true;
      draw();
      return;
    }
    if (t.matches('[data-toggle-add-knowledge]')) {
      const form = root.querySelector('[data-add-knowledge-form]');
      if (form) form.hidden = !form.hidden;
      return;
    }
    if (t.matches('[data-k-open]')) {
      knowledgeOpen = knowledgeOpen === t.dataset.kOpen ? '' : t.dataset.kOpen;
      draw();
      return;
    }
    if (t.matches('[data-add-knowledge]')) {
      const row = get();
      if (!row) return;
      const item = createKnowledgeItem({
        title: root.querySelector('[data-k-title]')?.value,
        type: root.querySelector('[data-k-type]')?.value,
        topic: root.querySelector('[data-k-topic]')?.value,
        original_question: root.querySelector('[data-k-original-q]')?.value,
        content: root.querySelector('[data-k-content]')?.value,
        source: root.querySelector('[data-k-source]')?.value,
        source_url: root.querySelector('[data-k-url]')?.value,
        source_date: root.querySelector('[data-k-date]')?.value,
        verification_status: root.querySelector('[data-k-ver]')?.value,
        notes: root.querySelector('[data-k-notes]')?.value,
        program_id: row.id,
        assignment_status: 'assigned',
        intake_at: new Date().toISOString()
      });
      if (!item.content) { setStatus('נדרש תוכן', 'warn'); return; }
      if (await saveViaRpc(row, { knowledge_items: [item] }, 'append_knowledge')) {
        toast('נשמר');
        draw();
      }
      return;
    }
    if (t.matches('[data-import-catalog]')) {
      const row = get();
      if (!row) return;
      const items = knowledgeFromCatalog(row.payload?.details || {});
      if (!items.length) { setStatus('אין נתוני קטלוג לייבוא', 'warn'); return; }
      if (await saveViaRpc(row, { knowledge_items: items }, 'append_knowledge')) draw();
      return;
    }
    if (t.matches('[data-import-knowledge-xlsx]')) {
      root.querySelector('[data-knowledge-xlsx-file]')?.click();
      return;
    }
    if (t.matches('[data-cancel-knowledge-import]')) {
      importPreview = null;
      draw();
      return;
    }
    if (t.matches('[data-toggle-unassigned]')) {
      showUnassigned = !showUnassigned;
      knowledgeOpen = '';
      draw();
      return;
    }
    if (t.matches('[data-confirm-knowledge-import]')) {
      if (!importPreview) return;
      const admin = administrative();
      if (!admin) { setStatus('חסרה רשומה מנהלית', 'err'); return; }
      // Append assigned groups program-by-program, then unassigned on administrative
      for (const [programId, items] of Object.entries(importPreview.by_program || {})) {
        const prog = rows.find((r) => r.id === programId);
        if (!prog || !items.length) continue;
        const ok = await saveViaRpc(prog, { knowledge_items: items }, 'append_knowledge');
        if (!ok) return;
      }
      if ((importPreview.unassigned || []).length) {
        const mergedUnassigned = appendKnowledgeItems(
          admin.payload?.unassigned_knowledge_items || [],
          importPreview.unassigned
        );
        const payload = { ...admin.payload, unassigned_knowledge_items: mergedUnassigned };
        // Use save_payload so unassigned_knowledge_items persists without touching finals incorrectly
        const ok = await saveViaRpc(admin, payload, 'save_payload');
        if (!ok) return;
      }
      toast(`נקלטו ${importPreview.to_ingest} פריטים`);
      importPreview = null;
      draw();
      return;
    }
    if (t.matches('[data-assign-knowledge]')) {
      const admin = administrative();
      const itemId = t.dataset.assignKnowledge;
      const programId = root.querySelector(`[data-assign-program="${itemId}"]`)?.value;
      if (!admin || !programId) { setStatus('יש לבחור תוכנית', 'warn'); return; }
      const prog = rows.find((r) => r.id === programId);
      if (!prog) return;
      const moved = assignKnowledgeToProgram(
        admin.payload?.unassigned_knowledge_items || [],
        prog.payload?.knowledge_items || [],
        itemId,
        programId
      );
      const item = moved.programItems.find((x) => x.id === itemId);
      if (!item) return;
      if (!(await saveViaRpc(prog, { knowledge_items: [item] }, 'append_knowledge'))) return;
      const adminPayload = { ...admin.payload, unassigned_knowledge_items: moved.unassigned };
      if (!(await saveViaRpc(admin, adminPayload, 'save_payload'))) return;
      toast('שויך');
      draw();
      return;
    }
    if (t.matches('[data-save-k-related]')) {
      const itemId = t.dataset.saveKRelated;
      const raw = root.querySelector(`[data-k-related="${itemId}"]`)?.value || '';
      const related = raw.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
      if (showUnassigned) {
        const admin = administrative();
        if (!admin) return;
        const list = (admin.payload?.unassigned_knowledge_items || []).map((x) =>
          x.id === itemId ? { ...x, related_questions: related, updated_at: new Date().toISOString() } : x
        );
        if (await saveViaRpc(admin, { ...admin.payload, unassigned_knowledge_items: list }, 'save_payload')) {
          toast('נשמר');
          draw();
        }
        return;
      }
      const row = get();
      if (!row) return;
      const list = (row.payload?.knowledge_items || []).map((x) =>
        x.id === itemId ? { ...x, related_questions: related, updated_at: new Date().toISOString() } : x
      );
      if (await saveViaRpc(row, { ...row.payload, knowledge_items: list }, 'save_payload')) {
        toast('נשמר');
        draw();
      }
      return;
    }
    if (t.matches('[data-import-historical]')) {
      root.querySelector('[data-historical-file]')?.click();
      return;
    }
    if (t.matches('[data-q-goto]')) {
      questionIndex = Number(t.dataset.qGoto);
      draw();
      return;
    }
    if (t.matches('[data-q-prev]')) {
      questionIndex = Math.max(0, questionIndex - 1);
      draw();
      return;
    }
    if (t.matches('[data-q-next]')) {
      questionIndex += 1;
      draw();
      return;
    }
    if (t.matches('[data-context-preview]')) {
      const row = rows.find((r) => r.id === submissionId);
      if (!row) return;
      const answers = buildSubmissionAnswers(row).filter((a) => a.code === BASKET_112 && !a.unmapped);
      const idx = Number(t.dataset.contextPreview);
      const a = answers[idx];
      if (!a) return;
      contextPreview = { idx, text: buildContextPacket(row, a, rows) };
      draw();
      return;
    }
    if (t.matches('[data-context-preview-close]')) {
      contextPreview = null;
      draw();
      return;
    }
    if (t.matches('[data-context-copy]')) {
      const row = rows.find((r) => r.id === submissionId);
      if (!row) return;
      const answers = buildSubmissionAnswers(row).filter((a) => a.code === BASKET_112 && !a.unmapped);
      const a = answers[Number(t.dataset.contextCopy)];
      if (!a) return;
      const packet = (contextPreview && contextPreview.idx === Number(t.dataset.contextCopy))
        ? contextPreview.text
        : buildContextPacket(row, a, rows);
      await navigator.clipboard.writeText(packet);
      toast('הועתק');
      setStatus('הועתק', 'ok');
      contextPreview = null;
      draw();
      return;
    }
    if (t.matches('[data-final-copy]')) {
      const row = rows.find((r) => r.id === submissionId);
      const answers = buildSubmissionAnswers(row).filter((a) => a.code === BASKET_112 && !a.unmapped);
      const a = answers[Number(t.dataset.finalCopy)];
      if (!a || !isFinalAnswer(row.payload?.final_answers, a.key, a.value)) return;
      await navigator.clipboard.writeText(a.value);
      toast('הועתק');
      return;
    }
    if (t.matches('[data-save-answer]')) {
      const row = rows.find((r) => r.id === submissionId);
      if (!row) return;
      const val = readCurrentAnswerValue();
      const applied = applyAnswerToPayload(row, Number(t.dataset.saveAnswer), val);
      if (!applied) return;
      if (await saveViaRpc(row, applied.payload, 'set_answers')) draw();
      return;
    }
    if (t.matches('[data-final-toggle]')) {
      const row = rows.find((r) => r.id === submissionId);
      if (!row) return;
      const idx = Number(t.dataset.finalToggle);
      const val = readCurrentAnswerValue();
      const applied = applyAnswerToPayload(row, idx, val);
      if (!applied) return;
      const a = applied.answer;
      const approved = isFinalAnswer(applied.payload.final_answers, a.key, a.value);
      applied.payload.final_answers = approved
        ? revokeAnswer(applied.payload.final_answers, a.key)
        : approveAnswer(applied.payload.final_answers, a.key, a.value);
      if (await saveViaRpc(row, applied.payload, 'set_answers')) {
        toast(approved ? 'האישור בוטל' : 'אושר');
        draw();
      }
      return;
    }
    if (t.matches('[data-import-hist-text]')) {
      const ta = root.querySelector('[data-q-text], [data-q-extra]');
      if (ta) {
        ta.value = t.dataset.importHistText;
        dirty = true;
        setStatus('נדרש עדכון', 'warn');
      }
      return;
    }
    if (t.matches('[data-export-answers]')) {
      const row = rows.find((r) => r.id === submissionId);
      if (!row) return;
      const XLSX = await import('xlsx');
      const wb = await exportApprovedAnswersWorkbook(XLSX, row);
      downloadWorkbook(XLSX, wb, `gefen-112-approved-${row.payload?.number || row.id}.xlsx`);
      return;
    }
    if (t.matches('[data-export-form-global]')) {
      const row = programsWith112(rows)[0];
      if (!row) { setStatus('אין תוכנית לייצוא', 'warn'); return; }
      const XLSX = await import('xlsx');
      const { wb } = await exportOfficialFormPackage(XLSX, row, rows, { approvedOnly: false });
      downloadWorkbook(XLSX, wb, `form-${t.dataset.exportFormGlobal}-package.xlsx`);
      return;
    }
    if (t.matches('[data-upload-template]')) {
      const code = t.dataset.uploadTemplate;
      root.querySelector(`[data-template-file="${code}"]`)?.click();
      return;
    }
    if (t.matches('[data-fill-template]')) {
      const code = Number(t.dataset.fillTemplate);
      const admin = administrative();
      const stored = admin?.payload?.excel_templates?.[code];
      if (!admin || !stored?.base64) { setStatus('יש להעלות תבנית מקור תחילה', 'warn'); return; }
      const XLSX = await import('xlsx');
      const bin = Uint8Array.from(atob(stored.base64), (c) => c.charCodeAt(0));
      // Empty rows only — do not fill developers/operators/syllabus in this stage.
      const wb = fillTemplateWorkbook(XLSX, bin.buffer, stored.mapping || templateMeta(code).mapping, []);
      downloadWorkbook(XLSX, wb, `form-${code}-draft-empty.xlsx`);
      toast('הופק קובץ על בסיס התבנית (ללא מילוי נתונים)');
      return;
    }
    if (t.matches('[data-exp-add]')) {
      const row = get();
      if (!row) return;
      const synced = collectProgramPayload(row);
      synced.experience_records = normalizeExperienceRecords(synced.experience_records).concat([emptyExperienceRecord()]);
      row.payload = synced;
      dirty = true;
      draw();
      return;
    }
    if (t.matches('[data-exp-remove]')) {
      const row = get();
      if (!row) return;
      const synced = collectProgramPayload(row);
      const id = t.dataset.expRemove;
      synced.experience_records = normalizeExperienceRecords(synced.experience_records).filter((r) => r.id !== id);
      row.payload = synced;
      dirty = true;
      draw();
      return;
    }
    if (t.matches('[data-rec-add]')) {
      const row = get();
      if (!row) return;
      const synced = collectProgramPayload(row);
      synced.recommendation_records = normalizeRecommendationRecords(synced.recommendation_records).concat([emptyRecommendationRecord()]);
      row.payload = synced;
      dirty = true;
      draw();
      return;
    }
    if (t.matches('[data-rec-remove]')) {
      const row = get();
      if (!row) return;
      const synced = collectProgramPayload(row);
      const id = t.dataset.recRemove;
      synced.recommendation_records = normalizeRecommendationRecords(synced.recommendation_records).filter((r) => r.id !== id);
      row.payload = synced;
      dirty = true;
      draw();
      return;
    }
    if (t.matches('[data-syl-add]')) {
      const row = get();
      if (!row) return;
      const synced = collectProgramPayload(row);
      const list = normalizeSyllabusSessions(synced.syllabus_sessions);
      const stage = syllabusAge
        || inferAgeStageFromGrades(synced.grades || synced.details?.grades || '')
        || 'כללי';
      const same = list.filter((s) => s.age_stage === stage);
      list.push(emptySyllabusSession(stage, same.length + 1));
      synced.syllabus_sessions = list;
      row.payload = synced;
      dirty = true;
      draw();
      return;
    }
    if (t.matches('[data-syl-remove]')) {
      const row = get();
      if (!row) return;
      const synced = collectProgramPayload(row);
      const id = t.dataset.sylRemove;
      synced.syllabus_sessions = normalizeSyllabusSessions(synced.syllabus_sessions).filter((s) => s.id !== id);
      row.payload = synced;
      dirty = true;
      draw();
      return;
    }
    if (t.matches('[data-syl-move]')) {
      const row = get();
      if (!row) return;
      const synced = collectProgramPayload(row);
      const id = t.dataset.sylMove;
      const dir = t.dataset.dir || 'down';
      // Reorder within the active age-stage filter (or all when filter is empty).
      const all = normalizeSyllabusSessions(synced.syllabus_sessions);
      const stage = syllabusAge ? all.filter((s) => s.age_stage === syllabusAge) : all;
      const rest = syllabusAge ? all.filter((s) => s.age_stage !== syllabusAge) : [];
      synced.syllabus_sessions = [...rest, ...reorderSyllabusSessions(stage, id, dir)];
      row.payload = synced;
      dirty = true;
      draw();
      return;
    }
    if (t.matches('[data-people-add]')) {
      const row = get();
      if (!row) return;
      const id = t.dataset.peopleAdd;
      const ops = new Set(row.payload?.operator_ids || []);
      ops.add(id);
      row.payload = { ...row.payload, operator_ids: [...ops] };
      peoplePickerQ = '';
      dirty = true;
      draw();
      return;
    }
    if (t.matches('[data-docs-root]')) {
      setStatus('טוען תיקיית שורש...', '');
      try {
        const data = await gefenSharePointInvoke('list_root', {});
        docsListing = data;
        docsFolderPath = data?.folder_path || SP_ROOT;
        setStatus('הרשימה עודכנה', 'ok');
        draw();
      } catch (e) {
        setStatus(`עיון נכשל: ${e.message}`, 'err');
      }
      return;
    }
    if (t.matches('[data-docs-browse]')) {
      const folderPath = t.dataset.docsBrowse || '';
      setStatus('טוען תיקייה...', '');
      try {
        const data = await gefenSharePointInvoke('list', { folder_path: folderPath });
        docsListing = data;
        docsFolderPath = data?.folder_path || folderPath;
        setStatus('הרשימה עודכנה', 'ok');
        draw();
      } catch (e) {
        setStatus(`עיון נכשל: ${e.message}`, 'err');
      }
      return;
    }
        if (t.matches('[data-apply-catalog-112]')) {
      let ok = 0;
      for (const prog of programsWith112(rows)) {
        const { index, association } = association112(prog.payload);
        if (index < 0 || !association?.questions?.length) continue;
        const questions = applyCatalog112(association.questions);
        const associations = [...(prog.payload.associations || [])];
        associations[index] = { ...association, questions };
        const payload = {
          ...prog.payload,
          associations,
          thresholds_112: thresholdsPayload(prog.payload.thresholds_112),
          recommendations_folder_url: prog.payload.recommendations_folder_url
            || (RECOMMENDATION_FOLDER_BY_PROGRAM[prog.id]
              ? recommendationsFolderUrl(prog.id, prog.title) : prog.payload.recommendations_folder_url)
        };
        if (await saveViaRpc(prog, payload, 'save_payload')) ok += 1;
      }
      toast(`עודכן קטלוג 112 ב־${ok} תוכניות`);
      draw();
      return;
    }
  };

  root.onchange = (ev) => {
    const t = ev.target;
    if (t.matches('[data-doc-file]') && t.files?.length) {
      const scope = t.dataset.docFile;
      const replaceIndex = t.dataset.replaceIndex != null && t.dataset.replaceIndex !== ''
        ? Number(t.dataset.replaceIndex)
        : null;
      void handleDocFiles(scope, t.files, { replaceIndex });
      t.value = '';
      delete t.dataset.replaceIndex;
      return;
    }
    if (t.matches('[data-filter-admin]')) { filterAdmin = t.value; draw(); return; }
    if (t.matches('[data-search-admin]')) { searchAdmin = t.value; draw(); return; }
    if (t.matches('[data-filter-program]')) { filterProgram = t.value; draw(); return; }
    if (t.matches('[data-filter-validity]')) { filterValidity = t.value; draw(); return; }
    if (t.matches('[data-search-program]')) { searchProgram = t.value; draw(); return; }
    if (t.matches('[data-filter-operator]')) { filterOperator = t.value; draw(); return; }
    if (t.matches('[data-search-operator]')) { searchOperator = t.value; draw(); return; }
    if (t.matches('[data-search-knowledge]')) { searchKnowledge = t.value; draw(); return; }
    if (t.matches('[data-filter-k-type]')) { filterKnowledgeType = t.value; draw(); return; }
    if (t.matches('[data-filter-k-ver]')) { filterKnowledgeVer = t.value; draw(); return; }
    if (t.matches('[data-filter-k-topic]')) { filterKnowledgeTopic = t.value; draw(); return; }
    if (t.matches('[data-filter-k-hist]')) { knowledgeSourceFilter = t.value || 'all'; draw(); return; }
    if (t.matches('[data-syllabus-age]')) { syllabusAge = t.value || ''; draw(); return; }
    if (t.matches('[data-people-picker-q]')) { peoplePickerQ = t.value || ''; draw(); return; }
    if (t.matches('[data-knowledge-xlsx-file]') && t.files?.[0]) {
      const file = t.files[0];
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const XLSX = await import('xlsx');
          const programs = rows.filter((r) => r.kind === 'program');
          const existingByProgram = Object.fromEntries(
            programs.map((r) => [r.id, r.payload?.knowledge_items || []])
          );
          const catalogQuestions = (() => {
            for (const r of programs) {
              const a = (r.payload?.associations || []).find((x) => Number(x.code) === 112);
              if (a?.questions?.length) return a.questions;
            }
            return [];
          })();
          importPreview = planKnowledgeWorkbook(XLSX, reader.result, {
            programs,
            catalogQuestions,
            existingByProgram,
            existingUnassigned: administrative()?.payload?.unassigned_knowledge_items || []
          });
          setStatus(`תצוגה מקדימה: ${importPreview.to_ingest} לקליטה`, 'ok');
          draw();
        } catch (e) {
          setStatus(`ייבוא נכשל: ${e.message}`, 'err');
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }
    if (t.matches('[data-template-file]') && t.files?.[0]) {
      const code = Number(t.dataset.templateFile);
      const file = t.files[0];
      const admin = administrative();
      if (!admin) { setStatus('רשומת מנהל חסרה', 'warn'); return; }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const bytes = new Uint8Array(reader.result);
          let binary = '';
          bytes.forEach((b) => { binary += String.fromCharCode(b); });
          const base64 = btoa(binary);
          const excel_templates = {
            ...(admin.payload?.excel_templates || {}),
            [code]: {
              ...templateMeta(code, admin.payload?.excel_templates?.[code] || {}),
              file_name: file.name,
              uploaded_at: new Date().toISOString(),
              base64,
              mapping: templateMeta(code).mapping,
              mapping_verified: false
            }
          };
          // Keep base64 under a practical size for JSONB admin payload.
          if (base64.length > 2_500_000) {
            setStatus('הקובץ גדול מדי לשמירה במערכת — יש להשתמש בתבנית קלה יותר', 'warn');
            return;
          }
          if (await saveViaRpc(admin, { ...admin.payload, excel_templates }, 'save_payload')) {
            toast(`תבנית ${code} הועלתה`);
            draw();
          }
        } catch (e) {
          setStatus(`העלאת תבנית נכשלה: ${e.message}`, 'err');
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }
    if (t.matches('[data-submission-select]')) {
      submissionId = t.value;
      questionIndex = 0;
      draw();
      return;
    }
    if (t.matches('[data-filter-q]')) {
      filterQ = t.value;
      questionIndex = 0;
      draw();
      return;
    }
    if (t.matches('[data-search-q]')) {
      searchQ = t.value;
      questionIndex = 0;
      draw();
      return;
    }
    if (t.matches('[data-historical-file]') && t.files?.[0]) {
      const row = get();
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const items = parseHistoricalImport(String(reader.result || ''));
          if (row && await saveViaRpc(row, { historical_answers: items }, 'append_historical')) {
            // client-side merge if RPC rejects mode
            if (!(row.payload?.historical_answers || []).some((h) => h.id === items[0]?.id)) {
              row.payload = {
                ...row.payload,
                historical_answers: appendHistoricalAnswers(row.payload?.historical_answers, items)
              };
            }
            draw();
          } else if (row) {
            const payload = {
              ...row.payload,
              historical_answers: appendHistoricalAnswers(row.payload?.historical_answers, items)
            };
            if (await saveViaRpc(row, payload)) draw();
          }
        } catch (e) {
          setStatus(`ייבוא נכשל: ${e.message}`, 'err');
        }
      };
      reader.readAsText(t.files[0]);
      return;
    }
    if (t.matches('[data-field], [data-a], [data-q-text], [data-q-extra], [data-q-choice], [data-q-multi], [data-dev-id], [data-op-id], [data-exp-field], [data-rec-field], [data-syl-field], [data-pexp-field], [data-prec-field], [data-fill-pick]')) {
      scheduleAutosave();
      if (t.matches('[data-field]')) {
        const key = t.dataset.field;
        const counter = root.querySelector(`[data-count="${CSS.escape(key)}"]`);
        if (counter) {
          const lim = Number(counter.dataset.countLimit) || 0;
          counter.textContent = formatCount(String(t.value || '').length, lim);
          counter.classList.toggle('is-over', lim > 0 && String(t.value || '').length > lim);
        }
      }
      const count = root.querySelector('[data-answer-count]');
      if (count && (t.matches('[data-q-text]') || t.matches('[data-q-extra]'))) {
        const answers = submissionId
          ? buildSubmissionAnswers(rows.find((r) => r.id === submissionId) || {}).filter((a) => a.code === BASKET_112 && !a.unmapped)
          : [];
        const current = answers[questionIndex];
        const extraEl = root.querySelector('[data-q-extra]');
        const textEl = root.querySelector('[data-q-text]');
        const useExtra = current && limitAppliesToExtra(current) && extraEl;
        const text = useExtra
          ? (extraEl?.value || '')
          : (textEl?.value || extraEl?.value || '');
        const words = countWords(text);
        const lim = current?.limit;
        const wlim = current?.limit_words;
        const target = useExtra ? 'טקסט משלים' : 'תשובה';
        let label = lim && wlim
          ? `${text.length} / ${lim} תווים · ${words} / ${wlim} מילים (${target})`
          : lim
            ? `${text.length} / ${lim} תווים (${target})`
            : wlim
              ? `${words} / ${wlim} מילים (${target})`
              : `${text.length} תווים · ${words} מילים`;
        const over = (lim && text.length > lim) || (wlim && words > wlim);
        if (over) label += ' · חריגה מהמגבלה';
        count.textContent = label;
        count.classList.toggle('is-over', Boolean(over));
        const extraCount = root.querySelector('[data-extra-count]');
        if (extraCount && lim) extraCount.textContent = `${(extraEl?.value || '').length} / ${lim} תווים (טקסט משלים)`;
      }
    }
  };

  root.oninput = root.onchange;

  root.addEventListener('dragover', (ev) => {
    const zone = ev.target.closest('[data-doc-drop]');
    if (!zone) return;
    ev.preventDefault();
    zone.classList.add('is-dragover');
  });
  root.addEventListener('dragleave', (ev) => {
    const zone = ev.target.closest('[data-doc-drop]');
    if (zone) zone.classList.remove('is-dragover');
  });
  root.addEventListener('drop', (ev) => {
    const zone = ev.target.closest('[data-doc-drop]');
    if (!zone) return;
    ev.preventDefault();
    zone.classList.remove('is-dragover');
    void handleDocFiles(zone.dataset.docDrop, ev.dataTransfer?.files);
  });

  await waitForSupabaseAuthSession();
  const { data, error } = await supabase.from(TABLE).select('*').order('kind').order('title');
  if (error) {
    root.innerHTML = `<p role="alert">טעינה נכשלה: ${esc(error.message)}</p>`;
    return;
  }
  rows = data || [];
  // Ensure thresholds registry exists locally for 112 programs (non-destructive)
  for (const r of rows.filter((x) => x.kind === 'program')) {
    if (association112(r.payload || {}).index >= 0 && !r.payload?.thresholds_112) {
      r.payload = { ...r.payload, thresholds_112: thresholdsPayload(r.payload?.thresholds_112) };
    }
  }
  draw();
}

import './../styles/gefen-tender-2027.css';
import { supabase, waitForSupabaseAuthSession } from '../supabase-client.js';
import { state } from '../state.js';
import {
  ADMIN_SECTIONS, ADMIN_STATUSES, BASKETS, EXCEL_FORMS, GOOGLE_DRIVE_PROGRAMS,
  KNOWLEDGE_TYPES, PROGRAM_DETAIL_FIELDS, SHAREPOINT_BASE, SHAREPOINT_FOLDERS,
  TABLE, VERIFICATION_STATUSES
} from '../gefen-tender/constants.js';
import { buildContextPacket } from '../gefen-tender/context-packet.js';
import {
  approveAnswer, answerText, isFinalAnswer, reconcileFinalAnswers,
  revokeAnswer, withinLimit
} from '../gefen-tender/final-answers.js';
import {
  appendKnowledgeItems, assignKnowledgeToProgram, createKnowledgeItem, knowledgeFromCatalog
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
  enrichQuestion112, programsWith112, withinWordLimit
} from '../gefen-tender/questionnaire-112.js';
import { administrativeCompleted, programReadinessRows112 } from '../gefen-tender/readiness.js';
import { thresholdsPayload } from '../gefen-tender/thresholds-112.js';
import {
  downloadWorkbook, exportApprovedAnswersWorkbook, exportOfficialFormPackage, officialTemplateLink
} from '../gefen-tender/excel-forms.js';
import { templateMeta } from '../gefen-tender/excel-templates.js';

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
  const over = (a.limit && !withinLimit(a.value, a.limit))
    || (a.limit_words && !withinWordLimit(a.value, a.limit_words));
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
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || u.hostname;
  } catch {
    return String(url).slice(0, 28);
  }
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
      const rowsN = limit && limit > 400 ? 5 : 3;
      input = `<textarea rows="${rowsN}"${attr}${limit ? ` maxlength="${limit}"` : ''}>${esc(value)}</textarea>` +
        `<small class="gt-count" data-count="${esc(key)}">${String(value ?? '').length}${limit ? ` / ${limit}` : ''}</small>`;
    }
    return `<div class="gt-field"><label>${esc(label)}${limit ? ` (עד ${limit} תווים)` : ''}</label>${input}</div>`;
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
    p.developer_ids = [...root.querySelectorAll('[data-dev-id]:checked')].map((x) => x.value);
    p.operator_ids = [...root.querySelectorAll('[data-op-id]:checked')].map((x) => x.value);
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
        <td>${v.url
          ? `<a class="gt-doc-link" target="_blank" rel="noopener noreferrer" href="${esc(v.url)}">${icon('link')}${esc(shortUrlLabel(v.url))}</a>`
          : '<span class="gt-badge gt-badge--muted">טרם הוזן</span>'}</td>
        <td><button type="button" class="gt-btn--sm" data-admin-edit="${n}">${icon('edit')}עריכה</button></td>
      </tr>
      <tr data-admin-panel="${n}" hidden><td colspan="7">
        <div class="gt-panel">
          <div class="gt-grid-2">
            <div class="gt-field"><label>סטטוס</label><select data-a="status">${opts(ADMIN_STATUSES, v.status || ADMIN_STATUSES[0])}</select></div>
            ${file ? `<div class="gt-field"><label>תוקף</label><input data-a="expiry" type="date" value="${esc(v.expiry || '')}"></div>` : '<div></div>'}
            ${file ? `<div class="gt-field"><label>קישור למסמך</label><input data-a="url" type="url" value="${esc(v.url || '')}"></div>` : ''}
            <div class="gt-field"><label>קישור לתבנית</label><input data-a="template_url" type="url" value="${esc(v.template_url || '')}"></div>
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
    const topics = [...new Set((p.knowledge_items || []).map((i) => i.topic).filter(Boolean))];
    let items = filterKnowledgeItems(p.knowledge_items || [], {
      search: searchKnowledge,
      topic: filterKnowledgeTopic,
      type: filterKnowledgeType,
      verification: filterKnowledgeVer
    });
    if (showUnassigned) {
      items = filterKnowledgeItems(unassigned, {
        search: searchKnowledge,
        topic: filterKnowledgeTopic,
        type: filterKnowledgeType,
        verification: filterKnowledgeVer
      });
    }
    const programOptions = rows.filter((r) => r.kind === 'program')
      .map((r) => `<option value="${esc(r.id)}">${esc(r.title)}</option>`).join('');

    return `<div class="gt-toolbar">
      <input type="search" data-search-knowledge placeholder="חיפוש במאגר" value="${esc(searchKnowledge)}">
      <select data-filter-k-topic><option value="">כל הנושאים</option>${
        topics.map((t) => `<option value="${esc(t)}"${filterKnowledgeTopic === t ? ' selected' : ''}>${esc(t)}</option>`).join('')
      }</select>
      <select data-filter-k-type><option value="">כל הסוגים</option>${opts(KNOWLEDGE_TYPES, filterKnowledgeType)}</select>
      <select data-filter-k-ver><option value="">כל הסטטוסים</option>${opts(VERIFICATION_STATUSES, filterKnowledgeVer)}</select>
      <button type="button" class="gt-btn--primary gt-btn--sm" data-toggle-add-knowledge>${icon('edit')}הוספת מידע</button>
      <button type="button" class="gt-btn--sm" data-import-catalog>ייבוא מקטלוג</button>
      <button type="button" class="gt-btn--sm" data-import-knowledge-xlsx>${icon('upload')}ייבוא Excel</button>
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-knowledge-xlsx-file hidden>
      <button type="button" class="gt-btn--sm" data-toggle-unassigned aria-current="${showUnassigned}">
        ממתינים לשיוך (${unassigned.length})
      </button>
      <strong>${items.length} פריטים</strong>
    </div>
    <p class="gt-header__sub">מאגר ידע מצטבר בלבד — אינו תשובה מאושרת להגשה 2027.</p>
    ${importPreview ? `<div class="gt-panel">
      <div class="gt-panel__title">תצוגה מקדימה לייבוא</div>
      <p>גיליון: ${esc(importPreview.sheet)} · שורות: ${importPreview.total_rows} · לקליטה: ${importPreview.to_ingest}
        · משויכים: ${importPreview.assigned_count} · ממתינים: ${importPreview.pending_count}
        · כפילויות שנמנעו: ${importPreview.duplicates_skipped}</p>
      <small>גיליונות תוכנית הם תצוגות בלבד ולא נקלטות בנפרד.</small>
      <div class="gt-toolbar" style="margin-top:8px">
        <button type="button" class="gt-btn--primary" data-confirm-knowledge-import>קליטת המידע</button>
        <button type="button" data-cancel-knowledge-import>ביטול</button>
      </div>
    </div>` : ''}
    ${!items.length
      ? `<div class="gt-empty">${showUnassigned ? 'אין פריטים ממתינים לשיוך.' : 'טרם נוסף מידע.'}
button type="button" class="gt-btn--primary gt-btn--sm" data-toggle-add-knowledge>הוספת מידע</button></div>`
      : `<div class="gt-overflow"><table class="gt-table"><thead><tr>
          <th>כותרת / שאלה</th><th>נושא</th><th>סוג</th><th>תקציר</th><th>מקור</th><th>שיוך 112</th><th>סטטוס</th><th></th>
        </tr></thead><tbody>${items.map((item) => {
          const open = knowledgeOpen === item.id;
          return `<tr>
            <td>${esc(item.original_question || item.title || '—')}</td>
            <td>${esc(item.topic || '—')}</td>
            <td>${esc(item.info_kind || item.type || '—')}</td>
            <td>${esc(String(item.content || '').slice(0, 80))}${String(item.content || '').length > 80 ? '…' : ''}</td>
            <td>${esc(String(item.source || '').slice(0, 40) || '—')}</td>
            <td>${esc((item.related_questions || []).join(', ') || '—')}</td>
            <td>${statusBadge(item.verification_status || 'לא אומת', item.verification_status === 'אומת' ? 'ok' : 'muted')}</td>
            <td><button type="button" class="gt-btn--sm" data-k-open="${esc(item.id)}">${open ? 'סגירה' : 'פתיחה'}</button></td>
          </tr>${open ? `<tr><td colspan="8"><div class="gt-panel">
            ${item.original_question ? `<p><strong>שאלה במקור:</strong> ${esc(item.original_question)}</p>` : ''}
            <pre style="white-space:pre-wrap;margin:0;font:inherit">${esc(item.content)}</pre>
            <p class="gt-header__sub">${esc(item.source || '')}</p>
            ${item.control_notes ? `<p class="gt-header__sub">בקרה: ${esc(item.control_notes)}</p>` : ''}
            <div class="gt-field"><label>שיוך לשאלות 112 (מופרד בפסיקים, לדוגמה 112.13,112.14)</label>
              <input data-k-related="${esc(item.id)}" value="${esc((item.related_questions || []).join(','))}">
            </div>
            <div class="gt-toolbar">
              <button type="button" class="gt-btn--sm" data-save-k-related="${esc(item.id)}">שמירת שיוך שאלות</button>
              ${showUnassigned ? `<label>שיוך לתוכנית
                <select data-assign-program="${esc(item.id)}"><option value="">בחרו</option>${programOptions}</select>
              </label>
              <button type="button" class="gt-btn--primary gt-btn--sm" data-assign-knowledge="${esc(item.id)}">שיוך</button>` : ''}
            </div>
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
    return `<div class="gt-toolbar">
      <strong>תשובות היסטוריות</strong>
      <button type="button" class="gt-btn--primary gt-btn--sm" data-import-historical>${icon('upload')}ייבוא מידע</button>
      <input type="file" accept="application/json,.json" data-historical-file hidden>
    </div>
    ${!items.length
      ? '<div class="gt-empty">טרם יובאו תשובות היסטוריות.</div>'
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
      body = `<p class="gt-header__sub">מספר: ${esc(p.number ?? 'תוכנית חדשה')} · סל מענים: 1</p>
        <div class="gt-grid-2">${PROGRAM_DETAIL_FIELDS.map(([k, l, lim, choices, multi]) =>
          field(k, l, p.details?.[k] ?? (k === 'name' ? row.title : ''), lim, choices, multi)
        ).join('')}</div>
        <div class="gt-panel"><div class="gt-panel__title">שיוכים</div>
          ${(p.associations || []).map((raw) => {
            const assoc = ensureAssociationQuestions(raw);
            return `<div style="margin-bottom:8px"><strong>${assoc.code} – ${esc(BASKETS[assoc.code] || '')}</strong>
              ${statusBadge(assoc.status || '—', 'info')} ${esc(assoc.validity || '')}
              · מיפוי: ${assoc.mapping_verified === true ? statusBadge('אומת', 'ok') : statusBadge('טרם אומת', 'muted')}
              ${assoc.code === BASKET_112 && assoc.questions?.length ? ` · ${assoc.questions.length} שאלות` : ''}
              ${assoc.mapping_note ? `<div class="gt-header__sub">${esc(assoc.mapping_note)}</div>` : ''}
            </div>`;
          }).join('') || '<div class="gt-empty">אין שיוכים</div>'}
        </div>`;
    } else if (programSub === 'knowledge') {
      body = knowledgePanel(p);
    } else if (programSub === 'historical') {
      body = historicalPanel(p);
    } else if (programSub === 'experience') {
      body = field('experience', 'ניסיון בהפעלה', p.experience || '')
        + field('recommendations', 'המלצות', p.recommendations || '');
    } else if (programSub === 'people') {
      const people = rows.filter((r) => r.kind === 'operator');
      const dev = new Set(p.developer_ids || []);
      const ops = new Set(p.operator_ids || []);
      body = field('developers', 'מפתחים (טקסט חופשי)', p.developers || '')
        + field('operators', 'מפעילים (טקסט חופשי)', p.operators || '')
        + `<div class="gt-overflow"><table class="gt-table"><thead><tr><th>שם</th><th>מפתח</th><th>מפעיל</th><th>הכשרה</th></tr></thead><tbody>
          ${people.map((r) => `<tr>
            <td>${esc(r.title)}</td>
            <td><input type="checkbox" data-dev-id value="${esc(r.id)}"${dev.has(r.id) ? ' checked' : ''}></td>
            <td><input type="checkbox" data-op-id value="${esc(r.id)}"${ops.has(r.id) ? ' checked' : ''}></td>
            <td>${esc(r.payload?.training_hours != null ? `${r.payload.training_hours} שעות` : 'טרם הוזן')}</td>
          </tr>`).join('') || '<tr><td colspan="4"><div class="gt-empty">אין רשומות במאגר</div></td></tr>'}
        </tbody></table></div>`;
    } else if (programSub === 'syllabus') {
      body = field('syllabus', 'סילבוס / תוכנית למידה', p.syllabus || '');
    } else {
      body = field('drive_folder_url', 'תיקיית Google Drive', p.drive_folder_url || '')
        + `<p><a target="_blank" rel="noopener noreferrer" href="${GOOGLE_DRIVE_PROGRAMS}">תיקיית תוכניות תעשיידע</a></p>`
        + field('sharepoint_notes', 'מסמכי SharePoint / קישורים', p.sharepoint_notes || '')
        + field('source_notes', 'מקורות ואסמכתאות', p.source_notes || '');
    }

    return `<div class="gt-toolbar">
      <button type="button" data-list-back>${icon('chevR')}חזרה לרשימה</button>
      <strong style="font-size:18px;font-weight:600">${esc(row.title)}</strong>
      <span class="gt-header__sub">#${esc(p.number ?? '—')} · שיוך ${a112.association ? BASKET_112 : '—'}</span>
      ${a112.association ? statusBadge(a112.association.status || '—', 'info') : ''}
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
      return `<div class="gt-toolbar">
        <button type="button" data-list-back>${icon('chevR')}חזרה</button>
        <strong style="font-size:18px">${esc(row.title)}</strong>
        <button type="button" class="gt-btn--primary" data-save-operator>${icon('save')}שמירה</button>
      </div>
      <div class="gt-subnav">
        <span class="gt-badge gt-badge--muted">פרטים כלליים</span>
      </div>
      <div class="gt-grid-2">
        ${field('roles', 'תפקיד / תפקידים', p.roles || '')}
        ${field('education', 'השכלה', p.education || '')}
        ${field('degrees', 'תארים', p.degrees || '')}
        ${field('training', 'הכשרות', p.training || '')}
        ${field('training_hours', 'שעות הכשרה', p.training_hours ?? '')}
        ${field('experience', 'ניסיון', p.experience || '')}
        ${field('teaching_experience', 'ניסיון הוראה', p.teaching_experience || '')}
        ${field('development_experience', 'ניסיון פיתוח', p.development_experience || '')}
        ${field('recommenders', 'ממליצים', p.recommenders || '')}
        ${field('cv_url', 'קישור לקורות חיים', p.cv_url || '')}
        ${field('documents', 'מסמכים', p.documents || '')}
        ${field('eligibility', 'התאמה לתנאי סף (תיעוד)', p.eligibility || '')}
        ${field('verification_status', 'סטטוס בדיקה', p.verification_status || '', 0, ['טרם נבדק', 'בתהליך', 'נבדק', 'חסרות אסמכתאות'])}
        ${field('verified_sources', 'מקורות אימות', p.verified_sources || '')}
      </div>
      <p class="gt-header__sub">חוסר במידע אינו מסומן ככישלון או כאי־התאמה לתנאי הסף.</p>`;
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
    const groups = [
      ['מסמכי מכרז', SHAREPOINT_FOLDERS.slice(0, 1)],
      ['תבניות רשמיות', SHAREPOINT_FOLDERS.slice(1, 2)],
      ['מסמכים ארגוניים', SHAREPOINT_FOLDERS.slice(2, 3)],
      ['חומרי תוכניות', SHAREPOINT_FOLDERS.slice(3, 5)],
      ['מסמכי מפתחים ומפעילים', SHAREPOINT_FOLDERS.slice(5, 7)],
      ['מסמכי הגשה', SHAREPOINT_FOLDERS.slice(9, 11)]
    ];
    return `<div class="gt-toolbar"><strong>מנהל מסמכים</strong>
      <a class="gt-doc-link" target="_blank" rel="noopener noreferrer" href="${SHAREPOINT_BASE}">${icon('folder')}שורש SharePoint</a></div>
      ${groups.map(([title, folders]) => `<div class="gt-panel">
        <div class="gt-panel__title">${esc(title)}</div>
        <div class="gt-overflow"><table class="gt-table"><thead><tr>
          <th></th><th>שם</th><th>מקור</th><th>סטטוס</th><th>פעולות</th>
        </tr></thead><tbody>${folders.map((f) => `<tr>
          <td>${fileIcon('folder')}</td>
          <td>${esc(f)}</td>
          <td>SharePoint</td>
          <td>${statusBadge('זמין', 'info')}</td>
          <td>${link(f, 'פתיחה')}</td>
        </tr>`).join('')}</tbody></table></div>
      </div>`).join('')}
      <div class="gt-panel">
        <div class="gt-panel__title">טפסים 159 / 160 / 174</div>
        <div class="gt-overflow"><table class="gt-table"><thead><tr>
          <th></th><th>טופס</th><th>מקור</th><th>סטטוס</th><th>פעולות</th>
        </tr></thead><tbody>${EXCEL_FORMS.filter((f) => [159, 160, 174].includes(f.code)).map((f) => {
          const meta = templateMeta(f.code, {});
          const ready = Boolean(meta.sharepoint_url || meta.storage_path);
          return `<tr>
            <td>${fileIcon(f.file)}</td>
            <td>${f.code} – ${esc(f.title)}</td>
            <td>תבנית רשמית</td>
            <td>${ready ? statusBadge('תבנית זמינה', 'ok') : statusBadge('טרם הועלתה תבנית', 'muted')}</td>
            <td>
              <a class="gt-btn--sm" style="display:inline-flex" target="_blank" rel="noopener noreferrer" href="${officialTemplateLink(f)}">${icon('link')}תבנית מקור</a>
              <button type="button" class="gt-btn--sm" data-export-form-global="${f.code}" ${ready ? '' : 'title="מילוי זמין לאחר העלאת תבנית"'}>${icon('download')}חבילת נתונים</button>
            </td>
          </tr>`;
        }).join('')}</tbody></table></div>
        <p class="gt-header__sub">אין לייצר קבצי Excel רשמיים במקום התבניות. פעולות מילוי/הורדה סופית זמינות רק לאחר העלאת תבנית מקור.</p>
      </div>`;
  }

  function readinessTab() {
    const list = programReadinessRows112(rows);
    const adminDone = administrativeCompleted(administrative());
    const inProgress = list.filter((x) => x.work_state === 'בתהליך').length;
    const pending = list.filter((x) => x.drafts > 0).length;
    const ready = list.filter((x) => x.approved === x.total && x.total > 0).length;
    return `<div class="gt-toolbar">
      <strong>${list.length} תוכניות</strong>
      <span class="gt-badge gt-badge--info">בתהליך ${inProgress}</span>
      <span class="gt-badge gt-badge--warn">טיוטות ${pending}</span>
      <span class="gt-badge gt-badge--ok">תשובות מאושרות ${ready}</span>
      <span class="gt-badge gt-badge--muted">מנהלי ${adminDone}/19</span>
      <small>אחוז מילוי אינו שווה ערך לעמידה בתנאי סף</small>
    </div>
    <div class="gt-overflow"><table class="gt-table"><thead><tr>
      <th>תוכנית</th><th>תשובות מאושרות מתוך 41</th><th>תנאי סף</th><th>מפתחים</th><th>מפעילים</th>
      <th>ניסיון</th><th>המלצות</th><th>סילבוס</th><th>מסמכים</th><th>מצב עבודה</th>
    </tr></thead><tbody>${list.map((item) => `<tr class="gt-row--clickable" data-goto-submission="${esc(item.row.id)}">
      <td>${esc(item.row.title)}</td>
      <td><span class="gt-progress"><span style="width:${item.progress_pct}%"></span></span> ${item.approved}/${item.total}
        ${item.missing ? `<button type="button" class="gt-btn--sm" data-goto-submission="${esc(item.row.id)}">${item.missing} חסרים</button>` : ''}</td>
      <td>${statusBadge(item.statuses.threshold, item.statuses.threshold === 'נבדק' ? 'ok' : 'muted')}</td>
      <td>${statusBadge(item.statuses.developers, item.statuses.developers === 'הוזן' ? 'info' : 'muted')}</td>
      <td>${statusBadge(item.statuses.operators, item.statuses.operators === 'הוזן' ? 'info' : 'muted')}</td>
      <td>${statusBadge(item.statuses.experience, item.statuses.experience === 'הוזן' ? 'info' : 'muted')}</td>
      <td>${statusBadge(item.statuses.recommendations, item.statuses.recommendations === 'הוזן' ? 'info' : 'muted')}</td>
      <td>${statusBadge(item.statuses.syllabus, item.statuses.syllabus === 'הוזן' ? 'info' : 'muted')}</td>
      <td>${statusBadge(item.statuses.documents, item.statuses.documents === 'הוזן' ? 'info' : 'muted')}</td>
      <td>${statusBadge(item.work_state, item.work_state === 'תשובות מאושרות' ? 'ok' : 'info')}</td>
    </tr>`).join('') || '<tr><td colspan="10"><div class="gt-empty">אין תוכניות עם שיוך 112</div></td></tr>'}</tbody></table></div>`;
  }

  function renderQuestionInput(a, q) {
    const type = a.answer_type || q.answer_type || 'text';
    const choices = a.choices || q.choices;
    if (type === 'yes_no_text' || (choices && a.extra_text)) {
      return `<div class="gt-choice-row">${(choices || ['כן', 'לא']).map((c) =>
        `<label><input type="radio" name="qchoice" data-q-choice value="${esc(c)}"${String(q.answer || '') === c ? ' checked' : ''}>${esc(c)}</label>`
      ).join('')}</div>
      <textarea data-q-extra class="gt-ta--long" rows="4" placeholder="טקסט משלים">${esc(q.answer_extra || '')}</textarea>`;
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
    const current = answers[questionIndex] || filtered[0]?.a;
    const currentIdx = answers.indexOf(current);
    const qObj = questions[currentIdx] || enrichQuestion112({ label: current?.label, number: current?.number });

    h += `
      <span class="gt-header__sub">#${esc(row.payload?.number ?? '—')}</span>
      <strong>${approved} / ${answers.length || 41} מאושרות</strong>
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
    const words = countWords(current.value);
    const chars = String(current.value || '').length;
    const overChars = current.limit && !withinLimit(current.value, current.limit);
    const overWords = current.limit_words && !withinWordLimit(current.value, current.limit_words);
    const hist = historicalForQuestion(row.payload?.historical_answers, current.question_id, current.label);

    const nav = CHAPTERS_112.map((ch) => {
      const qs = answers.filter((a) => Number(a.number) >= ch.from && Number(a.number) <= ch.to);
      return `<div class="gt-qnav__chapter">${esc(ch.label)}</div>${qs.map((a) => {
        const i = answers.indexOf(a);
        const s = answerState(row, a);
        return `<button type="button" class="gt-qnav__item${i === currentIdx ? ' is-active' : ''}" data-q-goto="${i}">
          <span class="gt-qnav__dot gt-qnav__dot--${s === 'empty' ? '' : s}"></span>
          <span>${a.number}. ${esc(String(a.label).slice(0, 42))}${String(a.label).length > 42 ? '…' : ''}</span>
        </button>`;
      }).join('')}`;
    }).join('');

    const limitLabel = current.limit_words
      ? `${words} / ${current.limit_words} מילים`
      : current.limit
        ? `${chars} / ${current.limit} תווים`
        : `${chars} תווים · ${words} מילים`;

    h += `<div class="gt-submit">
      <aside class="gt-qnav" aria-label="ניווט שאלות">${nav}</aside>
      <section class="gt-qwork">
        <div class="gt-qwork__head">
          <div>
            <h2 class="gt-qwork__title">${current.number}. ${esc(current.label)}</h2>
            <div class="gt-qwork__meta">${esc(current.chapter_label || '')}${current.limit || current.limit_words
              ? ` · מגבלה: ${current.limit_words ? `${current.limit_words} מילים` : `${current.limit} תווים`}` : ''}</div>
          </div>
          ${statusBadge(answerStateLabel(st), answerTone(st))}
        </div>
        <details class="gt-details">
          <summary>דרישות ומידע משלים</summary>
          <div class="gt-details__body">
            <p><strong>דרישות:</strong> ${esc(qObj.requirements || current.requirements || 'לא צוינו')}</p>
            <p><strong>תנאים:</strong> ${esc(qObj.threshold_conditions || current.conditions || '—')}</p>
            <p><strong>קריטריונים:</strong> ${esc(qObj.professional_criteria || current.criteria || '—')}</p>
            <p><strong>מסמכים:</strong> ${esc(qObj.attachments || current.attachments || '—')}</p>
            <p><strong>מקור:</strong> ${esc(qObj.source || current.source || '—')}</p>
            ${hist.length ? hist.map((x) => `<div class="gt-hist"><span class="gt-hist__tag">היסטורית ${esc(x.tender_year || '')} · אינה מאושרת ל־2027</span>
              <div>${esc(x.answer)}</div>
              <button type="button" class="gt-btn--sm" data-import-hist-text="${esc(x.answer)}">ייבוא לטיוטה</button>
            </div>`).join('') : '<p>אין תשובות היסטוריות לשאלה זו.</p>'}
          </div>
        </details>
        <div class="gt-q-actions">
          <button type="button" class="gt-btn--primary" data-context-copy="${currentIdx}">${icon('copy')}העתקת נתונים ל־ChatGPT</button>
        </div>
        <div class="gt-answer-area" data-answer-block="${currentIdx}">
          ${renderQuestionInput(current, qObj)}
        </div>
        <div class="gt-toolbar">
          <span class="gt-count${overChars || overWords ? ' is-over' : ''}" data-answer-count>${limitLabel}${overChars || overWords ? ' · חריגה מהמגבלה' : ''}</span>
          <span data-gt-save-hint class="gt-header__sub"></span>
        </div>
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
    const t = ev.target.closest('[data-tab],[data-select],[data-list-back],[data-admin-edit],[data-save-admin],[data-program-sub],[data-save-program],[data-save-operator],[data-goto-submission],[data-add-knowledge],[data-toggle-add-knowledge],[data-import-catalog],[data-import-historical],[data-import-knowledge-xlsx],[data-confirm-knowledge-import],[data-cancel-knowledge-import],[data-toggle-unassigned],[data-assign-knowledge],[data-save-k-related],[data-k-open],[data-context-copy],[data-final-copy],[data-final-toggle],[data-save-answer],[data-q-goto],[data-q-prev],[data-q-next],[data-export-answers],[data-export-form-global],[data-import-hist-text],[data-filter-admin],[data-filter-program]');
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
      programSub = 'details';
      draw();
      return;
    }
    if (t.matches('[data-list-back]')) {
      if (!pendingLeave()) return;
      selected = '';
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
    if (t.matches('[data-save-admin]')) {
      const a = administrative();
      if (!a) return;
      const n = t.dataset.saveAdmin;
      const panel = root.querySelector(`[data-admin-panel="${n}"]`);
      const section = { ...(a.payload?.sections?.[n] || {}) };
      panel?.querySelectorAll('[data-a]').forEach((el) => { section[el.dataset.a] = el.value; });
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
      if (await saveViaRpc(row, p)) draw();
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
    if (t.matches('[data-context-copy]')) {
      const row = rows.find((r) => r.id === submissionId);
      if (!row) return;
      const answers = buildSubmissionAnswers(row).filter((a) => a.code === BASKET_112 && !a.unmapped);
      const a = answers[Number(t.dataset.contextCopy)];
      if (!a) return;
      const packet = buildContextPacket(row, a, rows);
      await navigator.clipboard.writeText(packet);
      toast('הועתק');
      setStatus('הועתק', 'ok');
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
  };

  root.onchange = (ev) => {
    const t = ev.target;
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
    if (t.matches('[data-submission-select]')) {
      submissionId = t.value;
      questionIndex = 0;
      draw();
      return;
    }
    if (t.matches('[data-filter-q]')) { filterQ = t.value; draw(); return; }
    if (t.matches('[data-search-q]')) { searchQ = t.value; draw(); return; }
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
    if (t.matches('[data-field], [data-a], [data-q-text], [data-q-extra], [data-q-choice], [data-q-multi], [data-dev-id], [data-op-id]')) {
      scheduleAutosave();
      const count = root.querySelector('[data-answer-count]');
      if (count && (t.matches('[data-q-text]') || t.matches('[data-q-extra]'))) {
        const text = [root.querySelector('[data-q-choice]:checked')?.value, root.querySelector('[data-q-extra]')?.value || root.querySelector('[data-q-text]')?.value]
          .filter(Boolean).join(' — ');
        const words = countWords(text);
        count.textContent = `${String(text || '').length} תווים · ${words} מילים`;
      }
    }
  };

  root.oninput = root.onchange;

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

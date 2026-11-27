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
  appendKnowledgeItems, createKnowledgeItem, knowledgeFromCatalog
} from '../gefen-tender/knowledge.js';
import {
  buildSubmissionAnswers, ensureAssociationQuestions, parseQuestionnaireImport
} from '../gefen-tender/questionnaires.js';
import { administrativeCompleted, programReadinessRows } from '../gefen-tender/readiness.js';
import {
  downloadWorkbook, exportApprovedAnswersWorkbook, exportOfficialFormPackage, officialTemplateLink
} from '../gefen-tender/excel-forms.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const isAdmin = () => String(state?.user?.role || state?.user?.display_role || '').trim() === 'admin';
const link = (folder, label) =>
  `<a target="_blank" rel="noopener noreferrer" href="${SHAREPOINT_BASE}/${folder.split('/').map(encodeURIComponent).join('/')}">${esc(label)}</a>`;
const opts = (values, current) => values.map((v) =>
  `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('');

export async function mountGefenTender(root) {
  if (!root || !isAdmin()) return;
  root.innerHTML = '<p role="status">טוען נתונים...</p>';

  let rows = [];
  let tab = 'administrative';
  let selected = '';
  let submissionId = '';
  let busy = false;
  let dirty = false;
  let autosaveTimer = null;

  const pendingLeave = () => {
    if (!dirty) return true;
    return window.confirm('קיימים שינויים שלא נשמרו. לצאת ללא שמירה?');
  };
  const get = () => rows.find((r) => r.id === selected);
  const administrative = () => rows.find((r) => r.kind === 'administrative');
  const statusEl = () => root.querySelector('[data-gt-status]');
  const setStatus = (msg) => { const el = statusEl(); if (el) el.textContent = msg; };

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
      input = `<textarea rows="${limit ? 4 : 2}"${attr}${limit ? ` maxlength="${limit}"` : ''}>${esc(value)}</textarea>` +
        `<small data-count="${esc(key)}">${String(value ?? '').length}${limit ? ` / ${limit}` : ''}</small> ` +
        `<button type="button" data-copy="${esc(key)}">העתקה</button>`;
    }
    return `<div class="gt-field"><label>${esc(label)}${limit ? ` (עד ${limit} תווים)` : ''}</label>${input}</div>`;
  };

  async function saveViaRpc(row, payload, mode = 'save_payload') {
    if (!isAdmin() || busy) return false;
    busy = true;
    const enabled = [...root.querySelectorAll('button,select,textarea,input')].filter((e) => !e.disabled);
    enabled.forEach((e) => { e.disabled = true; });
    setStatus('שומר...');
    try {
      const { data, error } = await supabase.rpc('gefen_tender_2027_save', {
        p_id: row.id,
        p_expected_revision: row.revision,
        p_payload: payload,
        p_mode: mode
      });
      if (error) {
        // Fallback for environments where RPC is not yet deployed
        if (/function .*gefen_tender_2027_save/i.test(error.message) || error.code === 'PGRST202') {
          const nextPayload = { ...payload };
          if (mode === 'save_payload' || mode === 'set_answers') {
            const map = new Map(buildSubmissionAnswers({ ...row, payload: nextPayload }).map((a) => [a.key, a.value]));
            nextPayload.final_answers = reconcileFinalAnswers(nextPayload.final_answers, map);
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
      setStatus('נשמר');
      return true;
    } catch (e) {
      setStatus(`השמירה נכשלה: ${e.message}`);
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
    PROGRAM_DETAIL_FIELDS.forEach(([k]) => { p.details[k] = v[k]; });
    p.associations = (p.associations || []).map((a, i) => {
      const ensured = ensureAssociationQuestions(a);
      if (Array.isArray(ensured.questions) && ensured.questions.length) {
        return {
          ...ensured,
          questions: ensured.questions.map((q, j) => ({
            ...q,
            answer: v[`q_${i}_${j}`] ?? q.answer
          }))
        };
      }
      return { ...ensured, answers: v[`answer_${i}`] };
    });
    ['knowledge_notes', 'source_notes', 'historical_notes', 'syllabus', 'experience', 'recommendations', 'developers', 'operators', 'drive_folder_url', 'sharepoint_notes'].forEach((k) => {
      if (k in v) p[k] = v[k];
    });
    p.developer_ids = [...root.querySelectorAll('[data-dev-id]:checked')].map((x) => x.value);
    p.operator_ids = [...root.querySelectorAll('[data-op-id]:checked')].map((x) => x.value);
    const map = new Map(buildSubmissionAnswers({ ...row, payload: p }).map((a) => [a.key, a.value]));
    p.final_answers = reconcileFinalAnswers(p.final_answers, map);
    return p;
  }

  function knowledgeHtml(p) {
    const items = p.knowledge_items || [];
    return `<h3>מאגר ידע מצטבר</h3>
      <p>פריטים מצטברים בלבד — מידע חדש לא מוחק קודם ולא דורס תשובה מאושרת.</p>
      <div class="gt-list">${items.map((item) =>
        `<div class="gt-row"><strong>${esc(item.type)}</strong> · <small>${esc(item.verification_status)}</small>
          <div style="white-space:pre-wrap">${esc(item.content)}</div>
          <small>${esc(item.source || '')}${item.source_url ? ` · ${esc(item.source_url)}` : ''} · ${esc(item.updated_at || '')}</small>
        </div>`
      ).join('') || '<div class="gt-row">אין פריטים עדיין</div>'}</div>
      <div class="gt-row">
        <div class="gt-field"><label>סוג</label><select data-k-type>${opts(KNOWLEDGE_TYPES, 'עובדה')}</select></div>
        <div class="gt-field"><label>תוכן</label><textarea data-k-content rows="3"></textarea></div>
        <div class="gt-field"><label>מקור</label><input data-k-source></div>
        <div class="gt-field"><label>קישור למקור</label><input data-k-url type="url"></div>
        <div class="gt-field"><label>תאריך מקור</label><input data-k-date type="date"></div>
        <div class="gt-field"><label>סטטוס אימות</label><select data-k-ver>${opts(VERIFICATION_STATUSES, 'לא אומת')}</select></div>
        <div class="gt-field"><label>הערות</label><textarea data-k-notes rows="2"></textarea></div>
        <button type="button" data-add-knowledge>הוספת פריט ידע</button>
        <button type="button" data-import-catalog>ייבוא מקטלוג הדשבורד</button>
      </div>
      ${field('knowledge_notes', 'הערות ידע כלליות', p.knowledge_notes)}
      ${field('source_notes', 'מקורות ואסמכתאות', p.source_notes)}
      ${field('historical_notes', 'תשובות קודמות — נוסח ומקור', p.historical_notes)}`;
  }

  function peoplePicker(p) {
    const people = rows.filter((r) => r.kind === 'operator');
    const dev = new Set(p.developer_ids || []);
    const ops = new Set(p.operator_ids || []);
    return `<h3>שיוך מפתחים ומפעילים מהמאגר</h3>
      <div class="gt-overflow"><table class="gt-table"><thead><tr><th>שם</th><th>מפתח</th><th>מפעיל</th><th>הכשרה</th></tr></thead><tbody>
      ${people.map((r) => `<tr>
        <td>${esc(r.title)}</td>
        <td><input type="checkbox" data-dev-id value="${esc(r.id)}"${dev.has(r.id) ? ' checked' : ''}></td>
        <td><input type="checkbox" data-op-id value="${esc(r.id)}"${ops.has(r.id) ? ' checked' : ''}></td>
        <td>${esc(r.payload?.training_hours != null ? `${r.payload.training_hours} שעות` : 'טרם אומת')}</td>
      </tr>`).join('')}
      </tbody></table></div>`;
  }

  function readinessHtml() {
    const list = programReadinessRows(rows);
    const done = administrativeCompleted(administrative());
    return `<div class="gt-toolbar"><strong>הגשה מנהלית: ${done} / 19</strong>
      <small>אחוז התקדמות אינו אישור עמידה בתנאי סף</small></div>
      <div class="gt-overflow"><table class="gt-table"><thead><tr>
        <th>תוכנית</th><th>שיוך</th><th>חסרים</th><th>טרם אושרו</th><th>חריגות</th><th>מיפוי לא מאומת</th><th>התקדמות</th><th>בדיקות</th><th></th>
      </tr></thead><tbody>${list.map((item) => `<tr>
        <td>${esc(item.row.title)}</td>
        <td>${esc(item.association.code)} · ${esc(item.association.status || '')}</td>
        <td>${item.missing}</td><td>${item.pending}</td><td>${item.over}</td><td>${item.unmapped}</td>
        <td>${item.progress_pct}%</td>
        <td>${esc(item.issues.map((i) => i.label).join(' · '))}</td>
        <td><button type="button" data-review-program="${esc(item.row.id)}">הגשה</button>
            <button type="button" data-edit-program="${esc(item.row.id)}">עריכה</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  function submissionHtml() {
    const items = rows.filter((r) => r.kind === 'program');
    const row = items.find((r) => r.id === submissionId);
    let h = `<div class="gt-toolbar"><label>בחירת תוכנית <select data-submission-select>
      <option value="">בחרו תוכנית</option>
      ${items.map((r) => `<option value="${esc(r.id)}"${r.id === submissionId ? ' selected' : ''}>${esc(r.title)}</option>`).join('')}
    </select></label></div>`;
    if (!row) return h;

    const answers = buildSubmissionAnswers(row);
    const finalCount = answers.filter((a) => isFinalAnswer(row.payload?.final_answers, a.key, a.value)).length;
    h += `<div class="gt-toolbar"><strong>${finalCount} / ${answers.length} תשובות מאושרות</strong>
      <button type="button" data-export-answers>יצוא תשובות מאושרות</button>
      <button type="button" data-export-pack-draft>חבילת טפסים — טיוטה</button>
      <button type="button" data-export-pack-final>חבילת טפסים — מאושר</button></div>`;
    if ((row.payload?.associations || []).some((a) => !Array.isArray(a.questions) || !a.questions.length)) {
      h += '<p>מיפוי שאלוני תתי הסל עדיין חסר או לא אומת. אין לראות במסך זה חבילת הגשה מלאה.</p>';
    }
    if (administrativeCompleted(administrative()) !== 19) h += '<p>ההגשה המנהלית טרם הושלמה.</p>';

    let group = '';
    answers.forEach((a, i) => {
      if (a.group !== group) {
        group = a.group;
        h += `<h3>${esc(group)}</h3>`;
      }
      const approved = isFinalAnswer(row.payload?.final_answers, a.key, a.value);
      const over = a.limit && !withinLimit(a.value, a.limit);
      h += `<div class="gt-row" data-answer-block="${i}">
        <div class="gt-toolbar">
          <strong>${esc(a.label)}</strong>
          <small>${approved ? 'מאושרת' : a.value.trim() ? 'טיוטה' : 'חסר'}${a.mapping_verified === false || a.unmapped ? ' · מיפוי לא אומת' : ''}</small>
          <button type="button" data-context-copy="${i}">העתקת נתונים ל־ChatGPT</button>
          <button type="button" data-final-copy="${i}" ${approved ? '' : 'disabled'}>העתקת תשובה סופית</button>
          <button type="button" data-final-toggle="${i}" ${!a.value.trim() || over ? 'disabled' : ''}>${approved ? 'ביטול אישור' : 'אישור תשובה'}</button>
          <button type="button" data-save-answer="${i}">שמירת טיוטה</button>
        </div>
        <textarea data-answer-edit="${i}" rows="5">${esc(a.value)}</textarea>
        ${a.limit ? `<small data-answer-count="${i}">${a.value.length} / ${a.limit}</small>` : `<small data-answer-count="${i}">${a.value.length}</small>`}
      </div>`;
    });

    h += `<h3>טפסי Excel רשמיים</h3><div class="gt-list">${EXCEL_FORMS
      .filter((f) => !f.requiresBasket || (row.payload?.associations || []).some((a) => Number(a.code) === f.requiresBasket))
      .map((f) => `<div class="gt-row">${f.code} – ${esc(f.title)} ·
        <a target="_blank" rel="noopener noreferrer" href="${officialTemplateLink(f)}">פתיחת תבנית המקור</a>
        <button type="button" data-export-form="${f.code}">הורדת חבילת נתונים לטופס</button>
      </div>`).join('')}</div>
      <p>הפקת הנתונים ממלאת עותק שדות מיושר לטפסים. יש להעתיק לטפסי המקור ב־SharePoint — אין תחליף לקובץ הרשמי עם הנוסחאות והאימותים.</p>`;
    return h;
  }

  function draw() {
    if (!isAdmin() || !root.isConnected) return;
    const a = administrative();
    const sections = a?.payload?.sections || {};
    const heading = `<style>
      .gt-nav{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
      .gt button,.gt select,.gt input,.gt textarea{font:inherit;border:1px solid #cbd5e1;border-radius:8px;padding:7px;background:var(--color-surface,#fff);color:inherit}
      .gt button{cursor:pointer}.gt button[aria-current=true]{background:#087f9c;color:#fff}
      .gt-list{display:grid;gap:8px}.gt-row,.gt-field{border:1px solid #dbe3ec;border-radius:10px;padding:12px;background:var(--color-surface,#fff)}
      .gt-field{display:grid;gap:6px}.gt-field textarea,.gt-field select,.gt-field input{width:100%;box-sizing:border-box}
      .gt-field label{font-weight:600}.gt-field [data-multi] label{display:inline-block;margin:5px;font-weight:400}
      .gt a{color:#087f9c}.gt-toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
      .gt-table{width:100%;border-collapse:collapse}.gt-table td,.gt-table th{padding:9px;border-bottom:1px solid #dbe3ec;text-align:right}
      .gt-overflow{overflow:auto}
      @media (prefers-color-scheme: dark){
        .gt button,.gt select,.gt input,.gt textarea,.gt-row,.gt-field{border-color:#334155;background:var(--color-surface,#0f172a)}
        .gt-table td,.gt-table th{border-color:#334155}
      }
    </style>
    <div class="gt" dir="rtl">
      <nav class="gt-nav">${[
        ['administrative', 'הגשה מנהלית'],
        ['program', 'תוכניות והגשות'],
        ['operator', 'מפתחים ומפעילים'],
        ['documents', 'מסמכים ותבניות'],
        ['readiness', 'בקרת מוכנות'],
        ['submission', 'הגשה למכרז']
      ].map(([k, t]) => `<button type="button" data-tab="${k}" aria-current="${tab === k}">${t}</button>`).join('')}</nav>
      <p data-gt-status role="status" aria-live="polite"></p>`;

    let html = '';
    if (tab === 'administrative') {
      html = `<div class="gt-toolbar"><strong>${administrativeCompleted(a)} / 19 הושלמו</strong>
        ${link('11 - טופס מנהלי והצהרות', 'תיקיית הגשה מנהלית')}
        <select data-filter><option value="">כל הסעיפים</option><option value="pending">להשלמה</option><option value="done">הושלמו</option></select>
      </div><div class="gt-list">${ADMIN_SECTIONS.map((t, i) => {
        const n = i + 1;
        const v = sections[n] || {};
        const law = [5, 6, 10, 12].includes(n);
        const file = n <= 6 || [10, 12].includes(n);
        const instruction = law
          ? 'טופס מלא בחתימת הספק ומאומת על ידי עורך דין'
          : file
            ? 'חובה לצרף קובץ PDF, JPG, BMP או GIF עד 5MB'
            : 'חתימה על הצהרה מקוונת בגפ״ן';
        return `<details class="gt-row" data-admin-row="${n}" data-done="${v.status === ADMIN_STATUSES[5]}">
          <summary>${n}. ${esc(t)} — ${esc(v.status || ADMIN_STATUSES[0])}</summary>
          <p>${instruction}</p>
          ${n === 4 ? '<p>אין לצרף אישור ניכוי מס במקור או מסמך עוסק פטור; יש לוודא תוקף.</p>' : ''}
          ${n === 3 ? '<p>ניתן לצרף תעודת מלכ״ר.</p>' : ''}
          <label>סטטוס <select data-a="status">${opts(ADMIN_STATUSES, v.status || ADMIN_STATUSES[0])}</select></label>
          ${file ? `<label>קישור למסמך <input data-a="url" type="url" value="${esc(v.url)}"></label>
            <label>תוקף <input data-a="expiry" type="date" value="${esc(v.expiry)}"></label>` : ''}
          <label>קישור לתבנית <input data-a="template_url" type="url" value="${esc(v.template_url)}"></label>
          <label>הערות <textarea data-a="notes">${esc(v.notes)}</textarea></label>
          <button type="button" data-save-admin="${n}">שמירה</button>
        </details>`;
      }).join('')}</div>`;
    } else if (tab === 'program' || tab === 'operator') {
      const items = rows.filter((r) => r.kind === tab);
      const row = get();
      if (!row || row.kind !== tab) {
        html = `<div class="gt-toolbar"><input type="search" data-search placeholder="חיפוש"><strong>${items.length} רשומות</strong></div>
          <div class="gt-overflow"><table class="gt-table"><thead><tr><th>שם</th><th>פרטים</th><th></th></tr></thead><tbody>
          ${items.map((r) => `<tr data-list-row><td>${esc(r.title)}</td><td>${esc(
            tab === 'program'
              ? (r.payload?.associations || []).map((x) => `${x.code} – ${x.status}${x.validity ? ` (${x.validity})` : ''}`).join(' | ')
              : (r.payload?.training_hours != null ? `${r.payload.training_hours} שעות הכשרה` : 'טרם אומתה הכשרה')
          )}</td><td><button type="button" data-select="${esc(r.id)}">עריכה</button></td></tr>`).join('')}
          </tbody></table></div>`;
      } else {
        const p = row.payload || {};
        html = `<div class="gt-toolbar"><button type="button" data-list-back>חזרה לרשימה</button><h3>${esc(row.title)}</h3></div><div class="gt-list">`;
        if (tab === 'program') {
          html += knowledgeHtml(p);
          html += `<p>מספר תוכנית: ${esc(p.number ?? 'תוכנית חדשה')} · סל מענים: 1 – מענים פדגוגיים ורגשיים</p>`;
          html += field('drive_folder_url', 'תיקיית Google Drive של התוכנית', p.drive_folder_url || '');
          html += `<p><a target="_blank" rel="noopener noreferrer" href="${GOOGLE_DRIVE_PROGRAMS}">תיקיית תוכניות תעשיידע ב־Google Drive</a></p>`;
          html += field('sharepoint_notes', 'מסמכי SharePoint / קישורים', p.sharepoint_notes || '');
          html += PROGRAM_DETAIL_FIELDS.map(([k, l, lim, choices, multi]) =>
            field(k, l, p.details?.[k] ?? (k === 'name' ? row.title : ''), lim, choices, multi)
          ).join('');
          html += '<h3>שיוכים והגשות</h3>';
          html += (p.associations || []).map((raw, i) => {
            const assoc = ensureAssociationQuestions(raw);
            let block = `<div class="gt-row"><strong>${assoc.code} – ${esc(BASKETS[assoc.code])}</strong>
              <p>${esc(assoc.status)} ${esc(assoc.validity || '')} · מיפוי: ${assoc.mapping_verified === true ? 'אומת' : 'לא אומת'}</p>`;
            if (assoc.mapping_note) block += `<p>${esc(assoc.mapping_note)}</p>`;
            if (Array.isArray(assoc.questions) && assoc.questions.length) {
              block += assoc.questions.map((q, j) =>
                field(`q_${i}_${j}`, q.label, q.answer, q.limit, q.choices, q.multi)
              ).join('');
            } else {
              block += field(`answer_${i}`, 'טיוטת תשובות לשיוך (מיפוי מלא טרם אומת)', assoc.answers || '');
              block += `<div class="gt-field"><label>ייבוא מיפוי שאלון מאומת (JSON)</label>
                <textarea data-import-q="${i}" rows="4" placeholder='[{"id":"112.1","label":"...","limit":500,"mapping_verified":true}]'></textarea>
                <button type="button" data-apply-import="${i}">החלת מיפוי</button></div>`;
            }
            block += '</div>';
            return block;
          }).join('');
          html += field('syllabus', 'סילבוס', p.syllabus);
          html += field('experience', 'ניסיון בהפעלה', p.experience);
          html += field('recommendations', 'המלצות', p.recommendations);
          html += field('developers', 'מפתחים (טקסט חופשי)', p.developers);
          html += field('operators', 'מפעילים (טקסט חופשי)', p.operators);
          html += peoplePicker(p);
        } else {
          html += link(`06 - מפתחים ומפעילים/${p.folder || row.title}`, 'תיקיית אסמכתאות');
          html += field('roles', 'תפקידים אפשריים', p.roles);
          html += field('education', 'השכלה', p.education);
          html += field('degrees', 'תארים ותעודות', p.degrees);
          html += field('training', 'הכשרות מקצועיות', p.training);
          html += field('training_hours', 'שעות הכשרה', p.training_hours ?? '');
          html += field('experience', 'ניסיון מקצועי', p.experience);
          html += field('teaching_experience', 'ניסיון בהדרכה', p.teaching_experience);
          html += field('development_experience', 'ניסיון בפיתוח תוכניות', p.development_experience);
          html += field('recommender_name', 'ממליץ', p.recommender_name);
          html += field('recommender_relation', 'מהות הקשר לממליץ', p.recommender_relation);
          html += field('cv_url', 'קישור לקורות חיים', p.cv_url);
          html += field('evidence_folder_url', 'תיקיית אסמכתאות (קישור)', p.evidence_folder_url);
          html += field('verified_sources', 'אסמכתאות שנבדקו', p.verified_sources);
          html += field('eligibility', 'בדיקת תנאי סף לפי תת סל ותפקיד', p.eligibility);
          html += `<div class="gt-field"><label>סטטוס אימות</label><select data-field="verification_status">${opts(VERIFICATION_STATUSES, p.verification_status || 'לא אומת')}</select></div>`;
          html += field('notes', 'הערות ואסמכתאות חסרות', p.notes);
        }
        html += '</div><button type="button" data-save-record>שמירה</button>';
      }
    } else if (tab === 'submission') {
      html = submissionHtml();
    } else if (tab === 'documents') {
      html = `<div class="gt-list">${SHAREPOINT_FOLDERS.map((n) =>
        `<div class="gt-row">${link(n, n)}</div>`
      ).join('')}<div class="gt-row"><a target="_blank" rel="noopener noreferrer" href="${GOOGLE_DRIVE_PROGRAMS}">Google Drive — תוכניות תעשיידע</a></div></div>`;
    } else {
      html = readinessHtml();
    }

    root.innerHTML = `${heading}${html}</div>`;
    window.removeEventListener('beforeunload', onBeforeUnload);
    wire();
  }

  function scheduleAutosaveAnswer(index) {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      const sr = rows.find((r) => r.id === submissionId);
      if (!sr || busy) return;
      const answers = buildSubmissionAnswers(sr);
      const a = answers[index];
      const ta = root.querySelector(`[data-answer-edit="${index}"]`);
      if (!a || !ta) return;
      const value = ta.value;
      const p = applyAnswerToPayload(sr, a, value);
      setStatus('שומר טיוטה...');
      if (await saveViaRpc(sr, p, 'set_answers')) {
        setStatus('טיוטה נשמרה');
        const count = root.querySelector(`[data-answer-count="${index}"]`);
        if (count) count.textContent = a.limit ? `${value.length} / ${a.limit}` : String(value.length);
      }
    }, 900);
  }

  function applyAnswerToPayload(row, answer, value) {
    const p = { ...row.payload, details: { ...(row.payload?.details || {}) }, associations: [...(row.payload?.associations || [])] };
    if (answer.key.startsWith('details.')) {
      const k = answer.key.slice('details.'.length);
      p.details[k] = value;
    } else if (answer.key.startsWith('association.')) {
      const parts = answer.key.split('.');
      const i = Number(parts[1]);
      const assoc = ensureAssociationQuestions({ ...p.associations[i] });
      if (parts[2] === 'placeholder' || !assoc.questions.length) {
        assoc.answers = value;
      } else {
        const j = Number(parts[2]);
        assoc.questions = assoc.questions.map((q, idx) => idx === j ? { ...q, answer: value } : q);
      }
      p.associations[i] = assoc;
    } else {
      p[answer.key] = value;
    }
    const map = new Map(buildSubmissionAnswers({ ...row, payload: p }).map((x) => [x.key, x.value]));
    // Any text change clears mismatched approvals; restoring old text cannot revive token
    p.final_answers = reconcileFinalAnswers(p.final_answers, map);
    return p;
  }

  function wire() {
    root.querySelectorAll('[data-tab]').forEach((b) => {
      b.onclick = () => {
        if (busy || !pendingLeave()) return;
        dirty = false;
        tab = b.dataset.tab;
        selected = '';
        draw();
      };
    });
    root.querySelectorAll('[data-review-program]').forEach((b) => {
      b.onclick = () => { submissionId = b.dataset.reviewProgram; tab = 'submission'; draw(); };
    });
    root.querySelectorAll('[data-edit-program]').forEach((b) => {
      b.onclick = () => { selected = b.dataset.editProgram; tab = 'program'; draw(); };
    });
    root.querySelectorAll('[data-select]').forEach((b) => {
      b.onclick = () => { selected = b.dataset.select; draw(); };
    });
    root.querySelector('[data-list-back]')?.addEventListener('click', () => {
      if (!pendingLeave()) return;
      dirty = false;
      selected = '';
      draw();
    });
    root.querySelector('[data-filter]')?.addEventListener('change', (e) => {
      root.querySelectorAll('[data-admin-row]').forEach((x) => {
        x.hidden = e.target.value === 'done'
          ? x.dataset.done !== 'true'
          : e.target.value === 'pending'
            ? x.dataset.done === 'true'
            : false;
      });
    });
    root.querySelector('[data-search]')?.addEventListener('input', (e) => {
      root.querySelectorAll('[data-list-row]').forEach((x) => {
        x.hidden = !x.textContent.toLowerCase().includes(e.target.value.toLowerCase());
      });
    });
    root.querySelector('.gt')?.addEventListener('input', (e) => {
      if (e.target.matches('[data-field],[data-a],[data-multi] input,[data-answer-edit],[data-k-content]')) {
        dirty = true;
        setStatus('שינויים טרם נשמרו');
      }
      if (e.target.matches('[data-answer-edit]')) {
        const i = Number(e.target.dataset.answerEdit);
        const count = root.querySelector(`[data-answer-count="${i}"]`);
        const answers = buildSubmissionAnswers(rows.find((r) => r.id === submissionId) || { payload: {} });
        const a = answers[i];
        if (count) count.textContent = a?.limit ? `${e.target.value.length} / ${a.limit}` : String(e.target.value.length);
        scheduleAutosaveAnswer(i);
      }
    });
    root.querySelectorAll('[data-field]').forEach((x) => {
      x.oninput = () => {
        const c = root.querySelector(`[data-count="${x.dataset.field}"]`);
        if (c) c.textContent = x.value.length + (x.maxLength > 0 ? ` / ${x.maxLength}` : '');
      };
    });
    root.querySelectorAll('[data-copy]').forEach((b) => {
      b.onclick = async () => {
        try {
          await navigator.clipboard.writeText(root.querySelector(`[data-field="${b.dataset.copy}"]`).value);
          setStatus('הועתק');
        } catch {
          setStatus('העתקה נכשלה');
        }
      };
    });

    root.querySelector('[data-add-knowledge]')?.addEventListener('click', async () => {
      const row = get();
      if (!row) return;
      const item = createKnowledgeItem({
        type: root.querySelector('[data-k-type]')?.value,
        content: root.querySelector('[data-k-content]')?.value,
        source: root.querySelector('[data-k-source]')?.value,
        source_url: root.querySelector('[data-k-url]')?.value,
        source_date: root.querySelector('[data-k-date]')?.value,
        verification_status: root.querySelector('[data-k-ver]')?.value,
        notes: root.querySelector('[data-k-notes]')?.value
      });
      if (!item.content) { setStatus('נא למלא תוכן'); return; }
      const payload = {
        ...row.payload,
        knowledge_items: appendKnowledgeItems(row.payload?.knowledge_items, [item])
      };
      if (await saveViaRpc(row, payload, 'append_knowledge')) draw();
    });

    root.querySelector('[data-import-catalog]')?.addEventListener('click', async () => {
      const row = get();
      if (!row?.payload?.number) { setStatus('אין מספר גפ״ן לייבוא'); return; }
      setStatus('טוען מהקטלוג...');
      try {
        const { data, error } = await supabase.from('catalog_program_details')
          .select('short_description,goals,core_idea,program_flow,final_outcome,student_develops,syllabus,gefen_number')
          .eq('gefen_number', String(row.payload.number))
          .maybeSingle();
        if (error) throw error;
        if (!data) { setStatus('לא נמצאו נתוני קטלוג'); return; }
        const payload = {
          ...row.payload,
          knowledge_items: appendKnowledgeItems(row.payload?.knowledge_items, knowledgeFromCatalog(data))
        };
        if (await saveViaRpc(row, payload, 'append_knowledge')) draw();
      } catch (e) {
        setStatus(`ייבוא קטלוג נכשל: ${e.message}`);
      }
    });

    root.querySelectorAll('[data-apply-import]').forEach((b) => {
      b.onclick = async () => {
        const row = get();
        const i = Number(b.dataset.applyImport);
        const text = root.querySelector(`[data-import-q="${i}"]`)?.value;
        try {
          const questions = parseQuestionnaireImport(text, String(row.payload.associations[i].code));
          const associations = [...row.payload.associations];
          associations[i] = {
            ...associations[i],
            questions,
            mapping_verified: questions.every((q) => q.mapping_verified === true)
          };
          if (await saveViaRpc(row, { ...row.payload, associations }, 'save_payload')) draw();
        } catch (e) {
          setStatus(`ייבוא מיפוי נכשל: ${e.message}`);
        }
      };
    });

    root.querySelector('[data-submission-select]')?.addEventListener('change', (e) => {
      if (!pendingLeave()) { e.target.value = submissionId; return; }
      dirty = false;
      submissionId = e.target.value;
      draw();
    });

    const sr = rows.find((r) => r.id === submissionId);
    if (tab === 'submission' && sr) {
      const answers = buildSubmissionAnswers(sr);
      root.querySelectorAll('[data-context-copy]').forEach((b) => {
        b.onclick = async () => {
          try {
            if (!isAdmin()) throw new Error('נדרשת הרשאת מנהל');
            setStatus('טוען נתונים עדכניים...');
            const { data, error } = await supabase.from(TABLE).select('*');
            if (error) throw error;
            const current = data?.find((r) => r.id === sr.id);
            if (!current) throw new Error('התוכנית לא נמצאה');
            const original = answers[Number(b.dataset.contextCopy)];
            const fresh = buildSubmissionAnswers(current).find((x) => x.key === original.key);
            if (!fresh) throw new Error('השאלה השתנתה. יש לטעון מחדש.');
            const packet = buildContextPacket(current, fresh, data);
            try {
              await navigator.clipboard.writeText(packet);
              setStatus('נתונים הועתקו ל־ChatGPT');
            } catch {
              const area = document.createElement('textarea');
              area.value = packet;
              area.readOnly = true;
              area.setAttribute('aria-label', 'נתונים להעתקה ל־ChatGPT');
              area.style.width = '100%';
              area.rows = 8;
              statusEl()?.after(area);
              area.select();
              setStatus('העתקה אוטומטית לא זמינה. ניתן להעתיק את הטקסט המסומן.');
            }
          } catch (e) {
            setStatus(`הכנת הנתונים נכשלה: ${e.message}`);
          }
        };
      });

      root.querySelectorAll('[data-final-copy]').forEach((b) => {
        b.onclick = async () => {
          const a = answers[Number(b.dataset.finalCopy)];
          const ta = root.querySelector(`[data-answer-edit="${b.dataset.finalCopy}"]`);
          const value = ta?.value ?? a.value;
          if (!isFinalAnswer(sr.payload?.final_answers, a.key, value)) return;
          try {
            await navigator.clipboard.writeText(value);
            setStatus('הועתק');
          } catch {
            setStatus('העתקה נכשלה');
          }
        };
      });

      root.querySelectorAll('[data-save-answer]').forEach((b) => {
        b.onclick = async () => {
          const i = Number(b.dataset.saveAnswer);
          const a = answers[i];
          const value = root.querySelector(`[data-answer-edit="${i}"]`)?.value ?? '';
          const p = applyAnswerToPayload(sr, a, value);
          if (await saveViaRpc(sr, p, 'set_answers')) draw();
        };
      });

      root.querySelectorAll('[data-final-toggle]').forEach((b) => {
        b.onclick = async () => {
          const i = Number(b.dataset.finalToggle);
          const a = answers[i];
          const value = root.querySelector(`[data-answer-edit="${i}"]`)?.value ?? a.value;
          if (!value.trim() || (a.limit && !withinLimit(value, a.limit))) return;
          let p = applyAnswerToPayload(sr, a, value);
          if (isFinalAnswer(p.final_answers, a.key, value)) {
            p = { ...p, final_answers: revokeAnswer(p.final_answers, a.key) };
          } else {
            p = { ...p, final_answers: approveAnswer(p.final_answers, a.key, value) };
          }
          if (await saveViaRpc(sr, p, 'save_payload')) draw();
        };
      });

      const runExport = async (kind, formCode = null) => {
        try {
          const XLSX = await import('xlsx');
          if (kind === 'answers') {
            const wb = await exportApprovedAnswersWorkbook(XLSX, sr);
            downloadWorkbook(XLSX, wb, `תשובות גפן 2027 - ${sr.title.replace(/[\\/?%*:|"<>]/g, '_')}.xlsx`);
          } else {
            const approvedOnly = kind === 'pack-final';
            const { wb, stamp } = await exportOfficialFormPackage(XLSX, sr, rows, { approvedOnly });
            if (formCode) {
              // still export full package; single-form buttons use same package with focus note in meta
            }
            downloadWorkbook(XLSX, wb, `חבילת טפסים גפן 2027 - ${stamp} - ${sr.title.replace(/[\\/?%*:|"<>]/g, '_')}.xlsx`);
          }
          setStatus('הקובץ הורד');
        } catch (e) {
          setStatus(`היצוא נכשל: ${e.message}`);
        }
      };
      root.querySelector('[data-export-answers]')?.addEventListener('click', () => runExport('answers'));
      root.querySelector('[data-export-pack-draft]')?.addEventListener('click', () => runExport('pack-draft'));
      root.querySelector('[data-export-pack-final]')?.addEventListener('click', () => runExport('pack-final'));
      root.querySelectorAll('[data-export-form]').forEach((b) => {
        b.onclick = () => runExport('pack-draft', Number(b.dataset.exportForm));
      });
    }

    root.querySelectorAll('[data-save-admin]').forEach((b) => {
      b.onclick = async () => {
        const n = b.dataset.saveAdmin;
        const box = b.closest('details');
        const v = { ...(sections[n] || {}) };
        box.querySelectorAll('[data-a]').forEach((x) => { v[x.dataset.a] = x.value; });
        if (v.url || v.template_url) {
          try {
            for (const url of [v.url, v.template_url].filter(Boolean)) {
              const u = new URL(url);
              if (u.protocol !== 'https:' || u.hostname !== 'think365orgil.sharepoint.com') throw new Error();
            }
          } catch {
            setStatus('יש להזין קישור SharePoint תקין');
            return;
          }
        }
        if (await saveViaRpc(a, {
          ...a.payload,
          sections: { ...(a.payload.sections || {}), [n]: v }
        })) {
          box.querySelector('summary').textContent = `${n}. ${ADMIN_SECTIONS[Number(n) - 1]} — ${v.status}`;
          box.dataset.done = String(v.status === ADMIN_STATUSES[5]);
        }
      };
    });

    root.querySelector('[data-save-record]')?.addEventListener('click', async () => {
      const row = get();
      if (!row) return;
      if (tab === 'program') {
        const p = collectProgramPayload(row);
        if (await saveViaRpc(row, p, 'save_payload')) draw();
      } else {
        const v = {};
        root.querySelectorAll('[data-field]').forEach((x) => { v[x.dataset.field] = x.value; });
        if (await saveViaRpc(row, { ...row.payload, ...v }, 'save_payload')) draw();
      }
    });

    window.addEventListener('beforeunload', onBeforeUnload);
  }

  function onBeforeUnload(e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  }

  try {
    const session = await waitForSupabaseAuthSession();
    if (!session?.access_token || !isAdmin()) throw new Error('נדרשת התחברות מנהל');
    const { data, error } = await supabase.from(TABLE).select('*').order('title');
    if (error) throw error;
    rows = data || [];
    if (!administrative()) throw new Error('נתוני המכרז לא נמצאו');
    draw();
  } catch (e) {
    root.textContent = `טעינת המכרז נכשלה: ${e.message}`;
  }
}

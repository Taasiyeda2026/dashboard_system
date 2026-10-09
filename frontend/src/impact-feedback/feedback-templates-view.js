/**
 * Impact feedback — "הגדרות → תבניות ושאלות".
 * Published versions are read-only; edits happen in a draft version that is published
 * as a new version. Campaigns stay pinned to the version they were opened with.
 */
import { escapeHtml as esc } from '../screens/shared/html.js';
import { showToast } from '../screens/shared/toast.js';
import { QUESTION_TYPES, SLOTS, courseLabel } from './feedback-domain.js';
import {
  addBankQuestionToDraft,
  createQuestionInDraft,
  deleteTemplateQuestion,
  discardDraft,
  fetchBankQuestions,
  fetchTemplates,
  fetchSavedPaperPdfs,
  uploadSavedPaperPdf,
  downloadSavedPaperPdf,
  deleteSavedPaperPdf,
  fetchVersion,
  fetchVersionQuestions,
  getDraft,
  publishDraft,
  translateFeedbackError,
  updateTemplateQuestion,
  updateVersionIntro
} from './feedback-api.js';
import { mountFeedbackForm } from './feedback-form.js';

const SELECT_TYPES = new Set(['single_select', 'multi_select']);
const tpl = {
  list: null,
  paperPdfs: null,
  loadingPaperPdfs: false,
  loadingList: false,
  editor: null, // { template, published, publishedQuestions, draft, draftQuestions, bank }
  loadingEditor: false,
  error: ''
};

function slotOf(template) {
  return SLOTS.find((s) => s.audience === template.audience && s.stage === template.stage);
}

function versionsOf(template) {
  return Array.isArray(template.feedback_template_versions) ? template.feedback_template_versions : [];
}

function educationLevelLabel(level) {
  return level === 'elementary' ? 'יסודי' : level === 'secondary' ? 'חטיבת ביניים ותיכון' : '';
}

function programMeta(program) {
  const parts = [
    educationLevelLabel(program?.education_level),
    ...(Array.isArray(program?.gefen_numbers) ? program.gefen_numbers.map((n) => `גפ״ן ${n}`) : [])
  ].filter(Boolean);
  return parts.join(' · ');
}

function templateSlotLabel(slot) {
  if (slot.key === 'student:pre') return 'תלמידים – פתיחה';
  if (slot.key === 'student:post') return 'תלמידים – סיום';
  if (slot.key === 'instructor:pre') return 'מדריכים – פתיחה (אחרי הכשרה)';
  if (slot.key === 'instructor:final') return 'מדריכים – סיום';
  return 'צוות חינוכי – הערכת תוכנית';
}

function allowsNa(q) {
  return q.question_type === 'rating_1_5' && Boolean(q.scoring && q.scoring.allow_na);
}

function optionsToText(options) {
  return (Array.isArray(options) ? options : []).map((o) => `${o.value}|${o.label}`).join('\n');
}

function textToOptions(text) {
  return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line, i) => {
    const [value, ...rest] = line.split('|');
    const label = rest.join('|').trim() || value.trim();
    return { value: (value.trim() || `opt_${i + 1}`).replace(/\s+/g, '_'), label };
  });
}

function fmtDay(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/**
 * Questionnaire list for one audience (and the selected course, when one is chosen).
 * One row per course × stage; the shared editor opens from here.
 */
function listHtml(ui) {
  if (!tpl.list) return '<div class="ifb-empty" role="status"><div class="ds-spinner" aria-hidden="true"></div><p>טוען שאלונים…</p></div>';
  const programs = ui.programs.filter((p) => !ui.course || p.key === ui.course);
  if (!programs.length) return '<div class="ifb-empty">לא נמצאו קורסים.</div>';
  const cards = programs.map((program) => {
    const gefen = Array.isArray(program.gefen_numbers) ? program.gefen_numbers.join(', ') : '';
    const buttons = SLOTS.map((slot) => {
      const template = tpl.list.find((t) => t.program_key === program.key && t.audience === slot.audience && t.stage === slot.stage);
      if (!template) return '';
      const versions = versionsOf(template);
      const published = versions.find((v) => v.id === template.current_version_id);
      const draft = versions.find((v) => v.status === 'draft');
      const name = `${program.title} – ${templateSlotLabel(slot)}`;
      const short = ({
        'student:pre': 'תלמידים (התחלה)',
        'student:post': 'תלמידים (סיום)',
        'educational_staff:final': 'צוות חינוכי',
        'instructor:pre': 'מדריכים (התחלה)',
        'instructor:final': 'מדריכים (סיום)'
      })[slot.key] || templateSlotLabel(slot);
      const languageControls = (language) => {
        const file = tpl.paperPdfs?.find((p) => p.template_id === template.id && p.language === language);
        const outdated = Boolean(file && file.version_id !== template.current_version_id);
        const upToDate = Boolean(file && !outdated);
        const pdfState = upToDate ? 'is-ready' : outdated ? 'is-stale' : 'is-missing';
        const langName = language === 'he' ? 'עברית' : 'ערבית';
        return `<div class="ifb-template-card__lang-actions" data-pdf-language="${language}" aria-label="קובצי PDF בשפה ${langName}">
          <button type="button" class="ifb-template-card__pdf ${pdfState}" data-tpl-pdf="${esc(template.id)}" data-tpl-lang="${language}" ${upToDate ? '' : 'disabled'}
            title="${upToDate ? 'הורדת PDF שמור – ' + langName : outdated ? 'הקובץ אינו עדכני – יש להחליף PDF ' + langName : 'טרם הועלה PDF – ' + langName}"
            aria-label="${upToDate ? 'הורדת' : outdated ? 'PDF לא עדכני עבור' : 'PDF חסר עבור'} ${esc(name)} – ${langName}">PDF</button>
          <button type="button" class="ifb-template-card__upload" data-tpl-upload="${esc(template.id)}" data-tpl-lang="${language}" ${published ? '' : 'disabled'}
            title="${file ? 'החלפת PDF שמור – ' : 'העלאת PDF – '}${langName}"
            aria-label="${file ? 'החלפת' : 'העלאת'} PDF: ${esc(name)} – ${langName}">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
          </button>
          ${file ? `<button type="button" class="ifb-template-card__delete" data-tpl-delete="${esc(template.id)}" data-tpl-lang="${language}"
            aria-label="מחיקת PDF: ${esc(name)} – ${langName}" title="מחיקת PDF – ${langName}">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M10 4h4m-7 3 1 13h8l1-13M10 11v6m4-6v6"/></svg>
          </button>` : '<span class="ifb-template-card__delete-placeholder" aria-hidden="true"></span>'}
          ${outdated ? '<span class="ifb-template-card__warning" role="img" aria-label="PDF לא עדכני" title="השאלון עודכן. יש להחליף PDF">!</span>' : ''}
        </div>`;
      };
      return `<div class="ifb-template-card__slot">
        <button type="button" class="ifb-template-card__open" data-tpl-open="${esc(template.id)}" title="${esc(name)}" aria-label="צפייה ועריכת ${esc(name)}">${esc(short)}${draft ? '<span class="ifb-sr"> – טיוטה בעריכה</span>' : ''}</button>
        ${languageControls('he')}
        ${languageControls('ar')}
      </div>`;
    }).join('');
    return `<article class="ifb-template-card" data-template-course="${esc(program.key)}">
      <div class="ifb-template-card__inner">
        <h3 class="ifb-template-card__title">${esc(program.title)}</h3>
        <p class="ifb-template-card__gefen">${gefen ? esc(gefen) : ''}${esc(educationLevelLabel(program.education_level)) ? ` · ${esc(educationLevelLabel(program.education_level))}` : ''}</p>
        <div class="ifb-template-card__slots">
          <div class="ifb-template-card__language-headings" aria-label="שפות מסמכי PDF">
            <span>סוג המשוב</span><span lang="he">עברית</span><span lang="ar">ערבית</span>
          </div>
          ${buttons}
        </div>
      </div>
    </article>`;
  }).join('');
  return `<div class="ifb-template-grid" aria-label="תבניות משוב לפי קורס">${cards}</div>`;
}

function metricOptions(ui, selected) {
  return ui.metrics.map((m) => `<option value="${esc(m.key)}"${m.key === selected ? ' selected' : ''}>${esc(m.label)}${m.kind === 'program' ? ' (איכות התוכנית)' : ''}</option>`).join('');
}

function typeOptions(selected) {
  return QUESTION_TYPES.map((t) => `<option value="${t.key}"${t.key === selected ? ' selected' : ''}>${esc(t.label)}</option>`).join('');
}

function questionMetaHtml(items) {
  const parts = items.filter(Boolean);
  return parts.length ? `<p class="ifb-tq__meta">${parts.join('<span class="ifb-tq__sep" aria-hidden="true"> · </span>')}</p>` : '';
}

function metaPart(text, title = '') {
  return text ? `<span${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>` : '';
}

function sectionLabel(q) {
  return q.section === 'course' ? 'ייחודית לתוכנית' : 'ליבה';
}

const COMPARISON_TITLE = 'אותה שאלה בפתיחה ובסיום – משמשת להשוואת PRE/POST';

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Exception-first metadata: traits shared by most questions (section, comparison, required)
 * are stated once above the list; a row only names a trait where it differs.
 */
function templateDefaults(questions) {
  return {
    section: mostCommon(questions.map((q) => (q.section === 'course' ? 'course' : 'core'))),
    comparison: mostCommon(questions.map((q) => Boolean(q.is_comparison))),
    required: mostCommon(questions.map((q) => Boolean(q.required)))
  };
}

function exceptionParts(q, defaults) {
  return [
    (q.section === 'course' ? 'course' : 'core') !== defaults.section ? metaPart(sectionLabel(q)) : '',
    Boolean(q.is_comparison) !== defaults.comparison ? metaPart(q.is_comparison ? 'השוואת פתיחה–סיום' : 'ללא השוואה', q.is_comparison ? COMPARISON_TITLE : '') : '',
    Boolean(q.required) !== defaults.required ? metaPart(q.required ? 'חובה' : 'לא חובה') : ''
  ];
}

function listSummaryHtml(questions, defaults) {
  if (!questions.length) return '<p class="ifb-tq-summary">אין שאלות בתבנית.</p>';
  const parts = [
    `${questions.length} שאלות`,
    defaults.section === 'course' ? 'ייחודיות לתוכנית' : 'ליבה',
    defaults.comparison ? 'השוואת פתיחה–סיום' : '',
    defaults.required ? 'חובה' : 'לא חובה'
  ].filter(Boolean);
  return `<p class="ifb-tq-summary"${defaults.comparison ? ` title="${esc(COMPARISON_TITLE)}"` : ''}>${esc(parts.join(' · '))}</p>`;
}

function readOnlyQuestionHtml(q, index, ui, defaults) {
  const metric = ui.metrics.find((m) => m.key === q.metric_key)?.label || q.metric_key;
  return `<li class="ifb-tq is-readonly">
    <span class="ifb-tq__num">שאלה ${index + 1}</span>
    <p class="ifb-tq__text">${esc(q.wording?.default || '')}</p>
    ${questionMetaHtml([
      metaPart(metric),
      metaPart(QUESTION_TYPES.find((t) => t.key === q.question_type)?.label || ''),
      allowsNa(q) ? metaPart('כולל „לא רלוונטי”') : '',
      ...exceptionParts(q, defaults)
    ])}
    ${SELECT_TYPES.has(q.question_type) ? `<p class="ifb-tq__variant">אפשרויות: ${esc((q.options || []).map((o) => o.label).join(' · '))}</p>` : ''}
  </li>`;
}

function editableQuestionHtml(q, index, total, ui, defaults) {
  return `<li class="ifb-tq" data-tq="${esc(q.id)}">
    <div class="ifb-tq__head">
      <span class="ifb-tq__num">שאלה ${index + 1}</span>
      ${questionMetaHtml(exceptionParts(q, defaults).slice(0, 2))}
      <span class="ifb-tq__tools">
        <button type="button" class="ifb-icon-btn" data-tpl-move="-1" ${index === 0 ? 'disabled' : ''} aria-label="העברה למעלה">↑</button>
        <button type="button" class="ifb-icon-btn" data-tpl-move="1" ${index === total - 1 ? 'disabled' : ''} aria-label="העברה למטה">↓</button>
        <button type="button" class="ifb-icon-btn ifb-icon-btn--danger" data-tpl-remove aria-label="הסרת השאלה">✕</button>
      </span>
    </div>
    <label class="ifb-field"><span>ניסוח השאלה</span><textarea rows="2" data-tq-field="wording.default">${esc(q.wording?.default || '')}</textarea></label>
    <div class="ifb-tq__row">
      <label class="ifb-field"><span>סוג תשובה</span><select data-tq-field="question_type">${typeOptions(q.question_type)}</select></label>
      <label class="ifb-field"><span>מדד</span><select data-tq-field="metric_key">${metricOptions(ui, q.metric_key)}</select></label>
      <label class="ifb-check"><input type="checkbox" data-tq-field="required"${q.required ? ' checked' : ''}> חובה</label>
      ${q.question_type === 'rating_1_5' ? `<label class="ifb-check" title="מוסיף לשאלה את האפשרות „לא רלוונטי / לא הייתה אפשרות להעריך”. תשובה כזו אינה נכללת בממוצע."><input type="checkbox" data-tq-field="allow_na"${allowsNa(q) ? ' checked' : ''}> אפשרות „לא רלוונטי”</label>` : ''}
    </div>
    ${SELECT_TYPES.has(q.question_type) ? `<label class="ifb-field"><span>אפשרויות (שורה לכל אפשרות: ערך|תווית)</span><textarea rows="3" data-tq-field="options">${esc(optionsToText(q.options))}</textarea></label>` : ''}
  </li>`;
}

function addFormHtml(ed, ui) {
  const used = new Set(ed.draftQuestions.map((q) => q.question_id));
  const bank = (ed.bank || []).filter((q) => !used.has(q.id));
  const isStudent = ed.template.audience === 'student';
  return `
    <section class="ifb-panel">
      <h3>הוספת שאלה</h3>
      ${bank.length ? `<form class="ifb-tpl-add" data-tpl-add-bank>
        <label class="ifb-field"><span>מבנק השאלות (שאלות שהוסרו או שאלות ליבה)</span><select name="bank">${bank.map((q) => `<option value="${esc(q.id)}">${esc(q.wording?.default || q.question_key)}</option>`).join('')}</select></label>
        <button type="submit" class="ifb-btn">הוספה</button>
      </form>` : ''}
      <form class="ifb-tpl-add" data-tpl-add-new>
        <label class="ifb-field ifb-field--wide"><span>ניסוח שאלה חדשה</span><input type="text" name="text" required maxlength="400"></label>
        <label class="ifb-field"><span>סוג</span><select name="type">${typeOptions('rating_1_5')}</select></label>
        <label class="ifb-field"><span>מדד</span><select name="metric">${metricOptions(ui, ed.template.audience === 'instructor' ? 'content' : 'knowledge')}</select></label>
        <label class="ifb-field ifb-field--wide"><span>אפשרויות לבחירה (רק לסוגי בחירה, ערך|תווית בכל שורה)</span><textarea name="options" rows="2"></textarea></label>
        <label class="ifb-check"><input type="checkbox" name="required" checked> חובה</label>
        ${isStudent ? '<label class="ifb-check"><input type="checkbox" name="comparison"> שאלת השוואה (תופיע גם בטיוטת התבנית השנייה של התלמידים לאחר פרסום)</label>' : ''}
        <button type="submit" class="ifb-btn ifb-btn--primary">הוספת שאלה</button>
      </form>
    </section>`;
}

function editorHtml(ui) {
  const ed = tpl.editor;
  if (tpl.loadingEditor || !ed) return '<div class="ifb-empty"><div class="ds-spinner"></div><p>טוען תבנית…</p></div>';
  const program = ui.programs.find((p) => p.key === ed.template.program_key);
  const slot = slotOf(ed.template);
  const editing = Boolean(ed.draft);
  const questions = editing ? ed.draftQuestions : ed.publishedQuestions;
  const defaults = templateDefaults(questions);
  return `
    <button type="button" class="ifb-back" data-tpl-back>→ חזרה לרשימת השאלונים</button>
    <section class="ifb-group-head ifb-tpl-head">
      <div class="ifb-tpl-head__titles">
        <p class="ifb-tpl-head__program">${esc(courseLabel(program, ui.programs))}</p>
        ${programMeta(program) ? `<p class="ifb-tpl-head__meta">${esc(programMeta(program))}</p>` : ''}
        <h2 class="ifb-tpl-head__title">${esc(slot ? templateSlotLabel(slot) : '')}</h2>
        ${!ed.published ? '<p class="ifb-tpl-head__status">טרם פורסם</p>' : `<p class="ifb-tpl-head__status">גרסה מפורסמת: ${esc(String(versionsOf(ed.template).find((v) => v.id === ed.published.id)?.version_no ?? ''))}</p>`}
        ${editing ? '<p class="ifb-tpl-head__status is-draft">טיוטה בעריכה</p>' : ''}
      </div>
      <div class="ifb-slot__actions ifb-tpl-head__actions">
        <button type="button" class="ifb-btn" data-tpl-preview>תצוגה מקדימה</button>
        ${editing
          ? `<button type="button" class="ifb-btn ifb-btn--primary" data-tpl-publish>פרסום גרסה חדשה</button>
             <button type="button" class="ifb-btn ifb-btn--danger" data-tpl-discard>ביטול הטיוטה</button>`
          : '<button type="button" class="ifb-btn ifb-btn--primary" data-tpl-edit title="יצירת טיוטה לעריכה">עריכה</button>'}
      </div>
      ${editing ? `<label class="ifb-field ifb-field--wide ifb-tpl-head__intro"><span>טקסט פתיחה בשאלון</span><textarea rows="2" data-tpl-intro>${esc(ed.draft.intro_text || '')}</textarea></label>`
        : (ed.published?.intro_text ? `<div class="ifb-tpl-head__intro"><span>טקסט פתיחה</span><p>${esc(ed.published.intro_text)}</p></div>` : '')}
    </section>
    <section class="ifb-tq-block">
      ${listSummaryHtml(questions, defaults)}
      ${questions.length ? `<ol class="ifb-tq-list">${questions.map((q, i) => (editing ? editableQuestionHtml(q, i, questions.length, ui, defaults) : readOnlyQuestionHtml(q, i, ui, defaults))).join('')}</ol>` : ''}
    </section>
    ${editing ? addFormHtml(ed, ui) : ''}`;
}

export function renderTemplatesView(ui) {
  if (tpl.error) return `<div class="ifb-empty ifb-empty--error" role="alert"><p>${esc(tpl.error)}</p><button type="button" class="ifb-btn" data-tpl-reload>נסו שוב</button></div>`;
  return `<div data-ifb-templates>${ui.templates.templateId ? editorHtml(ui) : listHtml(ui)}</div>`;
}

/** True while a questionnaire editor is open (the hosting tab then shows only the editor). */
export function isTemplateEditorOpen(ui) {
  return Boolean(ui.templates.templateId);
}

async function loadList(repaint, force = false) {
  if ((tpl.list && !force) || tpl.loadingList) return;
  tpl.loadingList = true;
  try {
    const [templates, paperPdfs] = await Promise.all([fetchTemplates(), fetchSavedPaperPdfs()]);
    tpl.list = templates;
    tpl.paperPdfs = paperPdfs;
    tpl.error = '';
  } catch (error) {
    tpl.error = translateFeedbackError(error);
  } finally {
    tpl.loadingList = false;
    repaint();
  }
}

async function loadEditor(ui, repaint) {
  tpl.loadingEditor = true;
  repaint();
  try {
    await loadList(() => {}, true);
    const template = tpl.list.find((t) => t.id === ui.templates.templateId);
    if (!template) throw new Error('התבנית לא נמצאה');
    const versions = versionsOf(template);
    const draftMeta = versions.find((v) => v.status === 'draft');
    const [published, publishedQuestions, draft, draftQuestions, bank] = await Promise.all([
      template.current_version_id ? fetchVersion(template.current_version_id) : null,
      template.current_version_id ? fetchVersionQuestions(template.current_version_id) : [],
      draftMeta ? fetchVersion(draftMeta.id) : null,
      draftMeta ? fetchVersionQuestions(draftMeta.id) : [],
      fetchBankQuestions(template.program_key, template.audience, template.stage)
    ]);
    tpl.editor = { template, published, publishedQuestions: publishedQuestions || [], draft, draftQuestions: draftQuestions || [], bank };
    tpl.error = '';
  } catch (error) {
    tpl.error = translateFeedbackError(error);
  } finally {
    tpl.loadingEditor = false;
    repaint();
  }
}

function openPreview(ui) {
  const ed = tpl.editor;
  const program = ui.programs.find((p) => p.key === ed.template.program_key);
  const source = ed.draft ? ed.draftQuestions : ed.publishedQuestions;
  const payload = {
    audience: ed.template.audience,
    stage: ed.template.stage,
    age_band: null,
    program_title: program?.title || '',
    recipient_name: ed.template.audience === 'student' ? '' : 'שם הנמען',
    intro_text: (ed.draft || ed.published)?.intro_text || '',
    questions: source.map((q) => ({
      id: q.id,
      type: q.question_type,
      text: String(q.wording?.default || '').replaceAll('{topic}', program?.topic || ''),
      options: q.options || [],
      required: q.required,
      allow_na: allowsNa(q)
    }))
  };
  const overlay = document.createElement('div');
  overlay.className = 'ifb-preview-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = '<div class="ifb-preview"><div class="ifb-preview__bar"><strong>תצוגה מקדימה – כך יראה השאלון בטלפון</strong><button type="button" class="ifb-btn ifb-btn--sm" data-preview-close>סגירה</button></div><div class="ifb-preview__phone" data-preview-body></div></div>';
  document.body.append(overlay);
  mountFeedbackForm(overlay.querySelector('[data-preview-body]'), payload, {
    preview: true,
    logoUrl: new URL('../../assets/certificates/logos/taasiyeda1.png', import.meta.url).href,
    onSubmit: async () => {
      showToast('תצוגה מקדימה – התשובות לא נשמרות', 'info');
      return { ok: false, state: 'preview' };
    }
  });
  const close = () => overlay.remove();
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-preview-close]')) close();
  });
}

async function withSave(action, repaint, { reload = false, ui } = {}) {
  try {
    await action();
    if (reload) await loadEditor(ui, repaint);
  } catch (error) {
    showToast(translateFeedbackError(error), 'error', 5000);
    if (ui) await loadEditor(ui, repaint);
  }
}

async function saveQuestionField(ui, repaint, row, field, input) {
  const ed = tpl.editor;
  const q = ed.draftQuestions.find((item) => item.id === row.dataset.tq);
  if (!q) return;
  let patch;
  let needsRepaint = false;
  if (field.startsWith('wording.')) {
    const key = field.slice(8);
    const value = input.value.trim();
    if (key === 'default' && !value) {
      showToast('ניסוח השאלה הוא חובה', 'error');
      input.value = q.wording?.default || '';
      return;
    }
    patch = { wording: { default: value } };
  } else if (field === 'required') {
    patch = { required: input.checked };
  } else if (field === 'question_type') {
    patch = { question_type: input.value };
    if (SELECT_TYPES.has(input.value) && !(q.options || []).length) patch.options = [{ value: 'option_1', label: 'אפשרות 1' }, { value: 'option_2', label: 'אפשרות 2' }];
    patch.scoring = input.value === 'rating_1_5' ? { include_in_score: true } : { include_in_score: false };
    needsRepaint = true;
  } else if (field === 'allow_na') {
    const scoring = { ...(q.scoring || {}) };
    if (input.checked) scoring.allow_na = true;
    else delete scoring.allow_na;
    patch = { scoring };
  } else if (field === 'metric_key') {
    patch = { metric_key: input.value };
  } else if (field === 'options') {
    const options = textToOptions(input.value);
    if (options.length < 2) {
      showToast('יש להגדיר לפחות שתי אפשרויות', 'error');
      return;
    }
    patch = { options };
  }
  if (!patch) return;
  await withSave(async () => {
    await updateTemplateQuestion(q.id, patch);
    Object.assign(q, patch);
  }, repaint, { ui });
  if (needsRepaint) repaint();
}

export function bindTemplatesView(host, ui, repaint) {
  const root = host.querySelector('[data-ifb-templates]');
  if (!root) {
    if (tpl.error) host.querySelector('[data-tpl-reload]')?.addEventListener('click', () => { tpl.error = ''; tpl.list = null; loadList(repaint, true); });
    return;
  }
  if (!ui.templates.templateId && !tpl.list) loadList(repaint);
  if (ui.templates.templateId && !tpl.editor && !tpl.loadingEditor && !tpl.error) loadEditor(ui, repaint);

  root.addEventListener('click', async (event) => {
    const t = event.target;
    const pdf = t.closest('[data-tpl-pdf]');
    if (pdf) {
      const template = tpl.list?.find((item) => item.id === pdf.dataset.tplPdf);
      const record = tpl.paperPdfs?.find((item) => item.template_id === template?.id && item.language === pdf.dataset.tplLang);
      if (!record || record.version_id !== template?.current_version_id || pdf.disabled) return;
      pdf.disabled = true;
      try {
        await downloadSavedPaperPdf(record);
      } catch (error) {
        showToast(translateFeedbackError(error), 'error', 5000);
      } finally {
        pdf.disabled = false;
      }
      return;
    }
    const upload = t.closest('[data-tpl-upload]');
    if (upload) {
      const template = tpl.list?.find((item) => item.id === upload.dataset.tplUpload);
      if (!template?.current_version_id || upload.disabled) return;
      const picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = '.pdf,application/pdf';
      picker.style.display = 'none';
      document.body.append(picker);
      picker.addEventListener('change', async () => {
        const file = picker.files?.[0];
        picker.remove();
        if (!file) return;
        upload.disabled = true;
        try {
          await uploadSavedPaperPdf(template, file, upload.dataset.tplLang);
          await loadList(repaint, true);
          showToast('ה־PDF נשמר בהצלחה', 'success');
        } catch (error) {
          showToast(translateFeedbackError(error), 'error', 6000);
          upload.disabled = false;
        }
      }, { once: true });
      picker.click();
      return;
    }
    const remove = t.closest('[data-tpl-delete]');
    if (remove) {
      const template = tpl.list?.find((item) => item.id === remove.dataset.tplDelete);
      const record = tpl.paperPdfs?.find((item) => item.template_id === template?.id && item.language === remove.dataset.tplLang);
      if (!record || !window.confirm(`למחוק את קובץ ה־PDF השמור בשפה ${record.language === 'ar' ? 'ערבית' : 'עברית'}?`)) return;
      remove.disabled = true;
      try {
        await deleteSavedPaperPdf(record);
        await loadList(repaint, true);
        showToast('ה־PDF נמחק', 'success');
      } catch (error) {
        showToast(translateFeedbackError(error), 'error', 5000);
        remove.disabled = false;
      }
      return;
    }
    const open = t.closest('[data-tpl-open]');
    if (open) {
      ui.templates.templateId = open.dataset.tplOpen;
      tpl.editor = null;
      await loadEditor(ui, repaint);
      window.scrollTo({ top: 0 });
      return;
    }
    if (t.closest('[data-tpl-back]')) {
      ui.templates.templateId = null;
      tpl.editor = null;
      await loadList(repaint, true);
      return;
    }
    if (t.closest('[data-tpl-preview]')) { openPreview(ui); return; }
    if (t.closest('[data-tpl-edit]')) {
      await withSave(() => getDraft(tpl.editor.template.id), repaint, { reload: true, ui });
      showToast('נוצרה טיוטה לעריכה');
      return;
    }
    if (t.closest('[data-tpl-discard]')) {
      if (!window.confirm('לבטל את הטיוטה? השינויים שלא פורסמו יימחקו.')) return;
      await withSave(() => discardDraft(tpl.editor.draft.id), repaint, { reload: true, ui });
      return;
    }
    if (t.closest('[data-tpl-publish]')) {
      if (!tpl.editor.draftQuestions.length) { showToast('לא ניתן לפרסם שאלון ריק', 'error'); return; }
      if (!window.confirm('לפרסם גרסה חדשה? משובים חדשים ייפתחו עם הגרסה הזו; משובים קיימים יישארו על הגרסה שלהם.')) return;
      await withSave(() => publishDraft(tpl.editor.draft.id), repaint, { reload: true, ui });
      showToast('הגרסה פורסמה');
      return;
    }
    const row = t.closest('[data-tq]');
    if (!row) return;
    const list = tpl.editor.draftQuestions;
    const index = list.findIndex((q) => q.id === row.dataset.tq);
    const move = t.closest('[data-tpl-move]');
    if (move) {
      const other = index + Number(move.dataset.tplMove);
      if (other < 0 || other >= list.length) return;
      const a = list[index];
      const b = list[other];
      const orders = [a.sort_order, b.sort_order];
      await withSave(async () => {
        // Two-step swap keeps sort orders unique-ish even on concurrent edits.
        await updateTemplateQuestion(a.id, { sort_order: orders[1] });
        await updateTemplateQuestion(b.id, { sort_order: orders[0] });
        a.sort_order = orders[1];
        b.sort_order = orders[0];
        list.sort((x, y) => x.sort_order - y.sort_order);
      }, repaint, { ui });
      repaint();
      return;
    }
    if (t.closest('[data-tpl-remove]')) {
      if (!window.confirm('להסיר את השאלה מהטיוטה?')) return;
      await withSave(async () => {
        await deleteTemplateQuestion(list[index].id);
        list.splice(index, 1);
      }, repaint, { ui });
      repaint();
    }
  });

  root.addEventListener('change', async (event) => {
    const input = event.target;
    if (input.matches('[data-tpl-intro]')) {
      await withSave(() => updateVersionIntro(tpl.editor.draft.id, input.value.trim()), repaint, { ui });
      tpl.editor.draft.intro_text = input.value.trim();
      return;
    }
    const field = input.dataset.tqField;
    const row = input.closest('[data-tq]');
    if (field && row) await saveQuestionField(ui, repaint, row, field, input);
  });

  root.addEventListener('submit', async (event) => {
    const form = event.target;
    const ed = tpl.editor;
    if (!ed?.draft) return;
    const nextOrder = (ed.draftQuestions.reduce((max, q) => Math.max(max, q.sort_order), 0) || 0) + 10;
    if (form.matches('[data-tpl-add-bank]')) {
      event.preventDefault();
      const bankQuestion = ed.bank.find((q) => q.id === new FormData(form).get('bank'));
      if (!bankQuestion) return;
      await withSave(() => addBankQuestionToDraft(ed.draft.id, bankQuestion, nextOrder), repaint, { reload: true, ui });
      return;
    }
    if (form.matches('[data-tpl-add-new]')) {
      event.preventDefault();
      const data = new FormData(form);
      const type = String(data.get('type'));
      const options = SELECT_TYPES.has(type) ? textToOptions(String(data.get('options') || '')) : [];
      if (SELECT_TYPES.has(type) && options.length < 2) { showToast('לשאלת בחירה יש להגדיר לפחות שתי אפשרויות', 'error'); return; }
      await withSave(() => createQuestionInDraft(ed.draft.id, {
        programKey: ed.template.program_key,
        audience: ed.template.audience,
        stage: ed.template.stage,
        metricKey: String(data.get('metric')),
        questionType: type,
        text: String(data.get('text') || '').trim(),
        options,
        required: data.get('required') === 'on',
        isComparison: data.get('comparison') === 'on'
      }, nextOrder), repaint, { reload: true, ui });
      showToast('השאלה נוספה לטיוטה');
    }
  });
}

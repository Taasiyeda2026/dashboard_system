/**
 * Impact feedback — "הגדרות → תבניות ושאלות".
 * Published versions are read-only; edits happen in a draft version that is published
 * as a new version. Campaigns stay pinned to the version they were opened with.
 */
import { escapeHtml as esc } from '../screens/shared/html.js';
import { showToast } from '../screens/shared/toast.js';
import { QUESTION_TYPES, SLOTS } from './feedback-domain.js';
import {
  addBankQuestionToDraft,
  createQuestionInDraft,
  deleteTemplateQuestion,
  discardDraft,
  fetchBankQuestions,
  fetchTemplates,
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

function listHtml(ui) {
  if (!tpl.list) return '<div class="ifb-empty"><div class="ds-spinner"></div><p>טוען תבניות…</p></div>';
  const byProgram = new Map(ui.programs.map((p) => [p.key, []]));
  for (const t of tpl.list) byProgram.get(t.program_key)?.push(t);
  return `
    <div class="ifb-programs">${ui.programs.map((program) => `
      <section class="ifb-program-card">
        <h3>${esc(program.title)}</h3>
        <p class="ifb-program-card__meta">${esc(programMeta(program))}</p>
        <div class="ifb-program-card__tiles">${SLOTS.map((slot) => {
          const template = (byProgram.get(program.key) || []).find((t) => t.audience === slot.audience && t.stage === slot.stage);
          if (!template) return '';
          const versions = versionsOf(template);
          const current = versions.find((v) => v.id === template.current_version_id);
          const draft = versions.find((v) => v.status === 'draft');
          return `<button type="button" class="ifb-tile" data-tpl-open="${esc(template.id)}">
            <strong>${esc(slot.label)}</strong>
            ${!current ? '<span>טרם פורסם</span>' : ''}
            ${draft ? '<span class="ifb-chip ifb-chip--info">טיוטה בעריכה</span>' : ''}
          </button>`;
        }).join('')}</div>
      </section>`).join('')}</div>`;
}

function metricOptions(ui, selected) {
  return ui.metrics.map((m) => `<option value="${esc(m.key)}"${m.key === selected ? ' selected' : ''}>${esc(m.label)}${m.kind === 'program' ? ' (איכות התוכנית)' : ''}</option>`).join('');
}

function typeOptions(selected) {
  return QUESTION_TYPES.map((t) => `<option value="${t.key}"${t.key === selected ? ' selected' : ''}>${esc(t.label)}</option>`).join('');
}

function readOnlyQuestionHtml(q, index, ui) {
  const metric = ui.metrics.find((m) => m.key === q.metric_key)?.label || q.metric_key;
  return `<li class="ifb-tq is-readonly">
    <div class="ifb-tq__head"><span class="ifb-tq__num">${index + 1}</span>
      <span class="ifb-chip ifb-chip--muted">${q.section === 'course' ? 'ייחודית לתוכנית' : 'ליבה'}</span>
      <span class="ifb-chip ifb-chip--muted">${esc(QUESTION_TYPES.find((t) => t.key === q.question_type)?.label || '')}</span>
      <span class="ifb-chip ifb-chip--muted">${esc(metric)}</span>
      ${q.is_comparison ? '<span class="ifb-chip ifb-chip--info">השוואת פתיחה–סיום</span>' : ''}
      ${q.required ? '' : '<span class="ifb-chip ifb-chip--muted">לא חובה</span>'}
    </div>
    <p class="ifb-tq__text">${esc(q.wording?.default || '')}</p>
    ${SELECT_TYPES.has(q.question_type) ? `<p class="ifb-tq__variant"><span>אפשרויות:</span> ${esc((q.options || []).map((o) => o.label).join(' · '))}</p>` : ''}
  </li>`;
}

function editableQuestionHtml(q, index, total, ui) {
  return `<li class="ifb-tq" data-tq="${esc(q.id)}">
    <div class="ifb-tq__head">
      <span class="ifb-tq__num">${index + 1}</span>
      <span class="ifb-chip ifb-chip--muted">${q.section === 'course' ? 'ייחודית לתוכנית' : 'ליבה'}</span>
      ${q.is_comparison ? '<span class="ifb-chip ifb-chip--info" title="אותה שאלה בפתיחה ובסיום – משמשת להשוואת PRE/POST">השוואת פתיחה–סיום</span>' : ''}
      <span class="ifb-tq__tools">
        <button type="button" class="ifb-icon-btn" data-tpl-move="-1" ${index === 0 ? 'disabled' : ''} aria-label="העברה למעלה">↑</button>
        <button type="button" class="ifb-icon-btn" data-tpl-move="1" ${index === total - 1 ? 'disabled' : ''} aria-label="העברה למטה">↓</button>
        <button type="button" class="ifb-icon-btn ifb-icon-btn--danger" data-tpl-remove aria-label="הסרת השאלה">✕</button>
      </span>
    </div>
    <label class="ifb-field"><span>ניסוח השאלה</span><textarea rows="2" data-tq-field="wording.default">${esc(q.wording?.default || '')}</textarea></label>
    <p class="ifb-muted">אפשר להשתמש ב־{topic} כדי לשלב את נושא התוכנית.</p>
    <div class="ifb-tq__row">
      <label class="ifb-field"><span>סוג תשובה</span><select data-tq-field="question_type">${typeOptions(q.question_type)}</select></label>
      <label class="ifb-field"><span>מדד</span><select data-tq-field="metric_key">${metricOptions(ui, q.metric_key)}</select></label>
      <label class="ifb-check"><input type="checkbox" data-tq-field="required"${q.required ? ' checked' : ''}> חובה</label>
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
  return `
    <button type="button" class="ifb-back" data-tpl-back>→ חזרה לכל התבניות</button>
    <section class="ifb-group-head">
      <div>
        <p class="ifb-kicker">${esc(program?.title || '')}${programMeta(program) ? ` · ${esc(programMeta(program))}` : ''}</p>
        <h2 class="ifb-group-head__title">${esc(slot?.label || '')}</h2>
        ${!ed.published ? '<p class="ifb-muted">טרם פורסם</p>' : ''}
        ${editing ? '<p class="ifb-muted">טיוטה בעריכה</p>' : ''}
      </div>
      <div class="ifb-slot__actions">
        <button type="button" class="ifb-btn" data-tpl-preview>תצוגה מקדימה</button>
        ${editing
          ? `<button type="button" class="ifb-btn ifb-btn--primary" data-tpl-publish>פרסום גרסה חדשה</button>
             <button type="button" class="ifb-btn ifb-btn--danger" data-tpl-discard>ביטול הטיוטה</button>`
          : '<button type="button" class="ifb-btn ifb-btn--primary" data-tpl-edit>עריכה (יצירת טיוטה)</button>'}
      </div>
    </section>
    ${editing ? `<label class="ifb-field ifb-field--wide"><span>טקסט פתיחה בשאלון</span><textarea rows="2" data-tpl-intro>${esc(ed.draft.intro_text || '')}</textarea></label>`
      : (ed.published?.intro_text ? `<p class="ifb-note">טקסט פתיחה: ${esc(ed.published.intro_text)}</p>` : '')}
    <ol class="ifb-tq-list">${questions.map((q, i) => (editing ? editableQuestionHtml(q, i, questions.length, ui) : readOnlyQuestionHtml(q, i, ui))).join('')}</ol>
    ${editing ? addFormHtml(ed, ui) : ''}`;
}

export function renderTemplatesView(ui) {
  if (tpl.error) return `<div class="ifb-empty ifb-empty--error"><p>${esc(tpl.error)}</p><button type="button" class="ifb-btn" data-tpl-reload>נסו שוב</button></div>`;
  return `<div data-ifb-templates>${ui.templates.templateId ? editorHtml(ui) : listHtml(ui)}</div>`;
}

async function loadList(repaint, force = false) {
  if ((tpl.list && !force) || tpl.loadingList) return;
  tpl.loadingList = true;
  try {
    tpl.list = await fetchTemplates();
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
      required: q.required
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

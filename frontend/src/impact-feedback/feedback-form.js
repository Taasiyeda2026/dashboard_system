/**
 * Questionnaire renderer shared by the public page (feedback.html) and the admin preview.
 * Mobile-first, RTL. Values are always stored on a 1–5 scale. Smileys are reserved
 * for young student questionnaires only; adult audiences always see a professional numeric scale.
 */
import {
  RATING_EMOJI,
  RATING_LABELS,
  STAGE_LABELS,
  formProgress,
  isAnswered,
  missingRequired
} from './feedback-domain.js';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function headline(payload) {
  if (payload.audience === 'instructor') return payload.stage === 'pre' ? 'משוב מדריך – פתיחה' : 'משוב מדריך – סיום';
  if (payload.audience === 'educational_staff') return 'משוב צוות חינוכי';
  return `שאלון ${STAGE_LABELS[payload.stage] || ''}`.trim();
}

const NA_LABEL = 'לא רלוונטי / לא הייתה אפשרות להעריך';

function ratingHtml(q, value, young) {
  const name = `q-${q.id}`;
  const buttons = [1, 2, 3, 4, 5].map((n) => `
    <label class="ifb-rate__opt${young ? ' is-emoji' : ''}">
      <input type="radio" name="${esc(name)}" value="${n}" data-qid="${esc(q.id)}" data-kind="rating"${Number(value) === n ? ' checked' : ''}>
      <span class="ifb-rate__face" aria-hidden="true">${young ? RATING_EMOJI[n - 1] : n}</span>
      <span class="ifb-sr">${n} – ${esc(RATING_LABELS[n - 1])}</span>
      ${young ? `<span class="ifb-rate__caption" aria-hidden="true">${esc(RATING_LABELS[n - 1])}</span>` : ''}
    </label>`).join('');
  const na = q.allow_na ? `
    <label class="ifb-rate__na">
      <input type="radio" name="${esc(name)}" value="na" data-qid="${esc(q.id)}" data-kind="rating"${value === 'na' ? ' checked' : ''}>
      <span>${esc(NA_LABEL)}</span>
    </label>` : '';
  return `
    <div class="ifb-rate" role="radiogroup" aria-label="${esc(q.text)}">${buttons}</div>
    ${young ? '' : `<div class="ifb-rate__ends" aria-hidden="true"><span>${esc(RATING_LABELS[0])}</span><span>${esc(RATING_LABELS[4])}</span></div>`}
    ${na}`;
}

function choiceHtml(q, value, multiple) {
  const selected = new Set(multiple ? (Array.isArray(value) ? value : []) : [value]);
  const options = Array.isArray(q.options) ? q.options : [];
  return `<div class="ifb-choices${multiple ? ' is-multi' : ''}" role="${multiple ? 'group' : 'radiogroup'}" aria-label="${esc(q.text)}">
    ${options.map((o) => `
      <label class="ifb-choice">
        <input type="${multiple ? 'checkbox' : 'radio'}" name="q-${esc(q.id)}" value="${esc(o.value)}" data-qid="${esc(q.id)}" data-kind="${multiple ? 'multi' : 'single'}"${selected.has(o.value) ? ' checked' : ''}>
        <span>${esc(o.label || o.value)}</span>
      </label>`).join('')}
  </div>`;
}

function yesNoHtml(q, value) {
  return `<div class="ifb-choices is-yesno" role="radiogroup" aria-label="${esc(q.text)}">
    <label class="ifb-choice"><input type="radio" name="q-${esc(q.id)}" value="true" data-qid="${esc(q.id)}" data-kind="bool"${value === true ? ' checked' : ''}><span>כן</span></label>
    <label class="ifb-choice"><input type="radio" name="q-${esc(q.id)}" value="false" data-qid="${esc(q.id)}" data-kind="bool"${value === false ? ' checked' : ''}><span>לא</span></label>
  </div>`;
}

function textHtml(q, value) {
  return `<textarea class="ifb-text" rows="3" maxlength="2000" data-qid="${esc(q.id)}" data-kind="text" aria-label="${esc(q.text)}" placeholder="אפשר לכתוב כאן…">${esc(value || '')}</textarea>`;
}

function questionHtml(q, index, answers, young, bilingual = false) {
  const value = answers[q.id];
  let control = '';
  if (q.type === 'rating_1_5') control = ratingHtml(q, value, young);
  else if (q.type === 'yes_no') control = yesNoHtml(q, value);
  else if (q.type === 'single_select') control = choiceHtml(q, value, false);
  else if (q.type === 'multi_select') control = choiceHtml(q, value, true);
  else control = textHtml(q, value);
  return `
    <fieldset class="ifb-q${isAnswered(q, value) ? ' is-answered' : ''}" data-question="${esc(q.id)}">
      <legend class="ifb-q__title">
        <span class="ifb-q__num" aria-hidden="true">${index + 1}</span>
        <span>${esc(q.text)}${bilingual && q.text_ar ? `<span lang="ar" dir="rtl" style="display:block;margin-top:0.35rem;font-weight:500">${esc(q.text_ar)}</span>` : ''}${q.required ? '' : ' <span class="ifb-q__optional">(לא חובה)</span>'}</span>
      </legend>
      ${q.type === 'multi_select' ? '<p class="ifb-q__hint">אפשר לבחור כמה תשובות</p>' : ''}
      ${control}
      <p class="ifb-q__error" hidden>נשמח לתשובה לשאלה הזו</p>
    </fieldset>`;
}

export function messageCardHtml({ title, body, logoUrl = '', extra = '' }) {
  return `
    <section class="ifb-card ifb-message" role="status">
      ${logoUrl ? `<img class="ifb-logo ifb-logo--center" src="${esc(logoUrl)}" alt="תעשיידע">` : ''}
      <h1 class="ifb-message__title">${esc(title)}</h1>
      <p class="ifb-message__body">${esc(body)}</p>
      ${extra}
    </section>`;
}

/**
 * Renders the questionnaire into `container`.
 * options.onSubmit(answers) -> Promise<{ ok, state, missing? }>; options.initialAnswers; options.onChange(answers)
 */
export function mountFeedbackForm(container, payload, options = {}) {
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  const young = payload.audience === 'student' && payload.age_band === 'a_c';
  const answers = { ...(options.initialAnswers || {}) };
  const logoUrl = options.logoUrl || '';

  const audienceClass = payload.audience === 'student' ? ' is-student' : ' is-adult';
  container.innerHTML = `
    <div class="ifb-shell${young ? ' is-young' : ''}${audienceClass}">
      <header class="ifb-hero">
        ${logoUrl ? `<img class="ifb-logo" src="${esc(logoUrl)}" alt="תעשיידע">` : ''}
        ${options.onChooseLanguage ? '<button type="button" class="ifb-hero__change-language" data-ifb-change-language>בחירת שפה / اختيار اللغة</button>' : ''}
        <p class="ifb-hero__kicker">${esc(headline(payload))}</p>
        <h1 class="ifb-hero__title">${esc(payload.program_title || '')}</h1>
        ${payload.recipient_name ? `<p class="ifb-hero__hello">שלום ${esc(payload.recipient_name)}</p>` : ''}
        ${payload.intro_text ? `<p class="ifb-hero__intro">${esc(payload.intro_text)}</p>` : ''}
      </header>
      <div class="ifb-progress" aria-hidden="true">
        <div class="ifb-progress__track"><div class="ifb-progress__fill" data-progress-fill></div></div>
        <span class="ifb-progress__label" data-progress-label></span>
      </div>
      <form class="ifb-form" novalidate>
        ${questions.map((q, i) => questionHtml(q, i, answers, young, Boolean(options.bilingual))).join('')}
        <div class="ifb-submit">
          <p class="ifb-submit__error" data-submit-error role="alert" hidden></p>
          <button type="submit" class="ifb-submit__btn" data-submit>${options.preview ? 'שליחה (תצוגה מקדימה)' : 'שליחת המשוב'}</button>
        </div>
      </form>
    </div>`;

  const form = container.querySelector('form');
  const fill = container.querySelector('[data-progress-fill]');
  const label = container.querySelector('[data-progress-label]');
  const submitBtn = container.querySelector('[data-submit]');
  const submitError = container.querySelector('[data-submit-error]');
  container.querySelector('[data-ifb-change-language]')?.addEventListener('click', () => {
    // onChange persists any draft answer before the user leaves the questionnaire.
    options.onChange?.({ ...answers });
    options.onChooseLanguage?.();
  });

  function updateProgress() {
    const pct = formProgress(questions, answers);
    const answered = questions.filter((q) => isAnswered(q, answers[q.id])).length;
    fill.style.width = `${pct}%`;
    label.textContent = `${answered} מתוך ${questions.length}`;
  }

  function markQuestion(qid) {
    const q = questions.find((item) => item.id === qid);
    const node = form.querySelector(`[data-question="${CSS.escape(qid)}"]`);
    if (!q || !node) return;
    const answered = isAnswered(q, answers[qid]);
    node.classList.toggle('is-answered', answered);
    if (answered) {
      node.classList.remove('is-missing');
      node.querySelector('.ifb-q__error').hidden = true;
    }
  }

  form.addEventListener('change', (event) => {
    const input = event.target;
    const qid = input?.dataset?.qid;
    if (!qid) return;
    const kind = input.dataset.kind;
    if (kind === 'rating') answers[qid] = input.value === 'na' ? 'na' : Number(input.value);
    else if (kind === 'bool') answers[qid] = input.value === 'true';
    else if (kind === 'single') answers[qid] = input.value;
    else if (kind === 'multi') {
      answers[qid] = [...form.querySelectorAll(`input[data-qid="${CSS.escape(qid)}"]:checked`)].map((el) => el.value);
    }
    markQuestion(qid);
    updateProgress();
    options.onChange?.({ ...answers });
  });

  form.addEventListener('input', (event) => {
    const input = event.target;
    if (input?.dataset?.kind !== 'text') return;
    answers[input.dataset.qid] = input.value;
    markQuestion(input.dataset.qid);
    updateProgress();
    options.onChange?.({ ...answers });
  });

  function showMissing(ids) {
    let first = null;
    for (const id of ids) {
      const node = form.querySelector(`[data-question="${CSS.escape(id)}"]`);
      if (!node) continue;
      node.classList.add('is-missing');
      node.querySelector('.ifb-q__error').hidden = false;
      if (!first) first = node;
    }
    if (first) {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first.querySelector('input,textarea')?.focus({ preventScroll: true });
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitBtn.disabled) return;
    submitError.hidden = true;
    const missing = missingRequired(questions, answers);
    if (missing.length) {
      submitError.textContent = missing.length === 1 ? 'נשארה שאלה אחת שלא נענתה' : `נשארו ${missing.length} שאלות שלא נענו`;
      submitError.hidden = false;
      showMissing(missing);
      return;
    }
    submitBtn.disabled = true;
    submitBtn.classList.add('is-busy');
    submitBtn.textContent = 'שולח…';
    try {
      const payloadAnswers = {};
      for (const q of questions) {
        const value = answers[q.id];
        if (!isAnswered(q, value)) continue;
        payloadAnswers[q.id] = q.type === 'free_text' ? String(value).trim() : value;
      }
      const result = await options.onSubmit?.(payloadAnswers);
      if (result?.state === 'invalid_answers') {
        showMissing([...(result.missing || []), ...(result.invalid || [])]);
        throw new Error('יש לבדוק את התשובות המסומנות');
      }
      if (result && result.ok === false && result.state !== 'invalid_answers') return;
    } catch (error) {
      submitError.textContent = error?.message || 'השליחה נכשלה. נסו שוב.';
      submitError.hidden = false;
    } finally {
      if (submitBtn.isConnected) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('is-busy');
        submitBtn.textContent = options.preview ? 'שליחה (תצוגה מקדימה)' : 'שליחת המשוב';
      }
    }
  });

  updateProgress();
  return { answers };
}

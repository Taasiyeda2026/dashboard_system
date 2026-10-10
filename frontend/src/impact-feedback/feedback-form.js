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
const AR_RATING_LABELS = ['غير صحيح بالنسبة لي إطلاقًا', 'صحيح بالنسبة لي قليلًا', 'صحيح بالنسبة لي إلى حدّ ما', 'صحيح بالنسبة لي بدرجة كبيرة', 'صحيح جدًا بالنسبة لي'];
const arLabel = (he, ar, lang) => lang === 'ar' ? ar : he;

function ratingHtml(q, value, young, lang = 'he') {
  const labels = lang === 'ar' ? AR_RATING_LABELS : RATING_LABELS;
  const name = `q-${q.id}`;
  const buttons = [1, 2, 3, 4, 5].map((n) => `
    <label class="ifb-rate__opt${young ? ' is-emoji' : ''}">
      <input type="radio" name="${esc(name)}" value="${n}" data-qid="${esc(q.id)}" data-kind="rating"${Number(value) === n ? ' checked' : ''}>
      <span class="ifb-rate__face" aria-hidden="true">${young ? RATING_EMOJI[n - 1] : n}</span>
      <span class="ifb-sr">${n} – ${esc(labels[n - 1])}</span>
      ${young ? `<span class="ifb-rate__caption" aria-hidden="true">${esc(labels[n - 1])}</span>` : ''}
    </label>`).join('');
  const na = q.allow_na ? `
    <label class="ifb-rate__na">
      <input type="radio" name="${esc(name)}" value="na" data-qid="${esc(q.id)}" data-kind="rating"${value === 'na' ? ' checked' : ''}>
      <span>${esc(arLabel(NA_LABEL, 'لا ينطبق / لم تتح لي فرصة التقييم', lang))}</span>
    </label>` : '';
  return `
    <div class="ifb-rate" role="radiogroup" aria-label="${esc(q.text)}">${buttons}</div>
    ${young ? '' : `<div class="ifb-rate__ends" aria-hidden="true"><span>${esc(labels[0])}</span><span>${esc(labels[4])}</span></div>`}
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

function yesNoHtml(q, value, lang = 'he') {
  return `<div class="ifb-choices is-yesno" role="radiogroup" aria-label="${esc(q.text)}">
    <label class="ifb-choice"><input type="radio" name="q-${esc(q.id)}" value="true" data-qid="${esc(q.id)}" data-kind="bool"${value === true ? ' checked' : ''}><span>${arLabel('כן', 'نعم', lang)}</span></label>
    <label class="ifb-choice"><input type="radio" name="q-${esc(q.id)}" value="false" data-qid="${esc(q.id)}" data-kind="bool"${value === false ? ' checked' : ''}><span>${arLabel('לא', 'لا', lang)}</span></label>
  </div>`;
}

function textHtml(q, value, lang = 'he') {
  return `<textarea class="ifb-text" rows="3" maxlength="2000" data-qid="${esc(q.id)}" data-kind="text" aria-label="${esc(q.text)}" placeholder="${arLabel('אפשר לכתוב כאן…', 'يمكنك الكتابة هنا…', lang)}">${esc(value || '')}</textarea>`;
}

function questionHtml(q, index, answers, young, lang = 'he') {
  const value = answers[q.id];
  let control = '';
  if (q.type === 'rating_1_5') control = ratingHtml(q, value, young, lang);
  else if (q.type === 'yes_no') control = yesNoHtml(q, value, lang);
  else if (q.type === 'single_select') control = choiceHtml(q, value, false);
  else if (q.type === 'multi_select') control = choiceHtml(q, value, true);
  else control = textHtml(q, value, lang);
  return `
    <fieldset class="ifb-q${isAnswered(q, value) ? ' is-answered' : ''}" data-question="${esc(q.id)}">
      <legend class="ifb-q__title">
        <span class="ifb-q__num" aria-hidden="true">${index + 1}</span>
        <span>${esc(q.text)}${q.required ? '' : ` <span class="ifb-q__optional">(${arLabel('לא חובה', 'اختياري', lang)})</span>`}</span>
      </legend>
      ${q.type === 'multi_select' ? `<p class="ifb-q__hint">${arLabel('אפשר לבחור כמה תשובות', 'يمكن اختيار أكثر من إجابة', lang)}</p>` : ''}
      ${control}
      <p class="ifb-q__error" hidden>${arLabel('נשמח לתשובה לשאלה הזו', 'يرجى الإجابة عن هذا السؤال', lang)}</p>
    </fieldset>`;
}


// Compact, accessible intro structure shared across all feedback audiences and languages.
// Preserve the template's authored text while promoting its key message.
function introHtml(text, lang = 'he') {
  const source = String(text || '').trim();
  if (!source) return '';
  const segments = source.split(/\n\s*\n|\n/).map((part) => part.trim()).filter(Boolean);
  const paragraphs = segments.length > 1 ? segments : source.split(/(?<=[.!?؟])\s+/u).filter(Boolean);
  const guidancePattern = lang === 'ar'
    ? /(?:لا توجد إجابات صحيحة أو خاطئة|لا توجد إجابات صحيحة|لا توجد إجابة صحيحة)/
    : /(?:אין תשובות נכונות או לא נכונות|אין תשובה נכונה או לא נכונה)/;
  const key = paragraphs.find((part) => guidancePattern.test(part)) || '';
  const welcome = paragraphs[0] || '';
  const remaining = paragraphs.filter((part) => part !== welcome && part !== key).join(' ');
  // Keep the displayed introduction brief; full approved copy stays in the template.
  const sentences = remaining.split(/(?<=[.!?؟])\s+/u).filter(Boolean);
  const body = sentences.slice(0, 2).join(' ');
  const guidance = key ? `<p class="ifb-hero__guidance"><strong>${esc(key)}</strong></p>` : '';
  return `<div class="ifb-hero__intro" dir="rtl">
    <p class="ifb-hero__lead">${esc(welcome)}</p>
    ${body ? `<p class="ifb-hero__details">${esc(body)}</p>` : ''}
    ${guidance}
  </div>`;
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
  const arabic = options.language === 'ar';
  container.innerHTML = `
    <div lang="${arabic ? 'ar' : 'he'}" dir="rtl" class="ifb-shell${young ? ' is-young' : ''}${audienceClass}">
      <header class="ifb-hero">
        ${logoUrl ? `<img class="ifb-logo" src="${esc(logoUrl)}" alt="תעשיידע">` : ''}
        ${options.onChooseLanguage ? `<button type="button" class="ifb-hero__change-language" data-ifb-change-language>${arabic ? 'اختيار اللغة' : 'בחירת שפה'}</button>` : ''}
        <p class="ifb-hero__kicker">${esc(arabic ? (payload.stage === 'pre' ? 'استبيان البداية' : 'استبيان النهاية') : headline(payload))}</p>
        <h1 class="ifb-hero__title">${esc(arabic && /ביומימיקרי/.test(payload.program_title || '') ? 'المحاكاة الحيوية' : (payload.program_title || ''))}</h1>
        ${payload.recipient_name ? `<p class="ifb-hero__hello">${arabic ? 'مرحبًا' : 'שלום'} ${esc(payload.recipient_name)}</p>` : ''}
        ${introHtml(arabic ? payload.intro_text_ar : payload.intro_text, arabic ? 'ar' : 'he')}
      </header>
      <div class="ifb-progress" aria-hidden="true">
        <div class="ifb-progress__track"><div class="ifb-progress__fill" data-progress-fill></div></div>
        <span class="ifb-progress__label" data-progress-label></span>
      </div>
      <form class="ifb-form" novalidate>
        ${questions.map((q, i) => questionHtml(q, i, answers, young, options.language || 'he')).join('')}
        <div class="ifb-submit">
          <p class="ifb-submit__error" data-submit-error role="alert" hidden></p>
          <button type="submit" class="ifb-submit__btn" data-submit>${options.preview ? 'שליחה (תצוגה מקדימה)' : (arabic ? 'إرسال الاستبيان' : 'שליחת המשוב')}</button>
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
    label.textContent = arabic ? `${answered} من ${questions.length}` : `${answered} מתוך ${questions.length}`;
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
      submitError.textContent = arabic ? (missing.length === 1 ? 'بقي سؤال واحد دون إجابة' : `بقي ${missing.length} أسئلة دون إجابة`) : (missing.length === 1 ? 'נשארה שאלה אחת שלא נענתה' : `נשארו ${missing.length} שאלות שלא נענו`);
      submitError.hidden = false;
      showMissing(missing);
      return;
    }
    submitBtn.disabled = true;
    submitBtn.classList.add('is-busy');
    submitBtn.textContent = arabic ? 'جارٍ الإرسال…' : 'שולח…';
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
        throw new Error(arabic ? 'يرجى مراجعة الإجابات المحددة' : 'יש לבדוק את התשובות המסומנות');
      }
      if (result && result.ok === false && result.state !== 'invalid_answers') return;
    } catch (error) {
      submitError.textContent = arabic ? 'تعذّر إرسال الاستبيان. يرجى المحاولة مجددًا.' : (error?.message || 'השליחה נכשלה. נסו שוב.');
      submitError.hidden = false;
    } finally {
      if (submitBtn.isConnected) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('is-busy');
        submitBtn.textContent = options.preview ? (arabic ? 'إرسال (معاينة)' : 'שליחה (תצוגה מקדימה)') : (arabic ? 'إرسال الاستبيان' : 'שליחת המשוב');
      }
    }
  });

  updateProgress();
  return { answers };
}

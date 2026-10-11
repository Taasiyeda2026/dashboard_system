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
const AR_BIOMIMICRY_RATING_LABELS = Object.freeze([
  'لا ينطبق عليّ أبدًا',
  'ينطبق عليّ قليلًا',
  'ينطبق عليّ بدرجة متوسطة',
  'ينطبق عليّ إلى حدّ كبير',
  'ينطبق عليّ كثيرًا جدًا'
]);
const arLabel = (he, ar, lang) => lang === 'ar' ? ar : he;
const SYLLABUS_STUDENT_PROGRAMS = new Set(['green_leadership', 'space_tech', 'trailblazers', 'pharma', 'ofek']);
const isSyllabusStudent = (payload) => payload.audience === 'student' && SYLLABUS_STUDENT_PROGRAMS.has(payload.program_key);
const isArabicBiomimicryStudent = (payload, language) =>
  language === 'ar' && payload.program_key === 'biomimicry' && payload.audience === 'student';
const AR_PROGRAM_TITLES = Object.freeze({
  'ביומימיקרי': 'المحاكاة الحيوية',
  'משחקי קופסה': 'ألعاب الطاولة',
  'מנהיגות ירוקה': 'القيادة الخضراء',
  'טכנולוגיות החלל': 'تكنولوجيا الفضاء',
  'השמיים אינם הגבול': 'السماء ليست الحدّ',
  'יישומי AI': 'تطبيقات الذكاء الاصطناعي',
  'רוקחים עולם': 'نصنع عالم الأدوية',
  'אופק פרימיום': 'أوفِك بريميوم',
  'סודות ויסודות AI': 'أسرار وأسس الذكاء الاصطناعي',
  'פורצות דרך': 'رائدات الطريق'
});


function arabicHeadline(payload) {
  if (payload.audience === 'instructor') return payload.stage === 'pre' ? 'استبيان المرشدين – بعد التدريب' : 'استبيان المرشدين – نهاية البرنامج';
  if (payload.audience === 'educational_staff') return 'استبيان الطاقم التربوي';
  return payload.stage === 'pre' ? 'استبيان البداية' : 'استبيان النهاية';
}

function ratingHtml(q, value, young, lang = 'he', approvedStudentScale = false) {
  const labels = approvedStudentScale && lang === 'ar' ? AR_BIOMIMICRY_RATING_LABELS : lang === 'ar' ? AR_RATING_LABELS : RATING_LABELS;
  const name = `q-${q.id}`;
  const buttons = [1, 2, 3, 4, 5].map((n) => `
    <label class="ifb-rate__opt${young ? ' is-emoji' : ''}">
      <input type="radio" name="${esc(name)}" value="${n}" data-qid="${esc(q.id)}" data-kind="rating"${Number(value) === n ? ' checked' : ''}>
      <span class="ifb-rate__face" aria-hidden="true">${approvedStudentScale ? ['①', '②', '③', '④', '⑤'][n - 1] : young ? RATING_EMOJI[n - 1] : n}</span>
      <span class="ifb-sr">${n} – ${esc(labels[n - 1])}</span>
      ${young && !approvedStudentScale ? `<span class="ifb-rate__caption" aria-hidden="true">${esc(labels[n - 1])}</span>` : ''}
    </label>`).join('');
  const na = q.allow_na ? `
    <label class="ifb-rate__na">
      <input type="radio" name="${esc(name)}" value="na" data-qid="${esc(q.id)}" data-kind="rating"${value === 'na' ? ' checked' : ''}>
      <span>${esc(arLabel(NA_LABEL, 'لا ينطبق / لم تتح لي فرصة التقييم', lang))}</span>
    </label>` : '';
  return `
    <div class="ifb-rate${approvedStudentScale ? ' ifb-rate--arabic-biomimicry' : ''}" role="radiogroup" aria-label="${esc(q.text)}">${buttons}</div>
    ${young || approvedStudentScale ? '' : `<div class="ifb-rate__ends" aria-hidden="true"><span>${esc(labels[0])}</span><span>${esc(labels[4])}</span></div>`}
    ${na}`;
}

function choiceHtml(q, value, multiple, lang = 'he') {
  const selected = new Set(multiple ? (Array.isArray(value) ? value : []) : [value]);
  const options = Array.isArray(q.options) ? q.options : [];
  return `<div class="ifb-choices${multiple ? ' is-multi' : ''}" role="${multiple ? 'group' : 'radiogroup'}" aria-label="${esc(q.text)}">
    ${options.map((o) => `
      <label class="ifb-choice">
        <input type="${multiple ? 'checkbox' : 'radio'}" name="q-${esc(q.id)}" value="${esc(o.value)}" data-qid="${esc(q.id)}" data-kind="${multiple ? 'multi' : 'single'}"${selected.has(o.value) ? ' checked' : ''}>
        <span>${esc(lang === 'ar' ? (o.label_ar || o.label || o.value) : (o.label || o.value))}</span>
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

function questionHtml(q, index, answers, young, lang = 'he', approvedStudentScale = false) {
  const value = answers[q.id];
  let control = '';
  if (q.type === 'rating_1_5') control = ratingHtml(q, value, young, lang, approvedStudentScale);
  else if (q.type === 'yes_no') control = yesNoHtml(q, value, lang);
  else if (q.type === 'single_select') control = choiceHtml(q, value, false, lang);
  else if (q.type === 'multi_select') control = choiceHtml(q, value, true, lang);
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
function approvedFreeTextIntroHtml(arabic, femaleStudent, biomimicryArabic) {
  if (biomimicryArabic) return '<section class="ifb-biomimicry-open-intro"><h2>نودّ أن نسمع المزيد عن تجربتكم</h2><p>في السؤالين التاليين، يمكنكم أن تكتبوا بكلماتكم ما أحببتموه في الدورة وما تودّون تغييره أو إضافته. ليس من الضروري الإجابة عن هذين السؤالين.</p></section>';
  const title = arabic ? (femaleStudent ? 'نودّ أن نسمع المزيد عن تجربتكنّ' : 'نودّ أن نسمع المزيد عن تجربتكم') : (femaleStudent ? 'נשמח לשמוע עוד על החוויה שלכן' : 'נשמח לשמוע עוד על החוויה שלכם');
  const body = arabic
    ? (femaleStudent ? 'في السؤالين التاليين، يمكنكُنّ الكتابة عمّا كان مهمًّا لكنّ وما تودَدن تغييره أو تحسينه في البرنامج. الإجابة اختيارية.' : 'في السؤالين التاليين، يمكنكم الكتابة عمّا كان مهمًّا لكم وما تودّون تغييره أو تحسينه في البرنامج. الإجابة اختيارية.')
    : (femaleStudent ? 'בשתי השאלות הבאות תוכלו לכתוב מה היה משמעותי עבורכן ומה הייתן רוצות לשפר. אין חובה לענות עליהן.' : 'בשתי השאלות הבאות תוכלו לכתוב מה היה משמעותי עבורכם ומה הייתם רוצים לשפר. אין חובה לענות עליהן.');
  return `<section class="ifb-biomimicry-open-intro"><h2>${esc(title)}</h2><p>${esc(body)}</p></section>`;
}
function introHtml(text, lang = 'he', showApprovedFullText = false) {
  const source = String(text || '').trim();
  if (!source) return '';
  if (showApprovedFullText) {
    return `<div class="ifb-hero__intro ifb-hero__intro--approved" dir="rtl">${source.split(/\r?\n|\\n/).map((line) => line.trim()).filter(Boolean).map((line, i) =>
      `<p class="${i === 0 ? 'ifb-hero__lead' : /(?:لا توجد إجابات صحيحة أو خاطئة|אין תשובות נכונות או לא נכונות)/.test(line) ? 'ifb-hero__guidance' : 'ifb-hero__details'}">${esc(line)}</p>`
    ).join('')}</div>`;
  }
  const segments = source.split(/\n\s*\n|\n/).map((part) => part.trim()).filter(Boolean);
  const paragraphs = segments.length > 1 ? segments : source.split(/(?<=[.!?؟])\s+/u).filter(Boolean);
  const guidancePattern = lang === 'ar'
    ? /(?:لا توجد إجابات صحيحة أو خاطئة|لا توجد إجابات صحيحة|لا توجد إجابة صحيحة)/
    : /(?:אין תשובות נכונות או לא נכונות|אין תשובה נכונה או לא נכונה)/;
  const key = paragraphs.find((part) => guidancePattern.test(part)) || '';
  const welcome = paragraphs[0] || '';
  // Pull out the reassurance even when it is part of a longer paragraph.
  const guidanceSentence = key
    ? (key.split(/(?<=[.!?؟])\s+/u).find((part) => guidancePattern.test(part)) || key)
    : '';
  const remaining = paragraphs.filter((part) => part !== welcome && part !== key).join(' ');
  // Keep the displayed introduction brief; full approved copy stays in the template.
  const sentences = remaining.split(/(?<=[.!?؟])\s+/u).filter(Boolean);
  const body = sentences.slice(0, 2).join(' ');
  const guidance = guidanceSentence ? `<p class="ifb-hero__guidance"><strong>${esc(guidanceSentence)}</strong></p>` : '';
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
  const biomimicryArabic = isArabicBiomimicryStudent(payload, options.language);
  const syllabusStudent = isSyllabusStudent(payload);
  const approvedStudentScale = biomimicryArabic || syllabusStudent;
  const femaleStudent = syllabusStudent && payload.program_key === 'trailblazers';
  const young = !approvedStudentScale && payload.audience === 'student' && payload.age_band === 'a_c';
  const answers = { ...(options.initialAnswers || {}) };
  const logoUrl = options.logoUrl || '';

  const audienceClass = payload.audience === 'student' ? ' is-student' : ' is-adult';
  const arabic = options.language === 'ar';
  const hasStarted = Boolean(options.initialStarted) || Object.keys(answers).some((key) => answers[key] !== null && answers[key] !== '' && answers[key] !== undefined);
  container.innerHTML = `
    <div lang="${arabic ? 'ar' : 'he'}" dir="rtl" class="ifb-shell${young ? ' is-young' : ''}${biomimicryArabic ? ' is-biomimicry-ar' : ''}${syllabusStudent ? ' is-syllabus-student' : ''}${audienceClass}">
      <header class="ifb-hero">
        ${logoUrl ? `<img class="ifb-logo" src="${esc(logoUrl)}" alt="תעשיידע">` : ''}
        ${options.onChooseLanguage ? `<button type="button" class="ifb-hero__change-language" data-ifb-change-language>${arabic ? 'اختيار اللغة' : 'בחירת שפה'}</button>` : ''}
        ${biomimicryArabic ? '' : `<p class="ifb-hero__kicker">${esc(arabic ? arabicHeadline(payload) : headline(payload))}</p>`}
        <h1 class="ifb-hero__title">${esc(biomimicryArabic ? (payload.stage === 'pre' ? 'استبيان بداية دورة البيوميمكري – المحاكاة الحيوية' : 'استبيان نهاية دورة البيوميمكري – المحاكاة الحيوية') : arabic ? (AR_PROGRAM_TITLES[payload.program_title] || payload.program_title || '') : (payload.program_title || ''))}</h1>
        ${payload.recipient_name ? `<p class="ifb-hero__hello">${arabic ? 'مرحبًا' : 'שלום'} ${esc(payload.recipient_name)}</p>` : ''}
        ${introHtml(arabic ? payload.intro_text_ar : payload.intro_text, arabic ? 'ar' : 'he', approvedStudentScale)}
      </header>
      <div class="ifb-start" data-ifb-start-panel${hasStarted ? ' hidden' : ''}>
        <button type="button" class="ifb-start__btn" data-ifb-start>${arabic ? 'بدء الاستبيان' : 'התחלת המשוב'}</button>
      </div>
      <div data-ifb-questionnaire${hasStarted ? '' : ' hidden'}>
      <div class="ifb-progress" aria-hidden="true">
        <div class="ifb-progress__track"><div class="ifb-progress__fill" data-progress-fill></div></div>
        <span class="ifb-progress__label" data-progress-label></span>
      </div>
      <form class="ifb-form" novalidate>
        ${approvedStudentScale ? `<section class="ifb-biomimicry-scale" aria-label="كيف نجيب؟">
          <h2>${arabic ? 'كيف نجيب؟' : 'איך עונים?'}</h2>
          <p>${arabic ? (femaleStudent ? 'اقرأن كل جملة، واخترن رقمًا من 1 إلى 5 حسب مدى انطباقها عليكنّ:' : 'اقرؤوا كل جملة، واختاروا رقمًا من 1 إلى 5 حسب مدى انطباقها عليكم:') : (femaleStudent ? 'קראו כל משפט ובחרו מספר מ־1 עד 5 לפי מידת ההתאמה שלו אליכן:' : 'קראו כל משפט ובחרו מספר מ־1 עד 5 לפי מידת ההתאמה שלו אליכם:')}</p>
          <div class="ifb-biomimicry-scale__items">${(arabic ? AR_BIOMIMICRY_RATING_LABELS : RATING_LABELS).map((label, i) => `<div><strong>${i + 1}</strong><span>${esc(label)}</span></div>`).join('')}</div>
          <h2 class="ifb-biomimicry-scale__questions">${arabic ? 'الأسئلة:' : 'השאלות:'}</h2>
        </section>` : ''}
        ${questions.map((q, i) => `${approvedStudentScale && payload.stage === 'post' && q.type === 'free_text' && (i === 0 || questions[i - 1]?.type !== 'free_text') ? approvedFreeTextIntroHtml(arabic, femaleStudent, biomimicryArabic) : ''}${questionHtml(q, i, answers, young, options.language || 'he', approvedStudentScale)}`).join('')}
        <div class="ifb-submit">
          <p class="ifb-submit__error" data-submit-error role="alert" hidden></p>
          <button type="submit" class="ifb-submit__btn" data-submit>${options.preview ? (arabic ? 'إرسال (معاينة)' : 'שליחה (תצוגה מקדימה)') : (arabic ? 'إرسال الاستبيان' : 'שליחת המשוב')}</button>
        </div>
      </form>
      </div>
    </div>`;

  const startPanel = container.querySelector('[data-ifb-start-panel]');
  const questionnaire = container.querySelector('[data-ifb-questionnaire]');
  container.querySelector('[data-ifb-start]')?.addEventListener('click', () => {
    startPanel.hidden = true;
    questionnaire.hidden = false;
    questionnaire.querySelector('[data-progress-label]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
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

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.3/+esm';

const supabase = createClient(
  'https://szinlhjuwyiyszdpsdop.supabase.co',
  'sb_publishable_k0IbDJlgPA9KTVuDWrCyFw_Zsa5kZIM',
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
);

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const params = new URLSearchParams(window.location.search);
const token = (params.get('t') || params.get('token') || '').trim();

const SATISFACTION = [
  ['coordination_info', 'התיאום והמידע שנמסרו לקראת הפעילויות היו ברורים, מסודרים ומדויקים.'],
  ['facilitation_professionalism', 'צוות ההדרכה הגיע ערוך והעביר את הפעילויות במקצועיות, בנעימות ובבהירות.'],
  ['age_group_fit', 'הפעילויות התאימו לגיל התלמידים, למאפייני הקבוצות ולמסגרת הקיץ.'],
  ['content_equipment_duration', 'התוכן, הציוד ומשך הפעילויות נתנו מענה מלא ומותאם לצורכי הקבוצות.'],
  ['learning_experience', 'הפעילויות העניקו לתלמידים חוויה לימודית, מעשית, מהנה ומשמעותית.'],
  ['expectations_staff', 'הפעילויות עמדו בציפיות שלנו ונתנו מענה מקצועי לצוות החינוכי.'],
  ['overall_satisfaction', 'באופן כללי, אנו שבעי רצון מפעילויות תעשיידע שהתקיימו בבית הספר.']
];

const STUDENT_EXPERIENCE = [
  ['interest_curiosity', 'התלמידים גילו עניין, סקרנות ומעורבות לאורך הפעילויות.'],
  ['active_participation', 'התלמידים השתתפו באופן פעיל ושיתפו פעולה לאורך הפעילות.'],
  ['enjoyment_motivation', 'התלמידים הביעו הנאה, התלהבות ורצון להמשיך ולהתנסות.'],
  ['building_creation', 'התלמידים גילו מעורבות בבנייה, ביצירה ובשלבי ההתנסות.'],
  ['positive_experience', 'תגובות התלמידים העידו על חוויה חיובית, מהנה ומשמעותית.']
];

const HIGHLIGHTS = [
  ['enthusiasm', 'התלהבות, הנאה ורצון להשתתף'],
  ['curiosity', 'סקרנות, עניין ושאלת שאלות'],
  ['active_participation', 'השתתפות פעילה לאורך הפעילות'],
  ['cooperation', 'שיתוף פעולה בין התלמידים'],
  ['pride', 'גאווה בתוצר, בבנייה או בהתנסות'],
  ['continue', 'רצון להמשיך בפעילות או להתנסות שוב'],
  ['after_talk', 'שיח על הפעילות גם לאחר סיומה'],
  ['different_interest', 'רמת עניין שונה בין התלמידים'],
  ['could_not_observe', 'לא הייתה אפשרות להתרשם']
];

const STEPS = [
  ['פרטים כלליים', 'כמה פרטים קצרים על ממלא/ת המשוב'],
  ['שביעות רצון', 'התרשמות מהפעילויות ומההתנהלות'],
  ['חוויית התלמידים', 'מה שניכר בפועל במהלך הפעילויות'],
  ['סיכום קצר', 'מה חשוב לשמר ומה ניתן לשפר']
];

const state = {
  data: null,
  step: 0,
  form: emptyForm(),
  saveTimer: null,
  saving: false,
  savedAt: null,
  error: ''
};

function emptyForm() {
  return {
    respondent_name: '',
    respondent_role: '',
    respondent_role_other: '',
    satisfaction_answers: {},
    student_experience_answers: {},
    student_highlights: [],
    preserve_text: '',
    improve_text: '',
    future_interest: '',
    memorable_response: ''
  };
}

function esc(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function checked(actual, expected) {
  return actual === expected ? ' checked' : '';
}

function selected(list, value) {
  return list.includes(value) ? ' checked' : '';
}

function notify(message, isError = false) {
  toast.textContent = message;
  toast.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    toast.className = 'toast';
  }, 2800);
}

function serverError(error) {
  const raw = error?.message || 'לא ניתן לשמור את המשוב כעת.';
  const match = raw.match(/(?:ERROR|message)[:=]?\s*([^\n]+)/i);
  return (match?.[1] || raw).replace(/^PGRST\w+:\s*/i, '').trim();
}

function renderMessage(title, text) {
  app.className = 'loading-screen';
  app.innerHTML = `<section class="message-card">
    <div class="brand" style="justify-content:center;margin-bottom:18px">
      <span class="brand-mark">ת</span>
      <span class="brand-copy"><strong>תעשיידע</strong><span>משוב לצוות החינוכי</span></span>
    </div>
    <h1>${esc(title)}</h1>
    <p>${esc(text)}</p>
  </section>`;
}

async function init() {
  if (token.length < 32) {
    renderMessage('הקישור אינו תקין', 'יש לפתוח את הקישור האישי שנשלח לבית הספר.');
    return;
  }

  try {
    const { data, error } = await supabase.rpc('educational_feedback_get', { p_token: token });
    if (error) throw error;
    if (!data?.ok) {
      renderMessage('הקישור אינו תקין', 'הקישור אינו מזוהה או שאינו פעיל עוד.');
      return;
    }

    state.data = data;
    if (data.response) {
      state.form = {
        ...emptyForm(),
        ...data.response,
        satisfaction_answers: data.response.satisfaction_answers || {},
        student_experience_answers: data.response.student_experience_answers || {},
        student_highlights: Array.isArray(data.response.student_highlights)
          ? data.response.student_highlights
          : []
      };
      state.savedAt = data.response.updated_at || null;
    }

    if (data.response?.status === 'submitted') {
      renderThankYou();
      return;
    }

    if (!data.can_edit) {
      renderMessage('המשוב אינו פתוח כעת', 'מועד מילוי המשוב הסתיים. תודה על שיתוף הפעולה.');
      return;
    }

    render();
  } catch (error) {
    console.error(error);
    renderMessage('לא ניתן לטעון את המשוב', 'אירעה תקלה זמנית. מומלץ לנסות לפתוח את הקישור שוב בעוד כמה דקות.');
  }
}

function saveStatusHtml() {
  if (state.saving) return '<span class="save-status saving">שומר…</span>';
  if (state.savedAt) return '<span class="save-status saved">הטיוטה נשמרה</span>';
  return '<span class="save-status">השמירה מתבצעת אוטומטית</span>';
}

function frame(content) {
  const { school_name: school, authority_name: authority } = state.data.recipient;
  const progress = ((state.step + 1) / STEPS.length) * 100;
  return `<main class="page-shell">
    <div class="brand-bar">
      <div class="brand">
        <span class="brand-mark">ת</span>
        <span class="brand-copy"><strong>תעשיידע</strong><span>חינוך, תעשייה וחדשנות</span></span>
      </div>
      <div id="save-status">${saveStatusHtml()}</div>
    </div>

    <section class="hero">
      <h1>משוב לצוות החינוכי</h1>
      <p>תודה על שיתוף הפעולה ועל הזמנת פעילויות הקיץ של תעשיידע. ${esc(state.data.campaign.intro_text)}</p>
      <div class="school-card">
        <span>${esc(school)}</span>
        <small>${esc(authority)}</small>
      </div>
    </section>

    <section class="progress-card" aria-label="התקדמות במילוי המשוב">
      <div class="progress-row">
        <strong>${esc(STEPS[state.step][0])}</strong>
        <span>שלב ${state.step + 1} מתוך ${STEPS.length}</span>
      </div>
      <div class="progress-track"><span style="width:${progress}%"></span></div>
    </section>

    <section class="form-panel">
      <div id="form-error" class="form-error${state.error ? ' show' : ''}" role="alert">${esc(state.error)}</div>
      ${content}
      ${actionsHtml()}
    </section>
  </main>`;
}

function sectionHead(kicker, title, text) {
  return `<div class="section-head">
    <span class="section-kicker">${esc(kicker)}</span>
    <h2>${esc(title)}</h2>
    <p>${esc(text)}</p>
  </div>`;
}

function actionsHtml() {
  const back = state.step > 0
    ? '<button class="btn" type="button" data-action="back">חזרה</button>'
    : '<span class="helper">הקישור אישי ומותאם לבית הספר</span>';
  const primary = state.step === STEPS.length - 1
    ? '<button class="btn primary" type="button" data-action="submit">שליחת המשוב</button>'
    : '<button class="btn primary" type="button" data-action="next">המשך</button>';

  return `<div class="actions">
    <div>${back}</div>
    <div class="actions-group">${primary}</div>
  </div>`;
}

function render() {
  state.error = '';
  const screens = [renderGeneral, renderSatisfaction, renderStudents, renderSummary];
  app.className = '';
  app.innerHTML = frame(screens[state.step]());
}

function renderGeneral() {
  const f = state.form;
  const otherClass = f.respondent_role === 'other' ? '' : ' hidden';
  return `${sectionHead('פרטים כלליים', 'נעים להכיר', 'שם בית הספר כבר זוהה באמצעות הקישור האישי. נותרו רק פרטי ממלא/ת המשוב.')}
    <div class="fields-grid">
      <div class="field full">
        <label class="required" for="respondent-name">שם מלא</label>
        <input id="respondent-name" type="text" autocomplete="name" data-field="respondent_name" value="${esc(f.respondent_name)}" placeholder="שם פרטי ושם משפחה">
      </div>
      <fieldset class="field full" style="border:0;padding:0;margin:0">
        <legend class="required" style="margin-bottom:9px">תפקיד ממלא/ת המשוב</legend>
        <div class="choice-grid">
          ${roleChoice('manager', 'מנהל/ת')}
          ${roleChoice('coordinator', 'רכז/ת')}
          ${roleChoice('teacher', 'מורה או איש/אשת צוות חינוכי')}
          ${roleChoice('other', 'אחר')}
        </div>
      </fieldset>
      <div id="other-role" class="field full other-role${otherClass}">
        <label class="required" for="role-other">תפקיד אחר</label>
        <input id="role-other" type="text" data-field="respondent_role_other" value="${esc(f.respondent_role_other)}" placeholder="נא לפרט">
      </div>
    </div>`;
}

function roleChoice(value, label) {
  return `<label class="choice-card">
    <input type="radio" name="respondent-role" data-field="respondent_role" value="${value}"${checked(state.form.respondent_role, value)}>
    <span>${esc(label)}</span>
  </label>`;
}

function renderSatisfaction() {
  return `${sectionHead('שביעות רצון מהפעילות', 'כיצד התרשמתם מהפעילויות?', 'יש לדרג את ההיגדים על סמך ההתרשמות מהפעילויות ומההתנהלות. 1 מציין מידה נמוכה מאוד ו־5 מציין מידה רבה מאוד.')}
    <div class="question-list">
      ${SATISFACTION.map(([key, text], index) => ratingCard('satisfaction_answers', key, text, index + 1)).join('')}
    </div>`;
}

function renderStudents() {
  return `${sectionHead('התרשמות מחוויית התלמידים', 'מה ניכר בפועל במהלך הפעילויות?', 'השאלות מתייחסות להשתתפות התלמידים, להתנהגותם ולתגובותיהם במהלך הפעילויות.')}
    <div class="question-list">
      ${STUDENT_EXPERIENCE.map(([key, text], index) => ratingCard('student_experience_answers', key, text, index + 1)).join('')}
    </div>
    <div class="subsection">
      <h3>מה בלט במיוחד בתגובות התלמידים?</h3>
      <p>ניתן לבחור יותר מתשובה אחת.</p>
      <div class="highlight-grid">
        ${HIGHLIGHTS.map(([value, label]) => `<label class="highlight-card">
          <input type="checkbox" data-highlight="${value}"${selected(state.form.student_highlights, value)}>
          <span>${esc(label)}</span>
        </label>`).join('')}
      </div>
    </div>`;
}

function ratingCard(section, key, text, number) {
  const current = state.form[section]?.[key] || '';
  return `<article class="rating-card">
    <p class="rating-title">${number}. ${esc(text)}</p>
    <div class="rating-scale" role="radiogroup" aria-label="${esc(text)}">
      ${[1, 2, 3, 4, 5].map(value => `<label class="rating-option">
        <input type="radio" name="${section}-${key}" data-rating-section="${section}" data-rating-key="${key}" value="${value}"${checked(current, String(value))}>
        <span>${value}</span>
      </label>`).join('')}
      <label class="rating-option na">
        <input type="radio" name="${section}-${key}" data-rating-section="${section}" data-rating-key="${key}" value="na"${checked(current, 'na')}>
        <span>לא ניתן להתרשם</span>
      </label>
    </div>
    <div class="scale-note"><span>מידה נמוכה מאוד</span><span>מידה רבה מאוד</span></div>
  </article>`;
}

function renderSummary() {
  const f = state.form;
  return `${sectionHead('סיכום קצר', 'עזרו לנו ללמוד ולהשתפר', 'התשובות יסייעו לנו לשמר את הדברים שעבדו היטב ולדייק את הפעילויות בהמשך.')}
    <div class="fields-grid">
      <div class="field full">
        <label class="required" for="preserve-text">מה עבד היטב בפעילויות וחשוב לשמר גם בהמשך?</label>
        <textarea id="preserve-text" data-field="preserve_text" placeholder="אפשר להתייחס לתוכן, להדרכה, לציוד או לחוויית התלמידים">${esc(f.preserve_text)}</textarea>
      </div>
      <div class="field full">
        <label class="required" for="improve-text">מה ניתן לשפר כדי לדייק ולהעשיר את הפעילויות?</label>
        <textarea id="improve-text" data-field="improve_text" placeholder="כל הערה תסייע לנו להשתפר">${esc(f.improve_text)}</textarea>
      </div>
      <fieldset class="field full" style="border:0;padding:0;margin:0">
        <legend class="required" style="margin-bottom:9px">האם הייתם מעוניינים בפעילות נוספת של תעשיידע בעתיד?</legend>
        <div class="future-grid">
          ${futureChoice('yes', 'כן')}
          ${futureChoice('maybe', 'ייתכן, נשמח לקבל פרטים')}
          ${futureChoice('no', 'לא בשלב זה')}
        </div>
      </fieldset>
      <div class="field full">
        <label for="memorable-response">האם זכורה לכם תגובה, התנהגות או אמירה של תלמידים בעקבות הפעילויות?</label>
        <textarea id="memorable-response" data-field="memorable_response" placeholder="שדה רשות">${esc(f.memorable_response)}</textarea>
      </div>
    </div>`;
}

function futureChoice(value, label) {
  return `<label class="future-card">
    <input type="radio" name="future-interest" data-field="future_interest" value="${value}"${checked(state.form.future_interest, value)}>
    <span>${esc(label)}</span>
  </label>`;
}

function setError(message) {
  state.error = message;
  const box = document.querySelector('#form-error');
  if (box) {
    box.textContent = message;
    box.classList.add('show');
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function clearError() {
  state.error = '';
  const box = document.querySelector('#form-error');
  if (box) {
    box.textContent = '';
    box.classList.remove('show');
  }
}

function validateStep(step) {
  const f = state.form;
  if (step === 0) {
    if (f.respondent_name.trim().length < 2) return 'יש למלא שם מלא.';
    if (!f.respondent_role) return 'יש לבחור את תפקיד ממלא/ת המשוב.';
    if (f.respondent_role === 'other' && f.respondent_role_other.trim().length < 2) return 'יש לפרט את התפקיד.';
  }
  if (step === 1) {
    const missing = SATISFACTION.some(([key]) => !f.satisfaction_answers[key]);
    if (missing) return 'יש להשלים את כל היגדי שביעות הרצון.';
  }
  if (step === 2) {
    const missing = STUDENT_EXPERIENCE.some(([key]) => !f.student_experience_answers[key]);
    if (missing) return 'יש להשלים את כל היגדי חוויית התלמידים.';
    if (!f.student_highlights.length) return 'יש לבחור לפחות תגובה אחת שבלטה אצל התלמידים.';
  }
  if (step === 3) {
    if (f.preserve_text.trim().length < 3) return 'יש לציין מה חשוב לשמר.';
    if (f.improve_text.trim().length < 3) return 'יש לציין מה ניתן לשפר.';
    if (!f.future_interest) return 'יש לבחור האם תהיו מעוניינים בפעילות נוספת.';
  }
  return '';
}

function scheduleSave() {
  if (!state.data?.can_edit || state.saving) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => save(false, true), 850);
}

function updateSaveStatus() {
  const holder = document.querySelector('#save-status');
  if (holder) holder.innerHTML = saveStatusHtml();
}

async function save(submit = false, silent = false) {
  if (state.saving) return false;
  clearTimeout(state.saveTimer);
  state.saving = true;
  updateSaveStatus();

  try {
    const { data, error } = await supabase.rpc('educational_feedback_save', {
      p_token: token,
      p_payload: state.form,
      p_submit: submit
    });
    if (error) throw error;
    state.savedAt = data?.saved_at || new Date().toISOString();
    if (!silent && !submit) notify('הטיוטה נשמרה');
    if (submit) renderThankYou();
    return true;
  } catch (error) {
    console.error(error);
    const message = serverError(error);
    if (submit) setError(message);
    else notify(message, true);
    return false;
  } finally {
    state.saving = false;
    updateSaveStatus();
  }
}

async function goNext() {
  clearError();
  const error = validateStep(state.step);
  if (error) {
    setError(error);
    return;
  }
  await save(false, true);
  if (state.step < STEPS.length - 1) {
    state.step += 1;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function goBack() {
  clearTimeout(state.saveTimer);
  save(false, true);
  if (state.step > 0) {
    state.step -= 1;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

async function submitFeedback() {
  clearError();
  const error = validateStep(3);
  if (error) {
    setError(error);
    return;
  }

  const button = document.querySelector('[data-action="submit"]');
  if (button) {
    button.disabled = true;
    button.textContent = 'שולח…';
  }
  const ok = await save(true, true);
  if (!ok && button) {
    button.disabled = false;
    button.textContent = 'שליחת המשוב';
  }
}

function renderThankYou() {
  clearTimeout(state.saveTimer);
  app.className = '';
  app.innerHTML = `<main class="thank-you">
    <section class="thank-you-card">
      <div class="thank-you-icon">✓</div>
      <div class="brand" style="justify-content:center;margin-bottom:22px">
        <span class="brand-mark">ת</span>
        <span class="brand-copy"><strong>תעשיידע</strong><span>פעילויות הקיץ</span></span>
      </div>
      <h1>תודה רבה על הזמן ועל שיתוף הפעולה</h1>
      <p>המשוב התקבל בהצלחה. חוות דעתכם תסייע לנו לשמר את הדברים שעבדו היטב, לדייק את הפעילויות ולהמשיך להעניק לתלמידים חוויות לימודיות, מעשיות ומהנות.</p>
    </section>
  </main>`;
}

app.addEventListener('input', event => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

  if (target.dataset.field) {
    state.form[target.dataset.field] = target.value;
    if (target.dataset.field === 'respondent_role') {
      const other = document.querySelector('#other-role');
      other?.classList.toggle('hidden', target.value !== 'other');
    }
  }

  if (target.dataset.ratingSection && target.dataset.ratingKey) {
    state.form[target.dataset.ratingSection][target.dataset.ratingKey] = target.value;
  }

  if (target.dataset.highlight) {
    const value = target.dataset.highlight;
    const set = new Set(state.form.student_highlights);
    if (target.checked) set.add(value);
    else set.delete(value);
    state.form.student_highlights = [...set];
  }

  clearError();
  scheduleSave();
});

app.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'next') goNext();
  if (action === 'back') goBack();
  if (action === 'submit') submitFeedback();
});

window.addEventListener('beforeunload', () => {
  if (state.saveTimer) save(false, true);
});

init();

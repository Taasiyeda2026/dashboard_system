import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.3/+esm';

const supabase = createClient(
  'https://szinlhjuwyiyszdpsdop.supabase.co',
  'sb_publishable_k0IbDJlgPA9KTVuDWrCyFw_Zsa5kZIM',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

const CYCLE_KEY = 'summer_2026';
const BUTTON_SELECTOR = '[data-preview]';
const VIEWER_CLASS = 'summer-feedback-admin-response-view';

const GENERAL_GROUPS = [
  {
    title: 'תוכן והכשרה',
    questions: [
      ['preparation_info', 'המידע וחומרי התוכן שקיבלתי לפני הפעילות היו ברורים ומספקים'],
      ['professional_training', 'ההכשרה המקצועית הכינה אותי להעברת הפעילויות'],
      ['content_goals_clarity', 'מטרות הפעילויות ודרך ההעברה המצופה היו ברורות לי'],
      ['content_support', 'קיבלתי מענה מקצועי לשאלות תוכן לפני הפעילות ובמהלכה']
    ]
  },
  {
    title: 'תיאום ושיבוץ',
    questions: [
      ['scheduling_timeliness', 'השיבוצים נמסרו לי בזמן שאפשר היערכות מתאימה'],
      ['schedule_clarity', 'פרטי הפעילות, הכתובת, השעות והקבוצה נמסרו בצורה ברורה'],
      ['change_updates', 'שינויים ועדכונים הועברו בצורה מסודרת ובזמן'],
      ['constraints_response', 'אילוצים ובקשות שהעליתי קיבלו התייחסות עניינית']
    ]
  },
  {
    title: 'ניהול הפעילות והמענה השוטף',
    questions: [
      ['management_contact_clarity', 'היה לי ברור למי לפנות בכל שאלה, תקלה או צורך'],
      ['daily_resources_check', 'לפני הפעילויות וידאו איתי שיש ברשותי את המידע, הציוד והחומרים הנדרשים'],
      ['management_communication', 'התקיים איתי קשר שוטף, ברור ומכבד לאורך תקופת הפעילות'],
      ['issue_resolution', 'חוסרים, תקלות ובעיות טופלו בזמן וביעילות']
    ]
  },
  {
    title: 'לוגיסטיקה וציוד',
    questions: [
      ['equipment_distribution', 'הציוד והערכות נמסרו בזמן ובצורה מסודרת'],
      ['equipment_completeness', 'הציוד והחומרים היו מלאים, תקינים ומוכנים לשימוש'],
      ['equipment_replenishment', 'במידת הצורך ניתנו השלמות לציוד ולחומרים בהתאם לדרישה']
    ]
  },
  {
    title: 'תחושת ביטחון והערכה כללית',
    questions: [
      ['readiness_confidence', 'הרגשתי מוכן/ה ובטוח/ה להעביר את הפעילויות'],
      ['full_support_envelope', 'התמיכה שקיבלתי אפשרה לי להתמקד בהדרכה'],
      ['overall_organization', 'באופן כללי, פעילות הקיץ הייתה מאורגנת ומנוהלת היטב']
    ]
  }
];

const METRICS = [
  ['age_fit', 'התאמה לגיל המשתתפים'],
  ['content_clarity', 'בהירות התוכן ורצף ההדרכה'],
  ['time_fit', 'התאמת היקף התוכן לזמן'],
  ['equipment_quality', 'התאמת הציוד והחומרים'],
  ['student_engagement', 'עניין והשתתפות התלמידים'],
  ['overall_rating', 'הערכה כללית לפעילות']
];

const SUMMARY_FIELDS = [
  ['preserve_activities', 'מה חשוב לשמר בפעילויות הקיץ עצמן?'],
  ['improve_activities', 'מה כדאי לשנות או לשפר בפעילויות הקיץ עצמן?'],
  ['preserve_support', 'מה חשוב לשמר במעטפת המקצועית והתפעולית שקיבלת?'],
  ['improve_support', 'מה כדאי לשנות או לשפר במעטפת המקצועית והתפעולית שקיבלת?'],
  ['training_needed', 'איזו הכשרה, הכנה או תמיכה נוספת הייתה מסייעת לך?'],
  ['additional_notes', 'האם יש דבר נוסף שחשוב לך לשתף?']
];

let dataPromise = null;
let dataCache = null;
let enhancementScheduled = false;

const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const hasValue = value => value !== null
  && value !== undefined
  && String(value).trim() !== '';

const statusText = status => ({
  draft: 'טיוטה',
  submitted: 'הוגש',
  reopened: 'נפתח מחדש'
}[status] || 'טרם התחיל');

const fmtDate = value => value
  ? new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : '—';

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function answerText(value) {
  if (value === 'na') return 'לא רלוונטי';
  return hasValue(value) ? String(value) : 'לא נענה';
}

function isAdminManagementView() {
  return new URLSearchParams(window.location.search).get('view') === 'admin'
    || Boolean(document.querySelector('.admin-tabs'));
}

function notify(message, isError = false) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    toast.className = 'toast';
  }, 3500);
}

async function loadAdminData({ refresh = false } = {}) {
  if (refresh) {
    dataCache = null;
    dataPromise = null;
  }
  if (dataCache) return dataCache;
  if (dataPromise) return dataPromise;

  dataPromise = (async () => {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) throw new Error('נדרשת התחברות מחדש.');

    const { data: userRecord, error: userError } = await supabase
      .from('users')
      .select('role,is_active')
      .eq('auth_user_id', auth.user.id)
      .maybeSingle();

    if (userError) throw userError;
    if (userRecord?.is_active !== true || normalizeRole(userRecord?.role) !== 'admin') {
      throw new Error('הצפייה בתשובות זמינה לאדמין בלבד.');
    }

    const { data: cycle, error: cycleError } = await supabase
      .from('summer_feedback_cycles')
      .select('*')
      .eq('cycle_key', CYCLE_KEY)
      .maybeSingle();

    if (cycleError) throw cycleError;
    if (!cycle) throw new Error('לא נמצא מחזור משוב פעיל.');

    const [assignmentsResult, responsesResult, ratingsResult] = await Promise.all([
      supabase
        .from('summer_feedback_assignments')
        .select('*')
        .eq('cycle_id', cycle.id)
        .order('instructor_name')
        .order('activity_name'),
      supabase
        .from('summer_feedback_responses')
        .select('*')
        .eq('cycle_id', cycle.id)
        .order('updated_at', { ascending: false }),
      supabase
        .from('summer_feedback_activity_ratings')
        .select('*')
        .eq('cycle_id', cycle.id)
    ]);

    for (const result of [assignmentsResult, responsesResult, ratingsResult]) {
      if (result.error) throw result.error;
    }

    return {
      cycle,
      assignments: assignmentsResult.data || [],
      responses: responsesResult.data || [],
      ratings: ratingsResult.data || []
    };
  })();

  try {
    dataCache = await dataPromise;
    return dataCache;
  } finally {
    dataPromise = null;
  }
}

function instructorData(data, instructorId) {
  const assignments = data.assignments.filter(
    row => row.instructor_auth_user_id === instructorId
  );
  const response = data.responses.find(
    row => row.instructor_auth_user_id === instructorId
  ) || null;
  const ratings = data.ratings.filter(
    row => row.instructor_auth_user_id === instructorId
  );
  return { assignments, response, ratings };
}

function hasSavedAnswers({ response, ratings }) {
  if (!response) return false;

  const hasGeneral = Object.values(response.general_answers || {}).some(hasValue);
  const hasSummary = Object.values(response.summary_answers || {}).some(hasValue);
  const hasRatings = ratings.some(rating =>
    METRICS.some(([key]) => hasValue(rating[key]))
    || (Array.isArray(rating.delivery_experience) && rating.delivery_experience.length > 0)
    || hasValue(rating.additional_note)
  );

  return hasGeneral || hasSummary || hasRatings;
}

function decorateButton(button, data) {
  const instructorId = String(button.dataset.preview || '').trim();
  if (!instructorId) return;

  const available = hasSavedAnswers(instructorData(data, instructorId));
  button.textContent = available ? 'צפייה בתשובות' : 'אין תשובות עדיין';
  button.classList.toggle('primary', available);
  button.disabled = !available;
  button.setAttribute('aria-disabled', available ? 'false' : 'true');
  button.dataset.adminResponseReady = available ? 'true' : 'false';
}

async function enhanceButtons() {
  if (!isAdminManagementView()) return;
  const buttons = [...document.querySelectorAll(BUTTON_SELECTOR)];
  if (!buttons.length) return;

  try {
    const data = await loadAdminData();
    buttons.filter(button => button.isConnected).forEach(button => decorateButton(button, data));
  } catch (error) {
    console.error('[summer-feedback] unable to prepare admin response buttons', error);
  }
}

function scheduleEnhancement() {
  if (enhancementScheduled) return;
  enhancementScheduled = true;
  requestAnimationFrame(() => {
    enhancementScheduled = false;
    void enhanceButtons();
  });
}

function ratingRows(rating) {
  return METRICS.map(([key, label]) => `
    <div class="admin-response-metric">
      <span>${esc(label)}</span>
      <strong class="${hasValue(rating?.[key]) ? '' : 'is-empty'}">${esc(answerText(rating?.[key]))}</strong>
    </div>
  `).join('');
}

function activityCards(assignments, ratings) {
  const ratingByAssignment = new Map(ratings.map(rating => [rating.assignment_id, rating]));

  return assignments.map((assignment, index) => {
    const rating = ratingByAssignment.get(assignment.id) || {};
    const grades = (assignment.grade_labels || []).join(', ');
    const experiences = Array.isArray(rating.delivery_experience)
      ? rating.delivery_experience
      : [];

    return `<details class="activity admin-response-activity" ${index === 0 ? 'open' : ''}>
      <summary>
        <span>
          <strong>${esc(assignment.activity_name)}</strong>
          <small>${Number(assignment.activity_count || 0)} הפעלות${grades ? ` · ${esc(grades)}` : ''}</small>
        </span>
        <b>${METRICS.filter(([key]) => hasValue(rating[key])).length}/${METRICS.length}</b>
      </summary>
      <div class="activity-body">
        <div class="admin-response-metrics">${ratingRows(rating)}</div>
        <div class="admin-response-answer-block">
          <h3>חוויית העברת הפעילות</h3>
          ${experiences.length
            ? `<div class="admin-response-chips">${experiences.map(value => `<span>${esc(value)}</span>`).join('')}</div>`
            : '<p class="admin-response-empty">לא נענה</p>'}
        </div>
        <div class="admin-response-answer-block">
          <h3>הערה או המלצה לפעילות זו</h3>
          <p class="${hasValue(rating.additional_note) ? '' : 'admin-response-empty'}">${esc(answerText(rating.additional_note))}</p>
        </div>
      </div>
    </details>`;
  }).join('');
}

function generalGroups(response) {
  const answers = response?.general_answers || {};
  return GENERAL_GROUPS.map((group, index) => `
    <details class="feedback-group admin-response-group" ${index === 0 ? 'open' : ''}>
      <summary>
        <span><strong>${index + 1}. ${esc(group.title)}</strong><small>${group.questions.length} היגדים</small></span>
      </summary>
      <div class="feedback-group-body">
        <div class="admin-response-question-list">
          ${group.questions.map(([key, label]) => `
            <div class="admin-response-question">
              <span>${esc(label)}</span>
              <strong class="${hasValue(answers[key]) ? '' : 'is-empty'}">${esc(answerText(answers[key]))}</strong>
            </div>
          `).join('')}
        </div>
      </div>
    </details>
  `).join('');
}

function summaryAnswers(response) {
  const answers = response?.summary_answers || {};
  return SUMMARY_FIELDS.map(([key, label]) => `
    <article class="admin-response-summary-item">
      <h3>${esc(label)}</h3>
      <p class="${hasValue(answers[key]) ? '' : 'admin-response-empty'}">${esc(answerText(answers[key]))}</p>
    </article>
  `).join('');
}

function adminUrl() {
  const url = new URL('./?view=admin', window.location.href);
  if (new URLSearchParams(window.location.search).get('embedded') === '1') {
    url.searchParams.set('embedded', '1');
  }
  return url.href;
}

function renderResponseView({ assignments, response, ratings }) {
  const app = document.querySelector('#app');
  if (!app || !assignments.length || !response) return;

  const name = assignments[0]?.instructor_name || 'מדריך/ה';
  const total = assignments.reduce((sum, row) => sum + Number(row.activity_count || 0), 0);
  const status = statusText(response.status);
  const draftNotice = response.status === 'submitted'
    ? '<strong>המשוב הוגש.</strong> מוצגות התשובות שנשמרו במערכת במצב קריאה בלבד.'
    : '<strong>זהו משוב שטרם הוגש.</strong> מוצגות התשובות שנשמרו עד כה בטיוטה, במצב קריאה בלבד.';

  app.innerHTML = `<div class="shell ${VIEWER_CLASS}">
    <header>
      <div class="brand"><span>ת</span><div><strong>תעשיידע</strong><small>משוב פעילות הקיץ</small></div></div>
      <div class="head-actions">
        <small>צפייה בתשובות · ${esc(name)}</small>
        <button class="button" type="button" data-admin-response-back>חזרה לניהול</button>
        <a class="button" href="../">חזרה לדשבורד</a>
      </div>
    </header>
    <main class="container">
      <div class="admin-response-top-action">
        <button class="button" type="button" data-admin-response-back>← חזרה לניהול המשובים</button>
      </div>
      <section class="hero admin-response-hero">
        <div>
          <h1>תשובות המשוב של ${esc(name)}</h1>
          <p>סטטוס: ${esc(status)} · עדכון אחרון: ${esc(fmtDate(response.updated_at))}</p>
        </div>
        <div class="hero-count">
          <strong>${assignments.length}</strong>
          <span>סוגי פעילויות · ${total} הפעלות</span>
        </div>
      </section>

      <div class="locked admin-response-readonly">${draftNotice}</div>

      <section class="panel">
        <h2>1. המעטפת שקיבלתי</h2>
        <p class="hint">הדירוגים מוצגים בסולם של 1–5. תשובה „לא רלוונטי” מוצגת במפורש.</p>
        <div class="feedback-groups">${generalGroups(response)}</div>
      </section>

      <section class="panel">
        <h2>2. הערכת הפעילויות</h2>
        <div class="activity-list">${activityCards(assignments, ratings)}</div>
      </section>

      <section class="panel">
        <h2>3. סיכום והמלצות</h2>
        <div class="admin-response-summary-list">${summaryAnswers(response)}</div>
      </section>

      <div class="admin-response-bottom-action">
        <button class="button primary" type="button" data-admin-response-back>חזרה לניהול המשובים</button>
      </div>
    </main>
  </div>`;

  document.querySelectorAll('[data-admin-response-back]').forEach(button => {
    button.addEventListener('click', () => window.location.assign(adminUrl()));
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function openInstructorResponses(button) {
  const instructorId = String(button?.dataset?.preview || '').trim();
  if (!instructorId) return;

  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  const originalText = button.textContent;
  button.textContent = 'טוען תשובות…';

  try {
    const data = await loadAdminData({ refresh: true });
    const selected = instructorData(data, instructorId);

    if (!hasSavedAnswers(selected)) {
      decorateButton(button, data);
      notify('עדיין לא נשמרו תשובות למשוב של מדריך/ה זה/ו.', true);
      return;
    }

    renderResponseView(selected);
  } catch (error) {
    console.error('[summer-feedback] unable to open instructor responses', error);
    button.disabled = false;
    button.textContent = originalText || 'צפייה בתשובות';
    notify(error?.message || 'לא ניתן לטעון את התשובות.', true);
  } finally {
    if (button.isConnected) button.removeAttribute('aria-busy');
  }
}

function handleResponseButtonClick(event) {
  const button = event.target.closest?.(BUTTON_SELECTOR);
  if (!button || !isAdminManagementView()) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  void openInstructorResponses(button);
}

function initializeAdminResponseView() {
  document.addEventListener('click', handleResponseButtonClick, true);
  const observer = new MutationObserver(scheduleEnhancement);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pageshow', scheduleEnhancement);
  scheduleEnhancement();
}

initializeAdminResponseView();

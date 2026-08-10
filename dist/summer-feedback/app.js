import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.3/+esm';

const supabase = createClient(
  'https://szinlhjuwyiyszdpsdop.supabase.co',
  'sb_publishable_k0IbDJlgPA9KTVuDWrCyFw_Zsa5kZIM',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

const CYCLE_KEY = 'summer_2026';
const DASHBOARD_URL = '../';

const GENERAL_GROUPS = [
  {
    key: 'content_training',
    title: 'תוכן והכשרה',
    questions: [
      ['preparation_info', 'המידע וחומרי התוכן שקיבלתי לפני הפעילות היו ברורים ומספקים'],
      ['professional_training', 'ההכשרה המקצועית הכינה אותי להעברת הפעילויות'],
      ['content_goals_clarity', 'מטרות הפעילויות ודרך ההעברה המצופה היו ברורות לי'],
      ['content_support', 'קיבלתי מענה מקצועי לשאלות תוכן לפני הפעילות ובמהלכה']
    ]
  },
  {
    key: 'coordination_scheduling',
    title: 'תיאום ושיבוץ',
    questions: [
      ['scheduling_timeliness', 'השיבוצים נמסרו לי בזמן שאפשר היערכות מתאימה'],
      ['schedule_clarity', 'פרטי הפעילות, הכתובת, השעות והקבוצה נמסרו בצורה ברורה'],
      ['change_updates', 'שינויים ועדכונים הועברו בצורה מסודרת ובזמן'],
      ['constraints_response', 'אילוצים ובקשות שהעליתי קיבלו התייחסות עניינית']
    ]
  },
  {
    key: 'activity_management',
    title: 'ניהול הפעילות והמענה השוטף',
    questions: [
      ['management_contact_clarity', 'היה לי ברור למי לפנות בכל שאלה, תקלה או צורך'],
      ['daily_resources_check', 'לפני הפעילויות וידאו איתי שיש ברשותי את המידע, הציוד והחומרים הנדרשים'],
      ['management_communication', 'התקיים איתי קשר שוטף, ברור ומכבד לאורך תקופת הפעילות'],
      ['issue_resolution', 'חוסרים, תקלות ובעיות טופלו בזמן וביעילות']
    ]
  },
  {
    key: 'logistics',
    title: 'לוגיסטיקה וציוד',
    questions: [
      ['equipment_distribution', 'הציוד והערכות נמסרו בזמן ובצורה מסודרת'],
      ['equipment_completeness', 'הציוד והחומרים היו מלאים, תקינים ומוכנים לשימוש'],
      ['equipment_replenishment', 'במידת הצורך ניתנו השלמות לציוד ולחומרים בהתאם לדרישה']
    ]
  },
  {
    key: 'confidence_overall',
    title: 'תחושת ביטחון והערכה כללית',
    questions: [
      ['readiness_confidence', 'הרגשתי מוכן/ה ובטוח/ה להעביר את הפעילויות'],
      ['full_support_envelope', 'התמיכה שקיבלתי אפשרה לי להתמקד בהדרכה'],
      ['overall_organization', 'באופן כללי, פעילות הקיץ הייתה מאורגנת ומנוהלת היטב']
    ]
  }
];

const GENERAL = GENERAL_GROUPS.flatMap(group => group.questions);

const METRICS = [
  ['age_fit', 'הפעילות התאימה לגיל המשתתפים'],
  ['content_clarity', 'התוכן ורצף ההדרכה היו ברורים'],
  ['time_fit', 'היקף התוכן התאים לזמן הפעילות'],
  ['equipment_quality', 'הציוד והחומרים התאימו לפעילות'],
  ['student_engagement', 'הפעילות עוררה עניין והשתתפות'],
  ['overall_rating', 'ההערכה הכללית שלי לפעילות היא חיובית']
];

const EXPERIENCE_OPTIONS = [
  'קלה להעברה',
  'נעימה ומהנה',
  'עמוסה',
  'מורכבת או מסורבלת',
  'דרשה ממני לבצע התאמות במהלך ההדרכה',
  'מתאימה להעברה כפי שהיא'
];

const SUMMARY_FIELDS = [
  ['preserve_activities', 'מה חשוב לשמר בפעילויות הקיץ עצמן?'],
  ['improve_activities', 'מה כדאי לשנות או לשפר בפעילויות הקיץ עצמן?'],
  ['preserve_support', 'מה חשוב לשמר במעטפת המקצועית והתפעולית שקיבלת?'],
  ['improve_support', 'מה כדאי לשנות או לשפר במעטפת המקצועית והתפעולית שקיבלת?'],
  ['training_needed', 'איזו הכשרה, הכנה או תמיכה נוספת הייתה מסייעת לך?'],
  ['additional_notes', 'האם יש דבר נוסף שחשוב לך לשתף?']
];

const REQUIRED_SUMMARY_KEYS = SUMMARY_FIELDS.slice(0, 5).map(([key]) => key);

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const state = {
  user: null,
  cycle: null,
  assignments: [],
  responses: [],
  ratings: [],
  response: null,
  mode: 'instructor',
  submitted: false,
  saveTimer: null,
  savePromise: null,
  revision: 0,
  savedRevision: 0,
  adminTab: 'status',
  canAdmin: false,
  hasOwnFeedback: false,
  previewMode: false,
  adminAssignments: [],
  adminResponses: [],
  adminRatings: []
};

const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const statusText = status => ({
  draft: 'טיוטה',
  submitted: 'הוגש',
  reopened: 'נפתח מחדש'
}[status] || 'טרם התחיל');

const fmtDate = value => value
  ? new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : '—';

const hasValue = value => value !== null && value !== undefined && String(value).trim() !== '';

const mean = values => {
  const nums = values
    .filter(hasValue)
    .map(Number)
    .filter(value => Number.isFinite(value) && value >= 1 && value <= 5);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
};

const cycleIsOpen = cycle => {
  const now = Date.now();
  const opensAt = cycle?.opens_at ? new Date(cycle.opens_at).getTime() : null;
  const closesAt = cycle?.closes_at ? new Date(cycle.closes_at).getTime() : null;
  return cycle?.status === 'open'
    && (!opensAt || opensAt <= now)
    && (!closesAt || closesAt >= now);
};

function notify(message, error = false) {
  toast.textContent = message;
  toast.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

function frame(content, label = '') {
  const modeLink = state.previewMode
    ? '<a class="button" href="./?view=admin">חזרה לניהול</a>'
    : state.canAdmin
      ? (
          state.mode === 'admin'
            ? (
                state.hasOwnFeedback && cycleIsOpen(state.cycle)
                  ? '<a class="button" href="./">המשוב שלי</a>'
                  : ''
              )
            : '<a class="button" href="./?view=admin">ניהול משובים</a>'
        )
      : '';

  return `<div class="shell">
    <header>
      <div class="brand"><span>ת</span><div><strong>תעשיידע</strong><small>משוב פעילות הקיץ</small></div></div>
      <div class="head-actions">
        ${label ? `<small>${esc(label)}</small>` : ''}
        ${modeLink}
        <a class="button" href="${DASHBOARD_URL}">חזרה לדשבורד</a>
      </div>
    </header>
    ${content}
  </div>`;
}

function renderMessage(title, text) {
  app.innerHTML = frame(`<main class="center">
    <section class="panel">
      <h1>${esc(title)}</h1>
      <p>${esc(text)}</p>
      <a class="button primary" href="${DASHBOARD_URL}">חזרה לדשבורד</a>
    </section>
  </main>`);
}

async function init() {
  try {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) {
      return renderMessage('נדרשת התחברות', 'יש להיכנס תחילה לדשבורד באמצעות המשתמש האישי.');
    }
    state.user = auth.user;

    const { data: cycle, error: cycleError } = await supabase
      .from('summer_feedback_cycles')
      .select('*')
      .eq('cycle_key', CYCLE_KEY)
      .maybeSingle();

    if (cycleError) throw cycleError;
    if (!cycle) return renderMessage('המשוב אינו זמין', 'המשוב עדיין אינו פתוח למילוי.');
    state.cycle = cycle;

    const [assignments, responses, ratings] = await Promise.all([
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

    for (const result of [assignments, responses, ratings]) {
      if (result.error) throw result.error;
    }

    state.assignments = assignments.data || [];
    state.responses = responses.data || [];
    state.ratings = ratings.data || [];
    state.adminAssignments = [...state.assignments];
    state.adminResponses = [...state.responses];
    state.adminRatings = [...state.ratings];

    const ownAssignments = state.assignments.filter(
      row => row.instructor_auth_user_id === state.user.id
    );
    state.hasOwnFeedback = ownAssignments.length > 0;
    state.canAdmin = state.assignments.some(
      row => row.instructor_auth_user_id !== state.user.id
    );

    const requestedAdmin = new URLSearchParams(window.location.search).get('view') === 'admin';
    const cycleOpen = cycleIsOpen(state.cycle);
    state.mode = state.canAdmin && (requestedAdmin || !state.hasOwnFeedback || !cycleOpen)
      ? 'admin'
      : 'instructor';

    if (state.mode === 'admin') return renderAdmin();

    if (!cycleOpen) {
      return renderMessage(
        'המשוב עדיין אינו פתוח',
        'לא ניתן למלא או לערוך את המשוב לפני מועד הפתיחה שנקבע.'
      );
    }

    state.assignments = ownAssignments;
    state.ratings = state.ratings.filter(
      row => row.instructor_auth_user_id === state.user.id
    );

    if (!state.assignments.length) {
      return renderMessage(
        'לא נמצאו פעילויות',
        'לא משויכות למשתמש שלך פעילויות שנכללו במשוב.'
      );
    }

    await ensureResponse();
    renderInstructor();
  } catch (error) {
    console.error(error);
    renderMessage(
      'לא ניתן לטעון את המשוב',
      'אירעה שגיאה בטעינת הנתונים. יש לרענן את הדף או להיכנס מחדש.'
    );
  }
}

async function ensureResponse() {
  let response = state.responses.find(
    row => row.instructor_auth_user_id === state.user.id
  );

  if (!response) {
    const result = await supabase
      .from('summer_feedback_responses')
      .insert({
        cycle_id: state.cycle.id,
        instructor_auth_user_id: state.user.id,
        status: 'draft'
      })
      .select()
      .single();

    if (result.error) throw result.error;
    response = result.data;
    state.responses.push(response);
  }

  state.response = response;
  state.submitted = response.status === 'submitted';
}

function ratingOptions(value, includeNotRelevant = false) {
  const selected = String(value ?? '');
  const options = [
    '<option value="">בחרו</option>',
    ...[1, 2, 3, 4, 5].map(number =>
      `<option value="${number}" ${selected === String(number) ? 'selected' : ''}>${number}</option>`
    )
  ];

  if (includeNotRelevant) {
    options.push(
      `<option value="na" ${selected === 'na' ? 'selected' : ''}>לא רלוונטי</option>`
    );
  }

  return options.join('');
}

function chips(values, selected, assignmentId, locked) {
  const selectedValues = Array.isArray(selected) ? selected : [];
  return values.map(value => `
    <label class="chip">
      <input
        type="checkbox"
        data-experience
        data-assignment="${assignmentId}"
        value="${esc(value)}"
        ${selectedValues.includes(value) ? 'checked' : ''}
        ${locked ? 'disabled' : ''}
      >
      <span>${esc(value)}</span>
    </label>
  `).join('');
}

function ratingFor(id) {
  return state.ratings.find(row => row.assignment_id === id) || {};
}

function generalGroupCard(group, index, locked) {
  const completed = group.questions.filter(
    ([key]) => hasValue(state.response.general_answers?.[key])
  ).length;

  return `<details class="feedback-group" ${index === 0 ? 'open' : ''}>
    <summary>
      <span>
        <strong>${index + 1}. ${esc(group.title)}</strong>
        <small>${group.questions.length} היגדים</small>
      </span>
      <b data-general-complete="${esc(group.key)}">${completed}/${group.questions.length}</b>
    </summary>
    <div class="feedback-group-body">
      <div class="general-grid">
        ${group.questions.map(([key, label]) => `
          <label class="question">
            <span>${esc(label)}</span>
            <select name="general_${key}" ${locked ? 'disabled' : ''}>
              ${ratingOptions(state.response.general_answers?.[key], true)}
            </select>
          </label>
        `).join('')}
      </div>
    </div>
  </details>`;
}

function summaryFieldsHtml(locked) {
  return SUMMARY_FIELDS.map(([key, label]) => `
    <label class="text-question">
      <span>${esc(label)}</span>
      <textarea data-summary="${key}" ${locked ? 'disabled' : ''}>${esc(
        state.response.summary_answers?.[key] || ''
      )}</textarea>
    </label>
  `).join('');
}

function renderInstructor() {
  const preview = state.previewMode;
  const locked = state.submitted && !preview;
  const total = state.assignments.reduce(
    (sum, row) => sum + Number(row.activity_count || 0),
    0
  );
  const name = state.assignments[0]?.instructor_name || state.user?.email || '';

  const statusLine = preview
    ? '<span class="badge draft">תצוגה מקדימה</span><span id="saveStatus">הנתונים אינם נשמרים</span>'
    : `<span class="badge ${esc(state.response.status)}">${statusText(state.response.status)}</span>
       <span id="saveStatus">${locked
         ? `הוגש ${fmtDate(state.response.submitted_at)}`
         : 'כל שינוי נשמר אוטומטית'}</span>`;

  const banner = preview
    ? '<div class="locked"><strong>תצוגה מקדימה לאדמין בלבד.</strong> ניתן להתנסות בשדות, אך דבר אינו נשמר או נשלח.</div>'
    : locked
      ? '<div class="locked"><strong>המשוב הוגש וננעל.</strong> מנהל מורשה יכול לפתוח אותו מחדש.</div>'
      : '';

  const submitBar = preview
    ? '<span>מצב תצוגה מקדימה — ללא שמירה וללא הגשה.</span><a class="button primary" href="./?view=admin">חזרה לניהול</a>'
    : locked
      ? '<span>המשוב הושלם.</span>'
      : '<button class="button secondary" type="button" id="saveNow">שמירת טיוטה</button><button class="button primary" type="submit">הגשת המשוב</button>';

  app.innerHTML = frame(`<main class="container">
    <section class="hero">
      <div>
        <h1>משוב פעילות הקיץ</h1>
        <p>שלום ${esc(name)}. המשוב עוסק במעטפת שקיבלת ובפעילויות שהעברת, ואינו הערכה של עבודתך.</p>
      </div>
      <div class="hero-count">
        <strong>${state.assignments.length}</strong>
        <span>סוגי פעילויות · ${total} הפעלות</span>
      </div>
    </section>

    <div class="status">${statusLine}</div>
    ${banner}

    <div class="progress">
      <div><strong>התקדמות</strong><span id="progressText">0%</span></div>
      <div class="track"><i id="progressBar"></i></div>
    </div>

    <form id="feedbackForm">
      <section class="panel">
        <h2>1. המעטפת שקיבלתי</h2>
        <p class="hint">
          ההיגדים מדורגים בסולם של 1–5: 1 – כלל לא, 5 – במידה רבה מאוד.
          כאשר ההיגד אינו רלוונטי או שלא הייתה אפשרות להתרשם ממנו, ניתן לבחור „לא רלוונטי”.
        </p>
        <div class="feedback-groups">
          ${GENERAL_GROUPS.map((group, index) => generalGroupCard(group, index, locked)).join('')}
        </div>
      </section>

      <section class="panel">
        <h2>2. הערכת הפעילויות</h2>
        <p class="hint">
          השאלות יוצגו בנפרד עבור כל סוג פעילות שהעברת. ההיגדים מדורגים בסולם של 1–5:
          1 – כלל לא, 5 – במידה רבה מאוד.
        </p>
        <div class="activity-list">
          ${state.assignments.map((assignment, index) =>
            activityCard(assignment, locked, index === 0)
          ).join('')}
        </div>
      </section>

      <section class="panel">
        <h2>3. סיכום והמלצות</h2>
        ${summaryFieldsHtml(locked)}
      </section>

      <div class="submit-bar">${submitBar}</div>
    </form>
  </main>`, preview ? `תצוגה מקדימה · ${name}` : name);

  const form = document.querySelector('#feedbackForm');
  form?.addEventListener('input', onEdit);
  form?.addEventListener('change', onEdit);

  if (preview) {
    form?.addEventListener('submit', event => event.preventDefault());
  } else {
    form?.addEventListener('submit', submitFeedback);
    document.querySelector('#saveNow')?.addEventListener('click', async () => {
      markDirty();
      await saveDraft(false);
    });
  }

  updateProgress();
}

function activityCard(assignment, locked, open = false) {
  const rating = ratingFor(assignment.id);
  const grades = (assignment.grade_labels || []).join(', ');

  return `<details class="activity" ${open ? 'open' : ''}>
    <summary>
      <span>
        <strong>${esc(assignment.activity_name)}</strong>
        <small>${assignment.activity_count} הפעלות${grades ? ` · ${esc(grades)}` : ''}</small>
      </span>
      <b data-complete="${assignment.id}">0/${METRICS.length + 1}</b>
    </summary>

    <div class="activity-body">
      <div class="metric-grid">
        ${METRICS.map(([key, label]) => `
          <label>
            <span>${esc(label)}</span>
            <select
              data-rating="${key}"
              data-assignment="${assignment.id}"
              ${locked ? 'disabled' : ''}
            >
              ${ratingOptions(rating[key])}
            </select>
          </label>
        `).join('')}
      </div>

      <div class="activity-experience">
        <strong>כיצד חווית את העברת הפעילות?</strong>
        <small>ניתן לבחור יותר מתשובה אחת.</small>
        <div class="chips">
          ${chips(
            EXPERIENCE_OPTIONS,
            rating.delivery_experience,
            assignment.id,
            locked
          )}
        </div>
      </div>

      <label class="activity-free-note">
        <span>הערה או המלצה לפעילות זו</span>
        <textarea
          data-note="additional"
          data-assignment="${assignment.id}"
          placeholder="מה עבד היטב בפעילות? מה היה קשה, עמוס או מסורבל ומה כדאי לשנות או לשפר?"
          ${locked ? 'disabled' : ''}
        >${esc(rating.additional_note || '')}</textarea>
      </label>
    </div>
  </details>`;
}

function onEdit() {
  if (state.submitted && !state.previewMode) return;
  updateProgress();
  if (state.previewMode) return;
  markDirty();
  queueSave();
}

function markDirty() {
  state.revision += 1;
}

function queueSave() {
  clearTimeout(state.saveTimer);
  const label = document.querySelector('#saveStatus');
  if (label) label.textContent = 'ממתין לשמירה…';
  state.saveTimer = setTimeout(() => {
    saveDraft(true).catch(() => {});
  }, 700);
}

function readGeneralAnswer(key) {
  const raw = document.querySelector(`[name="general_${key}"]`)?.value || '';
  if (raw === 'na') return 'na';
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric >= 1 && numeric <= 5 ? numeric : null;
}

function selectedExperience(assignmentId) {
  return [...document.querySelectorAll(
    `[data-experience][data-assignment="${assignmentId}"]:checked`
  )].map(element => element.value);
}

function addLegacyCompatibility(generalAnswers, summaryAnswers, ratings) {
  const copy = (target, source) => {
    generalAnswers[target] = generalAnswers[source] ?? null;
  };

  copy('workload', 'constraints_response');
  copy('management_presence', 'management_contact_clarity');
  copy('daily_readiness_check', 'daily_resources_check');
  copy('ongoing_contact', 'management_communication');
  copy('post_activity_followup', 'issue_resolution');
  copy('support_response', 'management_communication');
  copy('equipment_quantity_fit', 'equipment_replenishment');
  copy('logistics_instructions', 'equipment_replenishment');
  copy('professional_backup', 'full_support_envelope');

  const summaryComplete = REQUIRED_SUMMARY_KEYS.every(
    key => Boolean(summaryAnswers[key])
  );
  summaryAnswers.preserve = summaryComplete
    ? summaryAnswers.preserve_activities
    : '';
  summaryAnswers.improve = summaryComplete
    ? summaryAnswers.improve_activities
    : '';

  ratings.forEach(rating => {
    const hasExperience = Array.isArray(rating.delivery_experience)
      && rating.delivery_experience.length > 0;
    const compatibilityValue = hasExperience && rating.overall_rating
      ? rating.overall_rating
      : null;
    rating.delivery_ease = compatibilityValue;
    rating.student_success = compatibilityValue;
  });
}

function collectSnapshot() {
  const generalAnswers = Object.fromEntries(
    GENERAL.map(([key]) => [key, readGeneralAnswer(key)])
  );

  const summaryAnswers = {};
  document.querySelectorAll('[data-summary]').forEach(element => {
    summaryAnswers[element.dataset.summary] = element.value.trim();
  });

  const ratings = state.assignments.map(assignment => {
    const value = key => {
      const raw = document.querySelector(
        `[data-rating="${key}"][data-assignment="${assignment.id}"]`
      )?.value || '';
      const numeric = Number(raw);
      return Number.isFinite(numeric) && numeric >= 1 && numeric <= 5
        ? numeric
        : null;
    };

    return {
      response_id: state.response.id,
      assignment_id: assignment.id,
      cycle_id: state.cycle.id,
      instructor_auth_user_id: state.previewMode
        ? assignment.instructor_auth_user_id
        : state.user.id,
      ...Object.fromEntries(METRICS.map(([key]) => [key, value(key)])),
      delivery_experience: selectedExperience(assignment.id),
      additional_note: document.querySelector(
        `[data-note="additional"][data-assignment="${assignment.id}"]`
      )?.value.trim() || ''
    };
  });

  addLegacyCompatibility(generalAnswers, summaryAnswers, ratings);
  return {
    general_answers: generalAnswers,
    summary_answers: summaryAnswers,
    ratings
  };
}

async function saveDraft(silent = true) {
  if (state.previewMode || state.submitted) return true;

  if (state.savePromise) {
    const previous = await state.savePromise;
    if (!previous) return false;
    return state.savedRevision < state.revision
      ? saveDraft(silent)
      : true;
  }

  const version = state.revision;
  const snapshot = collectSnapshot();
  const label = document.querySelector('#saveStatus');
  if (label) label.textContent = 'שומר…';

  state.savePromise = (async () => {
    try {
      const responseStatus = state.response.status === 'reopened'
        ? 'reopened'
        : 'draft';

      const responseResult = await supabase
        .from('summer_feedback_responses')
        .update({
          general_answers: snapshot.general_answers,
          summary_answers: snapshot.summary_answers,
          status: responseStatus
        })
        .eq('id', state.response.id)
        .select()
        .single();

      if (responseResult.error) throw responseResult.error;

      const ratingsResult = await supabase
        .from('summer_feedback_activity_ratings')
        .upsert(snapshot.ratings, { onConflict: 'response_id,assignment_id' })
        .select();

      if (ratingsResult.error) throw ratingsResult.error;

      state.response = responseResult.data;
      state.ratings = ratingsResult.data || snapshot.ratings;
      state.savedRevision = Math.max(state.savedRevision, version);

      if (label && state.savedRevision >= state.revision) {
        label.textContent = `נשמר ${new Intl.DateTimeFormat('he-IL', {
          timeStyle: 'short'
        }).format(new Date())}`;
      }

      if (!silent) notify('הטיוטה נשמרה.');
      return true;
    } catch (error) {
      console.error(error);
      if (label) label.textContent = 'השמירה נכשלה';
      notify('שמירת הטיוטה נכשלה.', true);
      return false;
    } finally {
      state.savePromise = null;
    }
  })();

  const saved = await state.savePromise;
  return saved && state.savedRevision < state.revision && !state.submitted
    ? saveDraft(true)
    : saved;
}

function validate() {
  const snapshot = collectSnapshot();
  const missing = [];

  GENERAL.forEach(([key, label]) => {
    if (!hasValue(snapshot.general_answers[key])) missing.push(label);
  });

  state.assignments.forEach((assignment, index) => {
    const rating = snapshot.ratings[index];

    METRICS.forEach(([key, label]) => {
      if (!hasValue(rating[key])) {
        missing.push(`${assignment.activity_name} – ${label}`);
      }
    });

    if (!rating.delivery_experience.length) {
      missing.push(`${assignment.activity_name} – כיצד חווית את העברת הפעילות`);
    }
  });

  REQUIRED_SUMMARY_KEYS.forEach(key => {
    if (!snapshot.summary_answers[key]) {
      const label = SUMMARY_FIELDS.find(([fieldKey]) => fieldKey === key)?.[1] || key;
      missing.push(label);
    }
  });

  return missing;
}

async function submitFeedback(event) {
  event.preventDefault();
  if (state.previewMode) return;

  const missing = validate();
  if (missing.length) {
    return notify(`נותרו ${missing.length} שדות חובה למילוי.`, true);
  }

  if (!confirm('להגיש את המשוב? לאחר ההגשה התשובות יינעלו.')) return;

  const button = event.submitter;
  if (button) {
    button.disabled = true;
    button.textContent = 'מגיש…';
  }

  try {
    clearTimeout(state.saveTimer);
    markDirty();

    if (!await saveDraft(true)) {
      throw new Error('draft save failed');
    }

    const result = await supabase
      .from('summer_feedback_responses')
      .update({ status: 'submitted' })
      .eq('id', state.response.id)
      .select()
      .single();

    if (result.error) throw result.error;

    state.response = result.data;
    state.submitted = true;
    notify('המשוב הוגש בהצלחה.');
    renderInstructor();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    console.error(error);
    notify('הגשת המשוב נכשלה.', true);
    if (button) {
      button.disabled = false;
      button.textContent = 'הגשת המשוב';
    }
  }
}

function updateProgress() {
  const snapshot = collectSnapshot();

  const completedGeneral = GENERAL.filter(
    ([key]) => hasValue(snapshot.general_answers[key])
  ).length;

  const completedActivities = snapshot.ratings.reduce((sum, rating) => {
    const metricCount = METRICS.filter(([key]) => hasValue(rating[key])).length;
    const experienceCount = rating.delivery_experience.length ? 1 : 0;
    return sum + metricCount + experienceCount;
  }, 0);

  const completedSummary = REQUIRED_SUMMARY_KEYS.filter(
    key => Boolean(snapshot.summary_answers[key])
  ).length;

  const total = GENERAL.length
    + state.assignments.length * (METRICS.length + 1)
    + REQUIRED_SUMMARY_KEYS.length;

  const complete = completedGeneral + completedActivities + completedSummary;
  const percent = total ? Math.round((complete / total) * 100) : 0;

  const text = document.querySelector('#progressText');
  const bar = document.querySelector('#progressBar');
  if (text) text.textContent = `${percent}%`;
  if (bar) bar.style.width = `${percent}%`;

  GENERAL_GROUPS.forEach(group => {
    const count = group.questions.filter(
      ([key]) => hasValue(snapshot.general_answers[key])
    ).length;
    const element = document.querySelector(
      `[data-general-complete="${group.key}"]`
    );
    if (element) element.textContent = `${count}/${group.questions.length}`;
  });

  state.assignments.forEach((assignment, index) => {
    const rating = snapshot.ratings[index];
    const metricCount = METRICS.filter(([key]) => hasValue(rating[key])).length;
    const experienceCount = rating.delivery_experience.length ? 1 : 0;
    const element = document.querySelector(`[data-complete="${assignment.id}"]`);
    if (element) {
      element.textContent = `${metricCount + experienceCount}/${METRICS.length + 1}`;
    }
  });
}

function groupedInstructors() {
  const map = new Map();

  state.assignments.forEach(assignment => {
    if (!map.has(assignment.instructor_auth_user_id)) {
      map.set(assignment.instructor_auth_user_id, {
        id: assignment.instructor_auth_user_id,
        name: assignment.instructor_name,
        emp: assignment.instructor_emp_id,
        types: 0,
        total: 0
      });
    }

    const group = map.get(assignment.instructor_auth_user_id);
    group.types += 1;
    group.total += Number(assignment.activity_count || 0);
  });

  return [...map.values()].sort(
    (a, b) => a.name.localeCompare(b.name, 'he')
  );
}

function renderAdmin() {
  state.previewMode = false;
  state.mode = 'admin';
  state.assignments = [...state.adminAssignments];
  state.responses = [...state.adminResponses];
  state.ratings = [...state.adminRatings];
  state.response = null;
  state.submitted = false;

  const groups = groupedInstructors();
  const submitted = state.responses.filter(
    response => response.status === 'submitted'
  ).length;

  const holdNotice = cycleIsOpen(state.cycle)
    ? ''
    : '<div class="locked"><strong>המשוב סגור למדריכים.</strong> רק אדמין יכול לצפות בתצוגה המקדימה. לא מתבצעת שמירה או הגשה.</div>';

  app.innerHTML = frame(`<main class="container">
    <section class="hero">
      <div>
        <h1>ניהול משוב פעילות הקיץ</h1>
        <p>מעקב מילוי, ניתוח הפעילויות ותצוגה מקדימה לפני הפצה.</p>
      </div>
      <div class="hero-count">
        <strong>${submitted}/${groups.length}</strong>
        <span>משובים שהוגשו</span>
      </div>
    </section>

    ${holdNotice}

    <div class="admin-tabs">
      <button class="button ${state.adminTab === 'status' ? 'primary' : ''}" data-tab="status">מעקב מילוי</button>
      <button class="button ${state.adminTab === 'analysis' ? 'primary' : ''}" data-tab="analysis">ניתוח פעילויות</button>
      <button class="button" id="exportCsv">ייצוא CSV</button>
    </div>

    <section class="panel">
      ${state.adminTab === 'status' ? statusTable(groups) : analysisTable()}
    </section>
  </main>`, 'תצוגת ניהול');

  document.querySelectorAll('[data-tab]').forEach(button => {
    button.addEventListener('click', () => {
      state.adminTab = button.dataset.tab;
      renderAdmin();
    });
  });

  document.querySelector('#exportCsv')?.addEventListener('click', exportCsv);
  document.querySelectorAll('[data-reopen]').forEach(button => {
    button.addEventListener('click', reopen);
  });
  document.querySelectorAll('[data-preview]').forEach(button => {
    button.addEventListener('click', previewInstructor);
  });
}

function statusTable(groups) {
  return `<h2>סטטוס מדריכים</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>מדריך/ה</th>
            <th>סוגים</th>
            <th>הפעלות</th>
            <th>סטטוס</th>
            <th>עדכון</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${groups.map(group => {
            const response = state.responses.find(
              item => item.instructor_auth_user_id === group.id
            );
            const reopenButton = response?.status === 'submitted'
              ? `<button class="button" data-reopen="${response.id}">פתיחה מחדש</button>`
              : '';

            return `<tr>
              <td><strong>${esc(group.name)}</strong><small>מס׳ עובד ${esc(group.emp)}</small></td>
              <td>${group.types}</td>
              <td>${group.total}</td>
              <td><span class="badge ${esc(response?.status || '')}">${statusText(response?.status)}</span></td>
              <td>${fmtDate(response?.updated_at)}</td>
              <td><button class="button primary" data-preview="${group.id}">תצוגה מקדימה</button>${reopenButton}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function previewInstructor(event) {
  if (!state.canAdmin) return;

  const instructorId = event.currentTarget.dataset.preview;
  const previewAssignments = state.adminAssignments.filter(
    row => row.instructor_auth_user_id === instructorId
  );

  if (!previewAssignments.length) {
    return notify('לא נמצאו פעילויות לתצוגה מקדימה.', true);
  }

  state.previewMode = true;
  state.mode = 'instructor';
  state.assignments = previewAssignments;
  state.ratings = [];
  state.response = {
    id: 'preview',
    status: 'draft',
    general_answers: {},
    summary_answers: {}
  };
  state.submitted = false;
  state.revision = 0;
  state.savedRevision = 0;

  renderInstructor();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function experienceSummary(ratings) {
  const counts = new Map();
  ratings.forEach(rating => {
    (rating.delivery_experience || []).forEach(option => {
      counts.set(option, (counts.get(option) || 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'he'))
    .map(([option, count]) => `${option}: ${count}`)
    .join(' · ') || '—';
}

function analysisTable() {
  const map = new Map();

  state.assignments.forEach(assignment => {
    if (!map.has(assignment.activity_key)) {
      map.set(assignment.activity_key, {
        name: assignment.activity_name,
        total: 0,
        ids: []
      });
    }

    const item = map.get(assignment.activity_key);
    item.total += Number(assignment.activity_count || 0);
    item.ids.push(assignment.id);
  });

  const rows = [...map.values()].map(item => {
    const ratings = state.ratings.filter(
      rating => item.ids.includes(rating.assignment_id)
    );
    const rated = ratings.filter(
      rating => METRICS.some(([key]) => hasValue(rating[key]))
    );
    const averages = Object.fromEntries(
      METRICS.map(([key]) => [key, mean(rated.map(rating => rating[key]))])
    );

    return {
      ...item,
      count: rated.length,
      ...averages,
      experience: experienceSummary(ratings)
    };
  }).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'he')
  );

  const format = number => number == null ? '—' : number.toFixed(2);

  return `<h2>ניתוח לפי פעילות</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>פעילות</th>
            <th>הפעלות</th>
            <th>דירוגים</th>
            ${METRICS.map(([, label]) => `<th>${esc(label)}</th>`).join('')}
            <th>חוויית ההעברה</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `<tr>
            <td><strong>${esc(row.name)}</strong></td>
            <td>${row.total}</td>
            <td>${row.count}</td>
            ${METRICS.map(([key]) => `<td>${format(row[key])}</td>`).join('')}
            <td>${esc(row.experience)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

async function reopen(event) {
  if (!confirm('לפתוח את המשוב מחדש לעריכה?')) return;

  const result = await supabase
    .from('summer_feedback_responses')
    .update({ status: 'reopened' })
    .eq('id', event.currentTarget.dataset.reopen)
    .select()
    .single();

  if (result.error) {
    return notify('פתיחת המשוב נכשלה.', true);
  }

  state.adminResponses = state.adminResponses.map(response =>
    response.id === result.data.id ? result.data : response
  );
  state.responses = [...state.adminResponses];

  notify('המשוב נפתח מחדש.');
  renderAdmin();
}

function csv(value) {
  const text = Array.isArray(value)
    ? value.join(' | ')
    : String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function generalExportValue(value) {
  return value === 'na' ? 'לא רלוונטי' : value;
}

function exportCsv() {
  const responses = new Map(
    state.responses.map(response => [response.instructor_auth_user_id, response])
  );
  const ratings = new Map(
    state.ratings.map(rating => [rating.assignment_id, rating])
  );

  const rows = [[
    'מדריך',
    'מספר עובד',
    'פעילות',
    'הפעלות',
    'שכבות גיל',
    'סטטוס',
    ...GENERAL.map(([, label]) => label),
    ...METRICS.map(([, label]) => label),
    'כיצד חווית את העברת הפעילות?',
    'הערה או המלצה לפעילות זו',
    ...SUMMARY_FIELDS.map(([, label]) => label)
  ]];

  state.assignments.forEach(assignment => {
    const response = responses.get(assignment.instructor_auth_user_id);
    const rating = ratings.get(assignment.id) || {};
    const general = response?.general_answers || {};
    const summary = response?.summary_answers || {};

    rows.push([
      assignment.instructor_name,
      assignment.instructor_emp_id,
      assignment.activity_name,
      assignment.activity_count,
      assignment.grade_labels,
      statusText(response?.status),
      ...GENERAL.map(([key]) => generalExportValue(general[key])),
      ...METRICS.map(([key]) => rating[key]),
      rating.delivery_experience,
      rating.additional_note,
      ...SUMMARY_FIELDS.map(([key]) => summary[key])
    ]);
  });

  const blob = new Blob(
    ['\uFEFF' + rows.map(row => row.map(csv).join(',')).join('\n')],
    { type: 'text/csv;charset=utf-8' }
  );
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `summer-feedback-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

init();

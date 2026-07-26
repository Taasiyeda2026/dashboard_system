import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const CYCLE_KEY = 'summer_2026';
const FEEDBACK_URL = './summer-feedback/';
const CARD_ATTRIBUTE = 'data-summer-feedback-instructor-card';
const STYLE_ID = 'summer-feedback-instructor-card-styles';
const TEST_MODE_FLAG = '__SUMMER_FEEDBACK_INSTRUCTOR_CARD_TEST__';
const CACHE_TTL_MS = 30_000;
const REFRESH_INTERVAL_MS = 30_000;

const GENERAL_VISIBLE_KEYS = [
  'preparation_info',
  'professional_training',
  'content_goals_clarity',
  'content_support',
  'scheduling_timeliness',
  'schedule_clarity',
  'change_updates',
  'constraints_response',
  'management_contact_clarity',
  'daily_resources_check',
  'management_communication',
  'issue_resolution',
  'equipment_distribution',
  'equipment_completeness',
  'equipment_replenishment',
  'readiness_confidence',
  'full_support_envelope',
  'overall_organization'
];

const ACTIVITY_METRIC_KEYS = [
  'age_fit',
  'content_clarity',
  'time_fit',
  'equipment_quality',
  'student_engagement',
  'overall_rating'
];

const REQUIRED_SUMMARY_KEYS = [
  'preserve_activities',
  'improve_activities',
  'preserve_support',
  'improve_support',
  'training_needed'
];

let cachedUserId = '';
let cachedState = null;
let cachedAt = 0;
let statePromise = null;
let enhancementScheduled = false;
let enhancementVersion = 0;
let refreshTimer = null;

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

export function cycleIsOpen(cycle, now = Date.now()) {
  const opensAt = cycle?.opens_at ? new Date(cycle.opens_at).getTime() : null;
  const closesAt = cycle?.closes_at ? new Date(cycle.closes_at).getTime() : null;
  return cycle?.status === 'open'
    && (!opensAt || opensAt <= now)
    && (!closesAt || closesAt >= now);
}

export function calculateSummerFeedbackProgress({ assignments = [], response = null, ratings = [] } = {}) {
  if (response?.status === 'submitted') return 100;

  const generalAnswers = response?.general_answers || {};
  const summaryAnswers = response?.summary_answers || {};
  const ratingByAssignment = new Map(
    (Array.isArray(ratings) ? ratings : []).map((row) => [String(row?.assignment_id || ''), row || {}])
  );

  const completedGeneral = GENERAL_VISIBLE_KEYS.filter((key) => hasValue(generalAnswers[key])).length;
  const completedSummary = REQUIRED_SUMMARY_KEYS.filter((key) => hasValue(summaryAnswers[key])).length;
  const completedActivities = (Array.isArray(assignments) ? assignments : []).reduce((sum, assignment) => {
    const rating = ratingByAssignment.get(String(assignment?.id || '')) || {};
    const completedMetrics = ACTIVITY_METRIC_KEYS.filter((key) => hasValue(rating[key])).length;
    const completedExperience = Array.isArray(rating.delivery_experience) && rating.delivery_experience.length > 0 ? 1 : 0;
    return sum + completedMetrics + completedExperience;
  }, 0);

  const activityFieldCount = ACTIVITY_METRIC_KEYS.length + 1;
  const total = GENERAL_VISIBLE_KEYS.length
    + (Array.isArray(assignments) ? assignments.length : 0) * activityFieldCount
    + REQUIRED_SUMMARY_KEYS.length;
  const completed = completedGeneral + completedActivities + completedSummary;
  return total > 0 ? Math.min(100, Math.max(0, Math.round((completed / total) * 100))) : 0;
}

export function buildSummerFeedbackCardState({ assignments = [], response = null, ratings = [] } = {}) {
  const progress = calculateSummerFeedbackProgress({ assignments, response, ratings });
  const submitted = response?.status === 'submitted';
  const started = !submitted && progress > 0;

  if (submitted) {
    return {
      progress: 100,
      status: 'הושלם',
      title: 'משוב פעילות הקיץ הוגש',
      description: 'תודה על מילוי המשוב ועל שיתוף הניסיון מהשטח.',
      action: 'צפייה במשוב',
      complete: true
    };
  }

  if (started) {
    return {
      progress,
      status: `בתהליך · ${progress}%`,
      title: 'משוב פעילות הקיץ ממתין להשלמה',
      description: 'התשובות שכבר מילאת נשמרו ואפשר להמשיך מאותה נקודה.',
      action: 'המשך מילוי',
      complete: false
    };
  }

  return {
    progress: 0,
    status: 'טרם התחיל',
    title: 'משוב פעילות הקיץ פתוח למילוי',
    description: 'נשמח לשמוע על המעטפת שקיבלת ועל הפעילויות שהדרכת בקיץ.',
    action: 'התחלת המשוב',
    complete: false
  };
}

function ensureCardStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .ds-summer-feedback-card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 14px;
      margin: 0 0 var(--ds-space-3, 16px);
      padding: 14px 16px;
      background: linear-gradient(135deg, #183153, #10243d);
      color: #fff;
      border: 1px solid rgba(255,255,255,.13);
      border-radius: 14px;
      box-shadow: 0 10px 24px rgba(16,36,61,.16);
    }
    .instructor-area > .ds-summer-feedback-card { margin-top: 12px; }
    .ds-summer-feedback-card.is-complete { background: linear-gradient(135deg, #276749, #1f5a3f); }
    .ds-summer-feedback-card__icon {
      display: grid;
      place-items: center;
      width: 42px;
      height: 42px;
      border-radius: 12px;
      background: rgba(255,255,255,.13);
      font-size: 21px;
      line-height: 1;
    }
    .ds-summer-feedback-card__content { min-width: 0; }
    .ds-summer-feedback-card__status {
      display: inline-flex;
      align-items: center;
      min-height: 23px;
      margin-bottom: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(255,255,255,.14);
      color: #f3f7fb;
      font-size: 11.5px;
      font-weight: 700;
    }
    .ds-summer-feedback-card__title {
      margin: 0;
      color: #fff;
      font-size: 17px;
      font-weight: 750;
      line-height: 1.3;
    }
    .ds-summer-feedback-card__description {
      margin: 3px 0 0;
      color: #e5edf6;
      font-size: 12.5px;
      line-height: 1.45;
    }
    .ds-summer-feedback-card__progress {
      width: min(260px, 100%);
      height: 5px;
      margin-top: 9px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255,255,255,.18);
    }
    .ds-summer-feedback-card__progress > span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: #fff;
    }
    .ds-summer-feedback-card__action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 38px;
      padding: 7px 13px;
      color: #183153;
      background: #fff;
      border: 1px solid rgba(255,255,255,.85);
      border-radius: 9px;
      text-decoration: none;
      font-size: 13px;
      font-weight: 750;
      white-space: nowrap;
    }
    .ds-summer-feedback-card__action:hover { background: #f4f7fa; }
    @media (max-width: 720px) {
      .ds-summer-feedback-card {
        grid-template-columns: auto minmax(0, 1fr);
        gap: 10px;
        padding: 12px;
      }
      .ds-summer-feedback-card__icon { width: 38px; height: 38px; font-size: 19px; }
      .ds-summer-feedback-card__title { font-size: 15px; }
      .ds-summer-feedback-card__description { font-size: 12px; }
      .ds-summer-feedback-card__action {
        grid-column: 1 / -1;
        width: fit-content;
        min-height: 36px;
        margin-inline-start: auto;
        padding-inline: 12px;
      }
    }
  `;
  document.head.append(style);
}

export function createSummerFeedbackCard(cardState, doc = document) {
  const card = doc.createElement('section');
  card.className = `ds-summer-feedback-card${cardState.complete ? ' is-complete' : ''}`;
  card.setAttribute(CARD_ATTRIBUTE, 'true');
  card.setAttribute('aria-label', 'משוב פעילות הקיץ');
  card.innerHTML = `
    <div class="ds-summer-feedback-card__icon" aria-hidden="true">${cardState.complete ? '✓' : '☀'}</div>
    <div class="ds-summer-feedback-card__content">
      <span class="ds-summer-feedback-card__status">${cardState.status}</span>
      <h2 class="ds-summer-feedback-card__title">${cardState.title}</h2>
      <p class="ds-summer-feedback-card__description">${cardState.description}</p>
      <div class="ds-summer-feedback-card__progress" role="progressbar" aria-label="התקדמות במילוי משוב הקיץ" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${cardState.progress}">
        <span style="width:${cardState.progress}%"></span>
      </div>
    </div>
    <a class="ds-summer-feedback-card__action" href="${FEEDBACK_URL}">${cardState.action}</a>
  `;
  return card;
}

export function injectSummerFeedbackCard(host, cardState) {
  if (!host?.isConnected || host.querySelector(`[${CARD_ATTRIBUTE}]`)) return false;
  const card = createSummerFeedbackCard(cardState, host.ownerDocument || document);
  const header = host.querySelector(':scope > .ds-dash-header, :scope > .ds-page-header, :scope > header');
  if (header) header.insertAdjacentElement('afterend', card);
  else host.prepend(card);
  return true;
}

export function findSummerFeedbackCardHost(root = document) {
  return root.querySelector?.('.ds-dashboard-wrap, .instructor-area') || null;
}

function clearCachedState() {
  cachedUserId = '';
  cachedState = null;
  cachedAt = 0;
  statePromise = null;
}

async function fetchCurrentInstructorCardState() {
  if (!supabase) return { visible: false };

  const session = await waitForSupabaseAuthSession({ timeoutMs: 2500 });
  const userId = String(session?.user?.id || '').trim();
  if (!userId) return { visible: false };

  const now = Date.now();
  if (cachedState && cachedUserId === userId && now - cachedAt < CACHE_TTL_MS) return cachedState;
  if (statePromise && cachedUserId === userId) return statePromise;

  cachedUserId = userId;
  statePromise = (async () => {
    const cycleResult = await supabase
      .from('summer_feedback_cycles')
      .select('id,status,opens_at,closes_at')
      .eq('cycle_key', CYCLE_KEY)
      .maybeSingle();

    if (cycleResult.error || !cycleIsOpen(cycleResult.data)) return { visible: false };
    const cycle = cycleResult.data;

    const [assignmentsResult, responseResult] = await Promise.all([
      supabase
        .from('summer_feedback_assignments')
        .select('id,activity_count')
        .eq('cycle_id', cycle.id)
        .eq('instructor_auth_user_id', userId)
        .order('activity_name'),
      supabase
        .from('summer_feedback_responses')
        .select('id,status,general_answers,summary_answers,updated_at')
        .eq('cycle_id', cycle.id)
        .eq('instructor_auth_user_id', userId)
        .maybeSingle()
    ]);

    if (assignmentsResult.error || responseResult.error) return { visible: false };
    const assignments = assignmentsResult.data || [];
    if (!assignments.length) return { visible: false };

    const response = responseResult.data || null;
    let ratings = [];
    if (response?.id) {
      const ratingsResult = await supabase
        .from('summer_feedback_activity_ratings')
        .select('assignment_id,age_fit,content_clarity,time_fit,equipment_quality,student_engagement,overall_rating,delivery_experience')
        .eq('cycle_id', cycle.id)
        .eq('instructor_auth_user_id', userId);
      if (!ratingsResult.error) ratings = ratingsResult.data || [];
    }

    return {
      visible: true,
      cardState: buildSummerFeedbackCardState({ assignments, response, ratings })
    };
  })();

  try {
    cachedState = await statePromise;
    cachedAt = Date.now();
    return cachedState;
  } catch (error) {
    console.warn('[summer-feedback] failed to load instructor dashboard card', error);
    cachedState = { visible: false };
    cachedAt = Date.now();
    return cachedState;
  } finally {
    statePromise = null;
  }
}

async function enhanceHomeWithSummerFeedbackCard() {
  if (typeof document === 'undefined') return;
  const host = findSummerFeedbackCardHost(document);
  if (!host) return;

  const version = ++enhancementVersion;
  const result = await fetchCurrentInstructorCardState();
  if (version !== enhancementVersion || !host.isConnected) return;

  const existing = host.querySelector(`[${CARD_ATTRIBUTE}]`);
  if (!result.visible) {
    existing?.remove();
    return;
  }

  ensureCardStyles();
  if (existing) existing.replaceWith(createSummerFeedbackCard(result.cardState, host.ownerDocument || document));
  else injectSummerFeedbackCard(host, result.cardState);
}

function scheduleEnhancement() {
  if (enhancementScheduled) return;
  enhancementScheduled = true;
  requestAnimationFrame(() => {
    enhancementScheduled = false;
    void enhanceHomeWithSummerFeedbackCard();
  });
}

function refreshFromServer() {
  clearCachedState();
  scheduleEnhancement();
}

function initializeSummerFeedbackInstructorCard() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  ensureCardStyles();

  const observer = new MutationObserver(scheduleEnhancement);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('app:navigate', scheduleEnhancement);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshFromServer();
  });
  window.addEventListener('focus', refreshFromServer);
  supabase?.auth?.onAuthStateChange?.(() => refreshFromServer());

  clearInterval(refreshTimer);
  refreshTimer = window.setInterval(refreshFromServer, REFRESH_INTERVAL_MS);
  scheduleEnhancement();
}

if (globalThis[TEST_MODE_FLAG] !== true) initializeSummerFeedbackInstructorCard();

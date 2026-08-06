import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';

const STATUS_LABELS = {
  not_opened: 'טרם נפתח',
  employee_preparation: 'במילוי אישי',
  ready_for_conversation: 'מוכן לשיחה',
  conversation_in_progress: 'שיחת משוב',
  manager_preparation: 'סיכום מנהל',
  awaiting_employee_response: 'ממתין לתגובת העובד',
  completed_locked: 'הושלם'
};

const EMPLOYEE_QUESTIONS = [
  ['achievements', 'הישגים ותרומה', 'אילו הישגים, משימות, פרויקטים או תרומות שלך מהתקופה האחרונה חשוב לך להדגיש?'],
  ['strengths', 'חוזקות', 'אילו חוזקות אישיות ומקצועיות סייעו לך בעבודה ומה חשוב לדעתך להמשיך לשמר ולפתח?'],
  ['challenges', 'אתגרים והתמודדות', 'אילו משימות, מצבים או תקופות היו מאתגרים עבורך וכיצד התמודדת איתם?'],
  ['work_management', 'ניהול העבודה', 'כיצד את/ה חווה את עומס העבודה, סדרי העדיפויות, חלוקת המשימות ובהירות תחומי האחריות שלך?'],
  ['collaboration', 'שיתוף פעולה ותקשורת', 'כיצד את/ה חווה את שיתוף הפעולה, העברת המידע וחלוקת האחריות מול המנהל, הצוות וגורמים נוספים?'],
  ['development', 'למידה והתפתחות', 'באילו תחומים מקצועיים או אישיים התפתחת בתקופה האחרונה ובאילו תחומים היית רוצה להמשיך להתפתח?'],
  ['initiative', 'יוזמה ושיפור תהליכים', 'אילו תהליכים או דרכי עבודה מתנהלים היטב, ואילו תהליכים לדעתך כדאי לשנות, להפסיק או להתחיל לקדם?'],
  ['support', 'תמיכה נדרשת', 'אילו כלים, משאבים, הכשרה, מידע או תמיכה יכולים לסייע לך להצליח יותר בעבודה?'],
  ['goals', 'מטרות להמשך', 'אילו מטרות, משימות או תחומי אחריות היית רוצה לקדם בתקופה הקרובה?'],
  ['additional', 'התייחסות נוספת', 'האם יש ביקורת, הצעה או נושא נוסף שחשוב לך להעלות במסגרת המשוב?']
];

const MANAGER_QUESTIONS = [
  ['achievements', 'הישגים ותרומה', 'מהם ההישגים, המשימות, הפרויקטים או התרומות המרכזיים של העובד בתקופה האחרונה?', 'רמת התרומה והעמידה ביעדים'],
  ['strengths', 'חוזקות', 'אילו חוזקות אישיות ומקצועיות בולטות בעבודת העובד ומה חשוב להמשיך לשמר ולפתח?', 'ביטוי החוזקות בעבודה השוטפת'],
  ['challenges', 'אתגרים והתמודדות', 'אילו אתגרים או קשיים מרכזיים עמדו בפני העובד וכיצד התמודד עמם?', 'יכולת התמודדות עם קשיים ופתרון בעיות'],
  ['work_management', 'ניהול העבודה', 'כיצד העובד מנהל את משימותיו, סדרי העדיפויות, לוחות הזמנים ותחומי האחריות שלו?', 'תכנון, ארגון, אחריות ועמידה בלוחות זמנים'],
  ['collaboration', 'שיתוף פעולה ותקשורת', 'כיצד העובד משתף פעולה, מעביר מידע ומתנהל מול המנהל, הצוות וגורמים נוספים?', 'תקשורת מקצועית, שירותיות ועבודה מול ממשקים'],
  ['development', 'למידה והתפתחות', 'באילו תחומים העובד התפתח בתקופה האחרונה ובאילו תחומים נדרש המשך פיתוח מקצועי או אישי?', 'למידה, גמישות וקבלת משוב'],
  ['initiative', 'יוזמה ושיפור תהליכים', 'כיצד העובד תורם ליוזמה, לפתרון בעיות ולשיפור תהליכי העבודה?', 'יוזמה, חשיבה עצמאית ושיפור תהליכים'],
  ['support', 'תמיכה נדרשת', 'איזו תמיכה, הכוונה, הכשרה או משאבים יסייעו לעובד להצליח ולהתפתח?', ''],
  ['goals', 'מטרות להמשך', 'אילו מטרות, משימות או תחומי אחריות מומלץ שהעובד יקדם בתקופה הקרובה?', ''],
  ['additional', 'התייחסות נוספת', 'האם יש נושא נוסף שחשוב להעלות במסגרת המשוב?', '']
];

const CONVERSATION_GUIDE = [
  'מהם הנושאים שבהם קיימת הסכמה בין העובד למנהל?',
  'באילו נושאים קיימים פערים בין תפיסת העובד לתפיסת המנהל?',
  'אילו הישגים וחוזקות חשוב להכיר ולשמר?',
  'אילו קשיים, חסמים או נקודות לשיפור עלו?',
  'האם קיימים פערים בציפיות, בתחומי האחריות או בסדרי העדיפויות?',
  'איזו תמיכה, הכוונה או משאבים עשויים לסייע לעובד?',
  'אילו נושאים חשוב לקדם בתקופה הקרובה?',
  'האם יש נושא נוסף שאחד הצדדים מבקש להעלות?'
];

const SUMMARY_FIELDS = [
  ['overall_assessment', 'הערכה מסכמת', 'מהי הערכתך המסכמת בנוגע לתפקודו ולתרומתו של העובד בתקופה הנבחנת?'],
  ['management_conclusion', 'מסקנה ניהולית', 'מהי המסקנה הניהולית המרכזית שעלתה מהמשוב ומהשיחה?'],
  ['expectations', 'ציפיות להמשך', 'מהן הציפיות וסדרי העדיפויות המרכזיים מהעובד בתקופה הקרובה?'],
  ['additional_notes', 'הערות נוספות', 'האם יש החלטה, הנחיה או הערה ניהולית נוספת שחשוב לתעד?']
];

const state = {
  userId: '',
  reviews: [],
  currentReview: null,
  currentBundle: null,
  saveTimers: new WeakMap(),
  pendingSaves: new Set(),
  rendering: false
};

function installStyles() {
  if (document.getElementById('annual-reviews-v2-styles')) return;
  const style = document.createElement('style');
  style.id = 'annual-reviews-v2-styles';
  style.textContent = `
    #app .ar2-screen{min-height:100%;direction:rtl}
    #app .ar2-topbar{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--ds-border,#d9dee7);background:var(--ds-surface,#fff);position:sticky;top:0;z-index:5}
    #app .ar2-topbar__title{font-weight:700}
    #app .ar2-topbar__spacer{flex:1}
    #app .ar2-body{max-width:1120px;margin:0 auto;padding:16px;display:grid;gap:14px}
    #app .ar2-card{background:var(--ds-surface,#fff);border:1px solid var(--ds-border,#d9dee7);border-radius:14px;padding:16px;box-shadow:0 3px 14px rgba(15,23,42,.05)}
    #app .ar2-card__head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
    #app .ar2-card h1,#app .ar2-card h2,#app .ar2-card h3{margin:0;line-height:1.3}
    #app .ar2-card h2{font-size:1.12rem}
    #app .ar2-card h3{font-size:1rem}
    #app .ar2-muted{color:var(--ds-text-muted,#64748b);font-size:.9rem;line-height:1.55}
    #app .ar2-status{display:inline-flex;align-items:center;min-height:26px;padding:3px 9px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:.78rem;font-weight:700;white-space:nowrap}
    #app .ar2-status.is-complete{background:#ecfdf5;color:#047857}
    #app .ar2-status.is-waiting{background:#fff7ed;color:#c2410c}
    #app .ar2-review-list{display:grid;gap:9px;margin-top:12px}
    #app .ar2-review-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:11px 12px;border:1px solid var(--ds-border,#d9dee7);border-radius:11px}
    #app .ar2-review-row__name{display:grid;gap:2px}
    #app .ar2-btn{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:6px 12px;border:1px solid transparent;border-radius:9px;font:inherit;font-size:.86rem;font-weight:700;cursor:pointer;white-space:nowrap}
    #app .ar2-btn--primary{background:var(--ds-accent,#2563eb);color:#fff}
    #app .ar2-btn--ghost{background:transparent;border-color:var(--ds-border,#cbd5e1);color:inherit}
    #app .ar2-btn:disabled{opacity:.55;cursor:not-allowed}
    #app .ar2-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}
    #app .ar2-progress{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin:0;padding:0;list-style:none}
    #app .ar2-progress li{display:grid;place-items:center;gap:4px;text-align:center;color:var(--ds-text-muted,#64748b);font-size:.73rem}
    #app .ar2-progress span{display:grid;place-items:center;width:25px;height:25px;border:1px solid var(--ds-border,#cbd5e1);border-radius:50%;background:#fff;font-weight:700}
    #app .ar2-progress li.is-current{color:var(--ds-accent,#2563eb);font-weight:700}
    #app .ar2-progress li.is-current span{border-color:var(--ds-accent,#2563eb);background:var(--ds-accent,#2563eb);color:#fff}
    #app .ar2-progress li.is-complete{color:#047857}
    #app .ar2-progress li.is-complete span{border-color:#10b981;background:#10b981;color:#fff}
    #app .ar2-question-list{display:grid;gap:12px}
    #app .ar2-question{display:grid;gap:7px;padding:12px;border:1px solid var(--ds-border,#e2e8f0);border-radius:11px;background:rgba(248,250,252,.55)}
    #app .ar2-question__title{font-weight:700}
    #app .ar2-question__prompt{margin:0;color:var(--ds-text-muted,#475569);line-height:1.55}
    #app .ar2-textarea{width:100%;min-height:86px;resize:vertical;border:1px solid var(--ds-border,#cbd5e1);border-radius:9px;padding:9px 10px;background:var(--ds-surface,#fff);color:inherit;font:inherit;line-height:1.5;box-sizing:border-box}
    #app .ar2-textarea[readonly]{background:#f8fafc;color:#334155}
    #app .ar2-rating-wrap{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
    #app .ar2-rating-label{font-size:.8rem;color:var(--ds-text-muted,#64748b);margin-inline-end:4px}
    #app .ar2-rating{display:inline-grid;place-items:center;min-width:31px;height:31px;padding:0 7px;border:1px solid var(--ds-border,#cbd5e1);border-radius:8px;background:#fff;color:inherit;font:inherit;font-size:.78rem;cursor:pointer}
    #app .ar2-rating.is-selected{background:var(--ds-accent,#2563eb);border-color:var(--ds-accent,#2563eb);color:#fff}
    #app .ar2-rating:disabled{cursor:default;opacity:.85}
    #app .ar2-private{padding:14px;border:1px dashed var(--ds-border,#cbd5e1);border-radius:10px;background:#f8fafc;color:#475569;text-align:center}
    #app .ar2-save{min-height:20px;font-size:.78rem;color:var(--ds-text-muted,#64748b)}
    #app .ar2-save[data-state="error"]{color:#b91c1c}
    #app .ar2-save[data-state="saved"]{color:#047857}
    #app .ar2-metrics{display:grid;gap:9px;margin-top:12px}
    #app .ar2-metric{display:grid;gap:7px;padding:11px;border:1px solid var(--ds-border,#e2e8f0);border-radius:10px}
    #app .ar2-guide{margin:10px 0 0;padding-inline-start:24px;display:grid;gap:8px;line-height:1.55}
    #app .ar2-summary-grid{display:grid;gap:12px}
    #app .ar2-field{display:grid;gap:6px}
    #app .ar2-field>span{font-weight:700}
    #app .ar2-select,#app .ar2-input{min-height:38px;border:1px solid var(--ds-border,#cbd5e1);border-radius:9px;padding:7px 9px;background:#fff;color:inherit;font:inherit;box-sizing:border-box}
    #app .ar2-check{display:flex;align-items:flex-start;gap:8px;line-height:1.5}
    #app .ar2-check input{margin-top:4px}
    #app .ar2-signatures{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;font-size:.86rem}
    #app .ar2-toast{position:fixed;inset-inline-start:18px;bottom:18px;z-index:9999;max-width:min(420px,calc(100vw - 36px));padding:10px 13px;border-radius:10px;background:#0f172a;color:#fff;box-shadow:0 8px 28px rgba(15,23,42,.22)}
    #app .ar2-toast.is-error{background:#991b1b}
    #app .ar2-empty{padding:22px;text-align:center;color:var(--ds-text-muted,#64748b)}
    @media(max-width:760px){
      #app .ar2-body{padding:10px}
      #app .ar2-review-row{grid-template-columns:1fr auto}
      #app .ar2-review-row .ar2-status{grid-column:1}
      #app .ar2-progress{grid-template-columns:repeat(5,1fr)}
      #app .ar2-progress li{font-size:.62rem}
      #app .ar2-signatures{grid-template-columns:1fr}
    }
    @media print{
      body.ar2-printing .ar2-no-print,body.ar2-printing .shell-sidebar,body.ar2-printing .shell-top{display:none!important}
      body.ar2-printing #app .ar2-body{max-width:none;padding:0}
      body.ar2-printing #app .ar2-card{box-shadow:none;border-color:#cbd5e1;break-inside:avoid;margin-bottom:10px}
      body.ar2-printing #app .ar2-screen{background:#fff;color:#111827}
      body.ar2-printing #app .ar2-private{display:none}
      body.ar2-printing #app .ar2-textarea{border:0;padding:0;min-height:0;resize:none;overflow:visible;background:#fff}
      body.ar2-printing #app .ar2-question{break-inside:avoid;background:#fff}
      body.ar2-printing #app .ar2-rating:not(.is-selected){display:none}
      body.ar2-printing #app .ar2-rating.is-selected{background:#fff;color:#111827;border-color:#111827}
    }
  `;
  document.head.appendChild(style);
}

function rootElement() {
  return document.querySelector('#pr-root') || document.querySelector('.pr-module-root');
}

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('he-IL');
  } catch {
    return '—';
  }
}

function showToast(message, kind = '') {
  document.querySelector('.ar2-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `ar2-toast${kind === 'error' ? ' is-error' : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

function statusClass(review) {
  if (review.status === 'completed_locked') return 'is-complete';
  if (review.status === 'employee_preparation' || review.status === 'awaiting_employee_response') return 'is-waiting';
  return '';
}

function stepIndex(status) {
  if (status === 'not_opened' || status === 'employee_preparation') return 1;
  if (status === 'ready_for_conversation') return 2;
  if (status === 'conversation_in_progress') return 3;
  if (status === 'manager_preparation') return 4;
  if (status === 'awaiting_employee_response') return 5;
  if (status === 'completed_locked') return 6;
  return 1;
}

function progressHtml(review) {
  const labels = ['מילוי אישי', 'חשיפת החלקים', 'שיחת משוב', 'סיכום מנהל', 'תגובת העובד'];
  const current = stepIndex(review.status);
  return `<ol class="ar2-progress ar2-no-print">${labels.map((label, index) => {
    const position = index + 1;
    const cls = position < current ? 'is-complete' : position === current ? 'is-current' : '';
    return `<li class="${cls}"><span>${position < current ? '✓' : position}</span>${escapeHtml(label)}</li>`;
  }).join('')}</ol>`;
}

async function ensureUser() {
  if (state.userId) return state.userId;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  state.userId = data.session?.user?.id || '';
  if (!state.userId) throw new Error('לא נמצאה התחברות פעילה.');
  return state.userId;
}

async function loadReviews() {
  const uid = await ensureUser();
  const { data: reviews, error } = await supabase
    .from('annual_reviews')
    .select('*')
    .or(`employee_id.eq.${uid},manager_id.eq.${uid}`)
    .order('review_year', { ascending: false });
  if (error) throw error;

  const { data: assignments, error: assignmentError } = await supabase
    .from('annual_review_assignments')
    .select('employee_id,manager_id,employee_name,employee_role');
  if (assignmentError) throw assignmentError;

  const managerIds = [...new Set((reviews || []).map((row) => row.manager_id).filter(Boolean))];
  const managerNames = new Map();
  await Promise.all(managerIds.map(async (managerId) => {
    const { data } = await supabase.rpc('resolve_annual_review_manager_name', { p_manager_id: managerId });
    managerNames.set(managerId, typeof data === 'string' ? data.trim() : '');
  }));

  const assignmentByEmployee = new Map((assignments || []).map((row) => [row.employee_id, row]));
  state.reviews = (reviews || []).map((review) => ({
    ...review,
    ...(assignmentByEmployee.get(review.employee_id) || {}),
    manager_name: managerNames.get(review.manager_id) || ''
  }));
  return state.reviews;
}

function landingCardHtml(rows) {
  const uid = state.userId;
  const managed = rows.filter((row) => row.manager_id === uid);
  const own = rows.find((row) => row.employee_id === uid);
  const visible = managed.length ? managed : own ? [own] : [];
  return `<section class="ar2-card" data-ar2-landing>
    <div class="ar2-card__head">
      <div>
        <p class="ar2-muted" style="margin:0 0 4px">משוב שנתי</p>
        <h2>${managed.length ? 'ניהול משובים שנתיים' : 'המשוב השנתי שלי'}</h2>
      </div>
    </div>
    ${visible.length ? `<div class="ar2-review-list">${visible.map((review) => `
      <article class="ar2-review-row">
        <div class="ar2-review-row__name">
          <strong>${escapeHtml(review.employee_name || 'עובד/ת')}</strong>
          <span class="ar2-muted">${escapeHtml(String(review.review_year || ''))}</span>
        </div>
        <span class="ar2-status ${statusClass(review)}">${escapeHtml(STATUS_LABELS[review.status] || review.status)}</span>
        <button type="button" class="ar2-btn ar2-btn--primary" data-ar2-open="${escapeHtml(review.id)}">פתיחת המשוב</button>
      </article>`).join('')}</div>` : '<div class="ar2-empty">לא נמצאו משובים להצגה.</div>'}
  </section>`;
}

async function enhanceExistingLanding() {
  const landing = document.querySelector('.pr-screen--reviews .ar-landing:not([data-ar2-enhanced])');
  if (!landing || state.rendering) return;
  landing.dataset.ar2Enhanced = 'loading';
  try {
    const rows = await loadReviews();
    landing.outerHTML = landingCardHtml(rows);
  } catch (error) {
    landing.dataset.ar2Enhanced = 'error';
    console.warn('[annual-reviews-v2] landing load failed', error);
  }
}

async function renderStandaloneLanding() {
  const root = rootElement();
  if (!root) return;
  state.rendering = true;
  try {
    const rows = await loadReviews();
    root.innerHTML = `<div class="ar2-screen">
      <div class="ar2-topbar ar2-no-print">
        <button type="button" class="ar2-btn ar2-btn--ghost" data-ar2-dashboard>← חזרה לדשבורד</button>
        <span class="ar2-topbar__title">משובים</span>
      </div>
      <main class="ar2-body">${landingCardHtml(rows)}</main>
    </div>`;
  } finally {
    state.rendering = false;
  }
}

async function loadBundle(review) {
  const requests = await Promise.all([
    supabase.from('employee_review_preparation').select('*').eq('review_id', review.id).maybeSingle(),
    supabase.from('manager_review_preparation').select('*').eq('review_id', review.id).maybeSingle(),
    supabase.from('manager_review_evaluations').select('*').eq('review_id', review.id).eq('metric_group', 'role').order('sort_order'),
    supabase.from('manager_review_summary').select('*').eq('review_id', review.id).maybeSingle(),
    supabase.from('employee_review_response').select('*').eq('review_id', review.id).maybeSingle()
  ]);
  const failed = requests.find((request) => request.error);
  if (failed) throw failed.error;
  return {
    employee: requests[0].data,
    manager: requests[1].data,
    metrics: requests[2].data || [],
    summary: requests[3].data,
    response: requests[4].data
  };
}

function questionTextarea(key, title, prompt, value, editable) {
  return `<div class="ar2-question" data-question-key="${escapeHtml(key)}">
    <div class="ar2-question__title">${escapeHtml(title)}</div>
    <p class="ar2-question__prompt">${escapeHtml(prompt)}</p>
    <textarea class="ar2-textarea" name="${escapeHtml(key)}" rows="4" ${editable ? '' : 'readonly'}>${escapeHtml(value || '')}</textarea>
  </div>`;
}

function ratingButtons(selected, notApplicable, editable, attrs = '') {
  return `${[1, 2, 3, 4, 5].map((rating) => `
    <button type="button" class="ar2-rating ${Number(selected) === rating && !notApplicable ? 'is-selected' : ''}" data-value="${rating}" ${attrs} ${editable ? '' : 'disabled'}>${rating}</button>`).join('')}
    <button type="button" class="ar2-rating ${notApplicable ? 'is-selected' : ''}" data-value="na" ${attrs} ${editable ? '' : 'disabled'}>לא רלוונטי</button>`;
}

function employeeSectionHtml(review, bundle, isManager, isEmployee) {
  const revealed = Boolean(review.answers_revealed_at);
  const submitted = Boolean(review.employee_section_submitted_at);
  const editable = isEmployee && review.status === 'employee_preparation' && !submitted && !review.locked_at;
  const visible = isEmployee || revealed;
  const status = submitted ? 'אושר וננעל' : editable ? 'למילוי' : revealed ? 'נחשף' : 'פרטי לעובד';
  return `<section class="ar2-card" id="ar2-employee-section">
    <div class="ar2-card__head"><div><h2>חלק העובד</h2><p class="ar2-muted">מילוי עצמאי של העובד. החלק נחשף לאחר אישור שני הצדדים.</p></div><span class="ar2-status ${submitted ? 'is-complete' : ''}">${escapeHtml(status)}</span></div>
    ${visible ? `<form data-ar2-form="employee" data-version="${escapeHtml(String(bundle.employee?.version || ''))}">
      <div class="ar2-question-list">${EMPLOYEE_QUESTIONS.map(([key, title, prompt]) => questionTextarea(key, title, prompt, bundle.employee?.answers?.[key], editable)).join('')}</div>
      <div class="ar2-save" aria-live="polite"></div>
    </form>` : `<div class="ar2-private">${submitted ? 'העובד אישר את חלקו. התוכן ייחשף לאחר אישור חלק המנהל.' : 'החלק פתוח לעובד בלבד ואינו מוצג למנהל בשלב זה.'}</div>`}
    ${editable ? '<div class="ar2-actions ar2-no-print"><button type="button" class="ar2-btn ar2-btn--primary" data-ar2-operation="submit_employee_section">אישור חלק העובד</button></div>' : ''}
  </section>`;
}

function managerQuestionHtml(question, answer, editable) {
  const [key, title, prompt, ratingLabel] = question;
  const normalized = answer && typeof answer === 'object' ? answer : { text: typeof answer === 'string' ? answer : '' };
  return `<div class="ar2-question" data-question-key="${escapeHtml(key)}">
    <div class="ar2-question__title">${escapeHtml(title)}</div>
    <p class="ar2-question__prompt">${escapeHtml(prompt)}</p>
    ${ratingLabel ? `<div class="ar2-rating-wrap"><span class="ar2-rating-label">${escapeHtml(ratingLabel)}:</span>${ratingButtons(normalized.rating, normalized.not_applicable, editable, 'data-ar2-answer-rating')}</div>` : ''}
    <textarea class="ar2-textarea" name="${escapeHtml(key)}" rows="4" ${editable ? '' : 'readonly'}>${escapeHtml(normalized.text || '')}</textarea>
  </div>`;
}

function roleMetricsHtml(metrics, editable) {
  if (!metrics.length) return '<div class="ar2-private">לא הוגדרו מדדים מקצועיים לתפקיד זה.</div>';
  return `<div class="ar2-metrics">${metrics.map((metric) => `
    <div class="ar2-metric" data-metric-id="${escapeHtml(metric.id)}" data-version="${escapeHtml(String(metric.version || ''))}">
      <strong>${escapeHtml(metric.metric_label)}</strong>
      <div class="ar2-rating-wrap">${ratingButtons(metric.rating, metric.not_applicable, editable, `data-ar2-role-rating data-metric-id="${escapeHtml(metric.id)}"`)}</div>
      <textarea class="ar2-textarea" rows="2" data-ar2-metric-comment ${editable ? '' : 'readonly'} placeholder="הערה לפי הצורך">${escapeHtml(metric.comment || '')}</textarea>
      <div class="ar2-save" aria-live="polite"></div>
    </div>`).join('')}</div>`;
}

function managerSectionHtml(review, bundle, isManager, isEmployee) {
  const revealed = Boolean(review.answers_revealed_at);
  const submitted = Boolean(review.manager_section_submitted_at);
  const editable = isManager && review.status === 'employee_preparation' && !submitted && !review.locked_at;
  const visible = isManager || revealed;
  const status = submitted ? 'אושר וננעל' : editable ? 'למילוי' : revealed ? 'נחשף' : 'פרטי למנהל';
  return `<section class="ar2-card" id="ar2-manager-section">
    <div class="ar2-card__head"><div><h2>חלק המנהל</h2><p class="ar2-muted">שאלות מקבילות לחלק העובד, לצד מדדים מקצועיים לפי תפקיד.</p></div><span class="ar2-status ${submitted ? 'is-complete' : ''}">${escapeHtml(status)}</span></div>
    ${visible ? `<form data-ar2-form="manager" data-version="${escapeHtml(String(bundle.manager?.version || ''))}">
      <div class="ar2-question-list">${MANAGER_QUESTIONS.map((question) => managerQuestionHtml(question, bundle.manager?.answers?.[question[0]], editable)).join('')}</div>
      <div class="ar2-save" aria-live="polite"></div>
    </form>
    <div style="margin-top:16px"><h3>מדדים מקצועיים לפי תפקיד</h3><p class="ar2-muted">1 – נדרש שיפור משמעותי · 2 – נדרש שיפור · 3 – עומד בציפיות · 4 – מעל הציפיות · 5 – מצטיין/ת</p>${roleMetricsHtml(bundle.metrics, editable)}</div>` : `<div class="ar2-private">${submitted ? 'המנהל אישר את חלקו. התוכן ייחשף לאחר אישור חלק העובד.' : 'החלק פתוח למנהל בלבד ואינו מוצג לעובד בשלב זה.'}</div>`}
    ${editable ? '<div class="ar2-actions ar2-no-print"><button type="button" class="ar2-btn ar2-btn--primary" data-ar2-operation="submit_manager_section">אישור חלק המנהל</button></div>' : ''}
  </section>`;
}

function conversationHtml(review, isManager) {
  const available = ['ready_for_conversation', 'conversation_in_progress', 'manager_preparation', 'awaiting_employee_response', 'completed_locked'].includes(review.status);
  if (!available) return `<section class="ar2-card"><div class="ar2-card__head"><div><h2>שיחת המשוב</h2><p class="ar2-muted">תיפתח לאחר אישור שני החלקים האישיים.</p></div><span class="ar2-status">טרם נפתח</span></div><div class="ar2-private">התשובות של שני הצדדים ייחשפו יחד לפני השיחה.</div></section>`;
  const inConversation = review.status === 'conversation_in_progress';
  const ready = review.status === 'ready_for_conversation';
  const completed = Boolean(review.conversation_completed_at) || ['manager_preparation', 'awaiting_employee_response', 'completed_locked'].includes(review.status);
  return `<section class="ar2-card" id="ar2-conversation">
    <div class="ar2-card__head"><div><h2>שיחת המשוב</h2><p class="ar2-muted">מסך משותף לצפייה בלבד. לא נשמר בו תוכן.</p></div><span class="ar2-status ${completed ? 'is-complete' : ''}">${completed ? 'התקיימה' : inConversation ? 'בתהליך' : 'מוכנה'}</span></div>
    ${completed ? `<p class="ar2-muted">שיחת המשוב התקיימה${review.conversation_completed_at ? ` ביום ${escapeHtml(formatDate(review.conversation_completed_at))}` : ''}.</p>` : `<ol class="ar2-guide">${CONVERSATION_GUIDE.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`}
    ${ready && isManager ? '<div class="ar2-actions ar2-no-print"><button type="button" class="ar2-btn ar2-btn--primary" data-ar2-operation="start_review_conversation">התחלת שיחת המשוב</button></div>' : ''}
    ${inConversation && isManager ? '<div class="ar2-actions ar2-no-print"><button type="button" class="ar2-btn ar2-btn--primary" data-ar2-operation="finish_review_conversation">סיום השיחה ומעבר לסיכום המנהל</button></div>' : ''}
  </section>`;
}

function summaryHtml(review, bundle, isManager, isEmployee) {
  const submitted = Boolean(review.manager_summary_submitted_at);
  const editable = isManager && review.status === 'manager_preparation' && !submitted && !review.locked_at;
  const visible = isManager || submitted;
  const stageReached = ['manager_preparation', 'awaiting_employee_response', 'completed_locked'].includes(review.status);
  if (!stageReached) return `<section class="ar2-card"><div class="ar2-card__head"><div><h2>סיכום המנהל</h2><p class="ar2-muted">ייפתח למנהל לאחר סיום שיחת המשוב.</p></div><span class="ar2-status">טרם נפתח</span></div></section>`;
  return `<section class="ar2-card" id="ar2-manager-summary">
    <div class="ar2-card__head"><div><h2>סיכום המנהל</h2><p class="ar2-muted">פרטי למנהל בזמן הכתיבה. נחשף לעובד רק לאחר ההעברה.</p></div><span class="ar2-status ${submitted ? 'is-complete' : ''}">${submitted ? 'הועבר לעובד' : editable ? 'למילוי' : 'פרטי למנהל'}</span></div>
    ${visible ? `<form data-ar2-form="summary" data-version="${escapeHtml(String(bundle.summary?.version || ''))}" class="ar2-summary-grid">
      ${SUMMARY_FIELDS.map(([key, title, prompt]) => questionTextarea(key, title, prompt, bundle.summary?.[key], editable)).join('')}
      <div class="ar2-save" aria-live="polite"></div>
    </form>` : '<div class="ar2-private">המנהל כותב את הסיכום. הוא יוצג לעובד לאחר העברתו.</div>'}
    ${editable ? '<div class="ar2-actions ar2-no-print"><button type="button" class="ar2-btn ar2-btn--primary" data-ar2-operation="submit_manager_summary">העברה לעובד</button></div>' : ''}
  </section>`;
}

function responseHtml(review, bundle, isManager, isEmployee) {
  const signed = Boolean(review.employee_signed_at);
  const editable = isEmployee && review.status === 'awaiting_employee_response' && !signed && !review.locked_at;
  const visible = isEmployee || signed;
  const stageReached = ['awaiting_employee_response', 'completed_locked'].includes(review.status);
  if (!stageReached) return `<section class="ar2-card"><div class="ar2-card__head"><div><h2>תגובת העובד</h2><p class="ar2-muted">תיפתח לאחר העברת סיכום המנהל.</p></div><span class="ar2-status">טרם נפתח</span></div></section>`;
  const response = bundle.response || {};
  return `<section class="ar2-card" id="ar2-employee-response">
    <div class="ar2-card__head"><div><h2>תגובת העובד</h2><p class="ar2-muted">האישור מעיד על קריאה וקבלה ואינו מחייב הסכמה עם כל תוכן המשוב.</p></div><span class="ar2-status ${signed ? 'is-complete' : ''}">${signed ? 'אושר וננעל' : editable ? 'למילוי' : 'ממתין לעובד'}</span></div>
    ${visible ? `<form data-ar2-form="response" data-version="${escapeHtml(String(response.version || ''))}" class="ar2-summary-grid">
      <label class="ar2-field"><span>האם סיכום המנהל משקף את עיקרי שיחת המשוב?</span>
        <select class="ar2-select" name="summary_alignment" ${editable ? '' : 'disabled'}>
          <option value="">בחירה</option>
          <option value="yes" ${response.summary_alignment === 'yes' ? 'selected' : ''}>כן</option>
          <option value="partial" ${response.summary_alignment === 'partial' ? 'selected' : ''}>באופן חלקי</option>
          <option value="no" ${response.summary_alignment === 'no' ? 'selected' : ''}>לא</option>
        </select>
      </label>
      <label class="ar2-field" data-alignment-explanation ${['partial', 'no'].includes(response.summary_alignment) ? '' : 'hidden'}>
        <span>הסבר</span>
        <textarea class="ar2-textarea" name="alignment_explanation" rows="3" ${editable ? '' : 'readonly'}>${escapeHtml(response.alignment_explanation || '')}</textarea>
      </label>
      ${questionTextarea('clarification_points', 'הבהרות או הסתייגויות', 'האם יש נקודה שברצונך להבהיר, לתקן או להוסיף בעקבות סיכום המנהל?', response.clarification_points, editable)}
      ${questionTextarea('final_comment', 'הערה מסכמת', 'האם יש לך הערה מסכמת שחשוב לתעד במסגרת המשוב?', response.final_comment, editable)}
      <label class="ar2-field"><span>שם מלא</span><input class="ar2-input" name="signature_name" value="${escapeHtml(response.signature_name || review.employee_name || '')}" ${editable ? '' : 'readonly'}></label>
      <label class="ar2-check"><input type="checkbox" name="acceptance_confirmed" ${response.acceptance_confirmed ? 'checked' : ''} ${editable ? '' : 'disabled'}><span>קראתי את המשוב ואת סיכום המנהל ואני מאשר/ת את קבלתם. ידוע לי כי האישור מעיד על קבלת המשוב וקריאתו ואינו מחייב הסכמה עם כל תוכנו.</span></label>
      <div class="ar2-save" aria-live="polite"></div>
    </form>` : '<div class="ar2-private">המשוב ממתין לתגובת העובד ולאישורו הסופי.</div>'}
    ${editable ? '<div class="ar2-actions ar2-no-print"><button type="button" class="ar2-btn ar2-btn--primary" data-ar2-operation="complete_review_as_employee">אישור וסיום המשוב</button></div>' : ''}
  </section>`;
}

function detailHtml(review, bundle) {
  const isManager = review.manager_id === state.userId;
  const isEmployee = review.employee_id === state.userId;
  const printButton = isManager && review.status === 'completed_locked'
    ? '<button type="button" class="ar2-btn ar2-btn--primary" data-ar2-print>הדפסת המשוב המלא</button>'
    : '';
  const employeeApproved = review.employee_section_submitted_at ? 'אושר' : 'טרם אושר';
  const managerApproved = review.manager_section_submitted_at ? 'אושר' : 'טרם אושר';
  return `<div class="ar2-screen">
    <div class="ar2-topbar ar2-no-print">
      <button type="button" class="ar2-btn ar2-btn--ghost" data-ar2-back>← חזרה למשובים</button>
      <span class="ar2-topbar__title">משוב שנתי</span>
      <span class="ar2-topbar__spacer"></span>
      ${printButton}
    </div>
    <main class="ar2-body">
      <header class="ar2-card">
        <div class="ar2-card__head">
          <div><h1 style="font-size:1.45rem">משוב שנתי</h1><p class="ar2-muted">${escapeHtml(review.employee_name || '')} · ${escapeHtml(String(review.review_year || ''))}<br>מנהל: ${escapeHtml(review.manager_name || 'לא זמין')}${review.employee_role ? `<br>תפקיד: ${escapeHtml(review.employee_role)}` : ''}</p></div>
          <span class="ar2-status ${statusClass(review)}">${escapeHtml(STATUS_LABELS[review.status] || review.status)}</span>
        </div>
        ${progressHtml(review)}
        ${review.status === 'employee_preparation' ? `<p class="ar2-muted ar2-no-print" style="margin:12px 0 0">חלק העובד: ${employeeApproved} · חלק המנהל: ${managerApproved}. התשובות ייחשפו רק לאחר אישור שני הצדדים.</p>` : ''}
        ${review.status === 'not_opened' && isManager ? '<div class="ar2-actions ar2-no-print"><button type="button" class="ar2-btn ar2-btn--primary" data-ar2-operation="open_review_for_employee">פתיחת המשוב</button></div>' : ''}
        ${review.status === 'not_opened' && isEmployee ? '<div class="ar2-private ar2-no-print" style="margin-top:12px">המנהל טרם פתח את המשוב.</div>' : ''}
      </header>
      ${employeeSectionHtml(review, bundle, isManager, isEmployee)}
      ${managerSectionHtml(review, bundle, isManager, isEmployee)}
      ${conversationHtml(review, isManager)}
      ${summaryHtml(review, bundle, isManager, isEmployee)}
      ${responseHtml(review, bundle, isManager, isEmployee)}
      <footer class="ar2-card ar2-signatures">
        <span>שם העובד/ת: ${escapeHtml(review.employee_name || '')}</span>
        <span>שם המנהל: ${escapeHtml(review.manager_name || '')}</span>
        <span>סיום המשוב: ${escapeHtml(formatDate(review.completed_at))}</span>
      </footer>
    </main>
  </div>`;
}

async function openReview(id) {
  const root = rootElement();
  if (!root) return;
  state.rendering = true;
  try {
    await loadReviews();
    const review = state.reviews.find((row) => row.id === id);
    if (!review) throw new Error('המשוב לא נמצא או שאין הרשאה לצפות בו.');
    const bundle = await loadBundle(review);
    state.currentReview = review;
    state.currentBundle = bundle;
    root.innerHTML = detailHtml(review, bundle);
    bindDetail(root);
  } catch (error) {
    console.error('[annual-reviews-v2] open failed', error);
    showToast(error.message || 'פתיחת המשוב נכשלה.', 'error');
  } finally {
    state.rendering = false;
  }
}

function setSaveState(form, message, kind = '') {
  const node = form?.querySelector('.ar2-save');
  if (!node) return;
  node.textContent = message;
  node.dataset.state = kind;
}

async function versionedUpsert(table, values, form) {
  const reviewId = state.currentReview.id;
  const version = Number(form.dataset.version || 0);
  if (version) {
    const { data, error } = await supabase
      .from(table)
      .update(values)
      .eq('review_id', reviewId)
      .eq('version', version)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('המידע השתנה במקום אחר. יש לרענן את המשוב.');
    form.dataset.version = String(data.version || '');
    return data;
  }
  const { data, error } = await supabase
    .from(table)
    .insert({ review_id: reviewId, ...values })
    .select()
    .single();
  if (error) throw error;
  form.dataset.version = String(data.version || '');
  return data;
}

function employeeAnswers(form) {
  return Object.fromEntries(EMPLOYEE_QUESTIONS.map(([key]) => [key, form.elements[key]?.value || '']));
}

function managerAnswers(form) {
  return Object.fromEntries(MANAGER_QUESTIONS.map(([key]) => {
    const question = form.querySelector(`[data-question-key="${CSS.escape(key)}"]`);
    const selected = question?.querySelector('[data-ar2-answer-rating].is-selected');
    const value = selected?.dataset.value || '';
    return [key, {
      text: form.elements[key]?.value || '',
      rating: value && value !== 'na' ? Number(value) : null,
      not_applicable: value === 'na'
    }];
  }));
}

function summaryValues(form) {
  return Object.fromEntries(SUMMARY_FIELDS.map(([key]) => [key, form.elements[key]?.value || '']));
}

function responseValues(form) {
  return {
    summary_alignment: form.elements.summary_alignment?.value || '',
    alignment_explanation: form.elements.alignment_explanation?.value || '',
    clarification_points: form.elements.clarification_points?.value || '',
    final_comment: form.elements.final_comment?.value || '',
    signature_name: form.elements.signature_name?.value || '',
    acceptance_confirmed: Boolean(form.elements.acceptance_confirmed?.checked)
  };
}

async function saveFormNow(form) {
  if (!form) return;
  const timer = state.saveTimers.get(form);
  if (timer) clearTimeout(timer);
  state.saveTimers.delete(form);
  const type = form.dataset.ar2Form;
  const table = {
    employee: 'employee_review_preparation',
    manager: 'manager_review_preparation',
    summary: 'manager_review_summary',
    response: 'employee_review_response'
  }[type];
  if (!table) return;
  const values = type === 'employee' ? { answers: employeeAnswers(form), include_in_pdf: true }
    : type === 'manager' ? { answers: managerAnswers(form) }
      : type === 'summary' ? summaryValues(form)
        : responseValues(form);
  setSaveState(form, 'שומר…', 'saving');
  const promise = versionedUpsert(table, values, form);
  state.pendingSaves.add(promise);
  try {
    const data = await promise;
    if (type === 'employee') state.currentBundle.employee = data;
    if (type === 'manager') state.currentBundle.manager = data;
    if (type === 'summary') state.currentBundle.summary = data;
    if (type === 'response') state.currentBundle.response = data;
    setSaveState(form, 'נשמר', 'saved');
  } catch (error) {
    setSaveState(form, error.message || 'השמירה נכשלה', 'error');
    throw error;
  } finally {
    state.pendingSaves.delete(promise);
  }
}

function scheduleSave(form) {
  const existing = state.saveTimers.get(form);
  if (existing) clearTimeout(existing);
  setSaveState(form, 'ממתין לשמירה…');
  const timer = setTimeout(() => {
    saveFormNow(form).catch((error) => showToast(error.message || 'השמירה נכשלה.', 'error'));
  }, 650);
  state.saveTimers.set(form, timer);
}

async function flushEditableForms(root) {
  const forms = [...root.querySelectorAll('[data-ar2-form]')].filter((form) =>
    form.querySelector('textarea:not([readonly]),input:not([readonly]):not([disabled]),select:not([disabled])')
  );
  for (const form of forms) await saveFormNow(form);
  if (state.pendingSaves.size) await Promise.all([...state.pendingSaves]);
}

async function saveMetric(metricNode, changes) {
  const id = metricNode.dataset.metricId;
  const version = Number(metricNode.dataset.version || 0);
  const saveState = metricNode.querySelector('.ar2-save');
  if (saveState) {
    saveState.textContent = 'שומר…';
    saveState.dataset.state = 'saving';
  }
  let query = supabase.from('manager_review_evaluations').update(changes).eq('id', id);
  if (version) query = query.eq('version', version);
  const promise = query.select().maybeSingle();
  state.pendingSaves.add(promise);
  try {
    const { data, error } = await promise;
    if (error) throw error;
    if (!data) throw new Error('המדד השתנה במקום אחר. יש לרענן את המשוב.');
    metricNode.dataset.version = String(data.version || '');
    Object.assign(state.currentBundle.metrics.find((metric) => metric.id === id) || {}, data);
    if (saveState) {
      saveState.textContent = 'נשמר';
      saveState.dataset.state = 'saved';
    }
  } finally {
    state.pendingSaves.delete(promise);
  }
}

const RPC_CONFIRMATIONS = {
  open_review_for_employee: ['לפתוח את המשוב למילוי העובד והמנהל?', 'פתיחת המשוב'],
  submit_employee_section: ['לאחר האישור לא ניתן יהיה לערוך את חלק העובד. התוכן ייחשף רק לאחר אישור חלק המנהל. להמשיך?', 'אישור חלק העובד'],
  submit_manager_section: ['לאחר האישור לא ניתן יהיה לערוך את חלק המנהל. התוכן ייחשף רק לאחר אישור חלק העובד. להמשיך?', 'אישור חלק המנהל'],
  start_review_conversation: ['להתחיל את שיחת המשוב? המסך יהיה משותף לצפייה בלבד.', 'התחלת שיחת המשוב'],
  finish_review_conversation: ['לסיים את השיחה ולעבור לכתיבת סיכום המנהל?', 'סיום שיחת המשוב'],
  submit_manager_summary: ['לאחר ההעברה הסיכום יינעל ויוצג לעובד. להמשיך?', 'העברת סיכום המנהל'],
  complete_review_as_employee: ['האישור ינעל את המשוב ויסיים את התהליך. להמשיך?', 'אישור וסיום המשוב']
};

function friendlyError(error) {
  const message = String(error?.message || error || '');
  const mappings = [
    ['annual_review_employee_section_empty', 'יש למלא לפחות תשובה אחת בחלק העובד.'],
    ['annual_review_manager_section_empty', 'יש למלא לפחות תשובה אחת בחלק המנהל.'],
    ['annual_review_manager_summary_empty', 'יש למלא את סיכום המנהל לפני ההעברה לעובד.'],
    ['annual_review_employee_signature_required', 'יש לבחור התייחסות לסיכום, להזין שם מלא ולאשר את קבלת המשוב.'],
    ['annual_review_version_conflict', 'המשוב השתנה במקום אחר. יש לרענן ולנסות שוב.'],
    ['annual_review_invalid_state', 'הפעולה אינה זמינה בשלב הנוכחי.']
  ];
  return mappings.find(([key]) => message.includes(key))?.[1] || message || 'הפעולה נכשלה.';
}

async function runOperation(root, operation, button) {
  const [confirmation] = RPC_CONFIRMATIONS[operation] || [];
  if (confirmation && !window.confirm(confirmation)) return;
  button.disabled = true;
  try {
    if (operation !== 'open_review_for_employee' && !operation.includes('conversation')) {
      await flushEditableForms(root);
    }
    const { data, error } = await supabase.rpc(operation, {
      p_review_id: state.currentReview.id,
      p_expected_version: state.currentReview.version
    });
    if (error) throw error;
    Object.assign(state.currentReview, data);
    await openReview(state.currentReview.id);
    showToast(RPC_CONFIRMATIONS[operation]?.[1] || 'הפעולה הושלמה.');
  } catch (error) {
    button.disabled = false;
    showToast(friendlyError(error), 'error');
  }
}

function bindDetail(root) {
  root.querySelector('[data-ar2-back]')?.addEventListener('click', renderStandaloneLanding);
  root.querySelector('[data-ar2-print]')?.addEventListener('click', () => {
    document.body.classList.add('ar2-printing');
    const cleanup = () => document.body.classList.remove('ar2-printing');
    window.addEventListener('afterprint', cleanup, { once: true });
    try {
      window.print();
    } catch (error) {
      cleanup();
      showToast('הדפסת המשוב נכשלה.', 'error');
    }
  });

  root.querySelectorAll('[data-ar2-form]').forEach((form) => {
    form.addEventListener('input', () => scheduleSave(form));
    form.addEventListener('change', (event) => {
      if (event.target.name === 'summary_alignment') {
        const explanation = form.querySelector('[data-alignment-explanation]');
        if (explanation) explanation.hidden = !['partial', 'no'].includes(event.target.value);
      }
      scheduleSave(form);
    });
  });

  root.querySelectorAll('[data-ar2-answer-rating]').forEach((button) => {
    button.addEventListener('click', () => {
      const question = button.closest('[data-question-key]');
      question?.querySelectorAll('[data-ar2-answer-rating]').forEach((item) => item.classList.remove('is-selected'));
      button.classList.add('is-selected');
      const form = button.closest('[data-ar2-form]');
      if (form) scheduleSave(form);
    });
  });

  root.querySelectorAll('[data-ar2-role-rating]').forEach((button) => {
    button.addEventListener('click', async () => {
      const metric = button.closest('[data-metric-id]');
      if (!metric) return;
      metric.querySelectorAll('[data-ar2-role-rating]').forEach((item) => item.classList.remove('is-selected'));
      button.classList.add('is-selected');
      const value = button.dataset.value;
      try {
        await saveMetric(metric, {
          rating: value === 'na' ? null : Number(value),
          not_applicable: value === 'na'
        });
      } catch (error) {
        showToast(friendlyError(error), 'error');
      }
    });
  });

  root.querySelectorAll('[data-ar2-metric-comment]').forEach((field) => {
    field.addEventListener('change', async () => {
      const metric = field.closest('[data-metric-id]');
      if (!metric) return;
      try {
        await saveMetric(metric, { comment: field.value });
      } catch (error) {
        showToast(friendlyError(error), 'error');
      }
    });
  });

  root.querySelectorAll('[data-ar2-operation]').forEach((button) => {
    button.addEventListener('click', () => runOperation(root, button.dataset.ar2Operation, button));
  });
}

function bindGlobalClicks() {
  document.addEventListener('click', (event) => {
    const open = event.target.closest('[data-ar2-open]');
    if (open) {
      event.preventDefault();
      event.stopPropagation();
      openReview(open.dataset.ar2Open);
      return;
    }
    if (event.target.closest('[data-ar2-dashboard]')) {
      event.preventDefault();
      document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'dashboard' } }));
    }
  }, true);
}

let enhanceQueued = false;
function scheduleEnhance() {
  if (enhanceQueued) return;
  enhanceQueued = true;
  queueMicrotask(() => {
    enhanceQueued = false;
    enhanceExistingLanding();
  });
}

installStyles();
bindGlobalClicks();
new MutationObserver(scheduleEnhance).observe(document.documentElement, { childList: true, subtree: true });
scheduleEnhance();

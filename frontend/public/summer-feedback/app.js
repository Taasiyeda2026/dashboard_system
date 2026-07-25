import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.3/+esm';

const supabase = createClient(
  'https://szinlhjuwyiyszdpsdop.supabase.co',
  'sb_publishable_k0IbDJlgPA9KTVuDWrCyFw_Zsa5kZIM',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

const CYCLE_KEY = 'summer_2026';
const DASHBOARD_URL = '../';
const GENERAL = [
  ['preparation_info', 'המידע שקיבלתי לפני הפעילות היה ברור ומספק'],
  ['professional_training', 'ההדרכה המקצועית אפשרה לי להגיע מוכן/ה'],
  ['equipment_distribution', 'חלוקת הציוד והערכות הייתה מסודרת'],
  ['schedule_clarity', 'השיבוצים, הכתובות ולוחות הזמנים היו ברורים'],
  ['support_response', 'קיבלתי מענה מקצועי ותפעולי בעת הצורך'],
  ['workload', 'היקף הפעילות והעומס היו סבירים'],
  ['overall_organization', 'פעילות הקיץ הייתה מאורגנת ומוצלחת']
];
const METRICS = [
  ['age_fit', 'התאמה לגיל'],
  ['time_fit', 'התאמה לזמן'],
  ['equipment_quality', 'ציוד וחומרים'],
  ['student_success', 'הצלחה בקרב הילדים']
];
const IMPROVEMENTS = ['הזמן לא הספיק','הפעילות הייתה קצרה מדי','אי־התאמה לגיל','הוראות לא ברורות','בנייה מורכבת','נדרשה עזרה רבה','ציוד חסר','חלקים לא תקינים','תוצר לא מוצלח','עניין נמוך'];
const SUCCESSES = ['התלהבות הילדים','תוצר מוצלח','תוכן מעניין','התאמה לגיל','הוראות ברורות','ציוד נוח','התאמה לזמן','שילוב למידה והנאה'];

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const state = {
  user: null, cycle: null, assignments: [], responses: [], ratings: [], response: null,
  mode: 'instructor', submitted: false, saveTimer: null, savePromise: null,
  revision: 0, savedRevision: 0, adminTab: 'status', canAdmin: false, hasOwnFeedback: false,
  previewMode: false, adminAssignments: [], adminResponses: [], adminRatings: []
};

const esc = (value = '') => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const statusText = status => ({ draft:'טיוטה', submitted:'הוגש', reopened:'נפתח מחדש' }[status] || 'טרם התחיל');
const fmtDate = value => value ? new Intl.DateTimeFormat('he-IL',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : '—';
const mean = values => {
  const nums = values
    .filter(value => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(value => Number.isFinite(value) && value >= 1 && value <= 5);
  return nums.length ? nums.reduce((a,b)=>a+b,0)/nums.length : null;
};
const cycleIsOpen = cycle => {
  const now = Date.now();
  const opensAt = cycle?.opens_at ? new Date(cycle.opens_at).getTime() : null;
  const closesAt = cycle?.closes_at ? new Date(cycle.closes_at).getTime() : null;
  return cycle?.status === 'open' && (!opensAt || opensAt <= now) && (!closesAt || closesAt >= now);
};

function notify(message, error = false) {
  toast.textContent = message;
  toast.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.className = 'toast'; }, 3000);
}

function frame(content, label = '') {
  const modeLink = state.previewMode
    ? '<a class="button" href="./?view=admin">חזרה לניהול</a>'
    : state.canAdmin
      ? (state.mode === 'admin'
          ? (state.hasOwnFeedback && cycleIsOpen(state.cycle) ? '<a class="button" href="./">המשוב שלי</a>' : '')
          : '<a class="button" href="./?view=admin">ניהול משובים</a>')
      : '';
  return `<div class="shell"><header><div class="brand"><span>ת</span><div><strong>תעשיידע</strong><small>משוב פעילות הקיץ</small></div></div><div class="head-actions">${label ? `<small>${esc(label)}</small>` : ''}${modeLink}<a class="button" href="${DASHBOARD_URL}">חזרה לדשבורד</a></div></header>${content}</div>`;
}

function renderMessage(title, text) {
  app.innerHTML = frame(`<main class="center"><section class="panel"><h1>${esc(title)}</h1><p>${esc(text)}</p><a class="button primary" href="${DASHBOARD_URL}">חזרה לדשבורד</a></section></main>`);
}

async function init() {
  try {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth?.user) return renderMessage('נדרשת התחברות','יש להיכנס תחילה לדשבורד באמצעות המשתמש האישי.');
    state.user = auth.user;

    const { data: cycle, error: cycleError } = await supabase.from('summer_feedback_cycles').select('*').eq('cycle_key',CYCLE_KEY).maybeSingle();
    if (cycleError) throw cycleError;
    if (!cycle) return renderMessage('המשוב אינו זמין','המשוב עדיין אינו פתוח למילוי.');
    state.cycle = cycle;

    const [assignments, responses, ratings] = await Promise.all([
      supabase.from('summer_feedback_assignments').select('*').eq('cycle_id',cycle.id).order('instructor_name').order('activity_name'),
      supabase.from('summer_feedback_responses').select('*').eq('cycle_id',cycle.id).order('updated_at',{ascending:false}),
      supabase.from('summer_feedback_activity_ratings').select('*').eq('cycle_id',cycle.id)
    ]);
    for (const result of [assignments,responses,ratings]) if (result.error) throw result.error;
    state.assignments = assignments.data || [];
    state.responses = responses.data || [];
    state.ratings = ratings.data || [];
    state.adminAssignments = [...state.assignments];
    state.adminResponses = [...state.responses];
    state.adminRatings = [...state.ratings];

    const ownAssignments = state.assignments.filter(row => row.instructor_auth_user_id === state.user.id);
    state.hasOwnFeedback = ownAssignments.length > 0;
    state.canAdmin = state.assignments.some(row => row.instructor_auth_user_id !== state.user.id);
    const requestedAdmin = new URLSearchParams(window.location.search).get('view') === 'admin';
    const cycleOpen = cycleIsOpen(state.cycle);
    state.mode = state.canAdmin && (requestedAdmin || !state.hasOwnFeedback || !cycleOpen) ? 'admin' : 'instructor';
    if (state.mode === 'admin') return renderAdmin();
    if (!cycleOpen) {
      return renderMessage('המשוב עדיין אינו פתוח','לא ניתן למלא או לערוך את המשוב לפני האישור הסופי.');
    }

    state.assignments = ownAssignments;
    state.ratings = state.ratings.filter(row => row.instructor_auth_user_id === state.user.id);
    if (!state.assignments.length) return renderMessage('לא נמצאו פעילויות','לא משויכות למשתמש שלך פעילויות שנכללו במשוב.');
    await ensureResponse();
    renderInstructor();
  } catch (error) {
    console.error(error);
    renderMessage('לא ניתן לטעון את המשוב','אירעה שגיאה בטעינת הנתונים. יש לרענן את הדף או להיכנס מחדש.');
  }
}

async function ensureResponse() {
  let response = state.responses.find(row => row.instructor_auth_user_id === state.user.id);
  if (!response) {
    const result = await supabase.from('summer_feedback_responses').insert({ cycle_id:state.cycle.id, instructor_auth_user_id:state.user.id, status:'draft' }).select().single();
    if (result.error) throw result.error;
    response = result.data;
    state.responses.push(response);
  }
  state.response = response;
  state.submitted = response.status === 'submitted';
}

function ratingOptions(value) {
  return `<option value="">בחרו</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${Number(value)===n?'selected':''}>${n}</option>`).join('')}`;
}

function chips(values, selected, kind, assignmentId, locked) {
  return values.map(value=>`<label class="chip"><input type="checkbox" data-kind="${kind}" data-assignment="${assignmentId}" value="${esc(value)}" ${(selected||[]).includes(value)?'checked':''} ${locked?'disabled':''}><span>${esc(value)}</span></label>`).join('');
}

function ratingFor(id) { return state.ratings.find(row => row.assignment_id === id) || {}; }

function renderInstructor() {
  const preview = state.previewMode;
  const locked = state.submitted && !preview;
  const total = state.assignments.reduce((sum,row)=>sum+Number(row.activity_count||0),0);
  const name = state.assignments[0]?.instructor_name || state.user.email;
  const statusLine = preview
    ? '<span class="badge draft">תצוגה מקדימה</span><span id="saveStatus">הנתונים אינם נשמרים</span>'
    : `<span class="badge ${esc(state.response.status)}">${statusText(state.response.status)}</span><span id="saveStatus">${locked ? `הוגש ${fmtDate(state.response.submitted_at)}` : 'כל שינוי נשמר אוטומטית'}</span>`;
  const banner = preview
    ? '<div class="locked"><strong>תצוגה מקדימה לאדמין בלבד.</strong> ניתן להתנסות בשדות, אך דבר אינו נשמר או נשלח.</div>'
    : locked ? '<div class="locked"><strong>המשוב הוגש וננעל.</strong> מנהל מורשה יכול לפתוח אותו מחדש.</div>' : '';
  const submitBar = preview
    ? '<span>מצב תצוגה מקדימה — ללא שמירה וללא הגשה.</span><a class="button primary" href="./?view=admin">חזרה לניהול</a>'
    : locked
      ? '<span>המשוב הושלם.</span>'
      : '<button class="button secondary" type="button" id="saveNow">שמירת טיוטה</button><button class="button primary" type="submit">הגשת המשוב</button>';

  app.innerHTML = frame(`<main class="container">
    <section class="hero"><div><h1>משוב פעילות הקיץ</h1><p>שלום ${esc(name)}. המשוב מתייחס לפעילויות ולהיערכות, ולא להערכת עבודת המדריך.</p></div><div class="hero-count"><strong>${state.assignments.length}</strong><span>סוגי פעילויות · ${total} הפעלות</span></div></section>
    <div class="status">${statusLine}</div>
    ${banner}
    <div class="progress"><div><strong>התקדמות</strong><span id="progressText">0%</span></div><div class="track"><i id="progressBar"></i></div></div>
    <form id="feedbackForm">
      <section class="panel"><h2>1. היערכות והתנהלות</h2><p class="hint">1 – כלל לא · 5 – במידה רבה מאוד</p>
        <div class="general-grid">${GENERAL.map(([key,label])=>`<label class="question"><span>${esc(label)}</span><select name="general_${key}" ${locked?'disabled':''}>${ratingOptions(state.response.general_answers?.[key])}</select></label>`).join('')}</div>
      </section>
      <section class="panel"><h2>2. דירוג הפעילויות</h2><p class="hint">מוצגות רק הפעילויות שהעברת ומספר ההפעלות שלהן.</p>
        <div class="activity-list">${state.assignments.map(a=>activityCard(a,locked)).join('')}</div>
      </section>
      <section class="panel"><h2>3. סיכום</h2>
        <label class="text-question"><span>מה חשוב לשמר מהפעילויות ומההיערכות?</span><textarea data-summary="preserve" ${locked?'disabled':''}>${esc(state.response.summary_answers?.preserve||'')}</textarea></label>
        <label class="text-question"><span>מה חשוב לשנות או לשפר?</span><textarea data-summary="improve" ${locked?'disabled':''}>${esc(state.response.summary_answers?.improve||'')}</textarea></label>
        <label class="text-question"><span>איזו הכשרה או הכנה נוספת הייתה מסייעת לך?</span><textarea data-summary="training_needed" ${locked?'disabled':''}>${esc(state.response.summary_answers?.training_needed||'')}</textarea></label>
        <label class="text-question"><span>הערות נוספות</span><textarea data-summary="additional_notes" ${locked?'disabled':''}>${esc(state.response.summary_answers?.additional_notes||'')}</textarea></label>
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
    document.querySelector('#saveNow')?.addEventListener('click', async()=>{ markDirty(); await saveDraft(false); });
  }
  updateProgress();
}

function activityCard(a, locked) {
  const r = ratingFor(a.id);
  const grades = (a.grade_labels||[]).join(', ');
  return `<details class="activity" open><summary><span><strong>${esc(a.activity_name)}</strong><small>${a.activity_count} הפעלות${grades?` · ${esc(grades)}`:''}</small></span><b data-complete="${a.id}">0/4</b></summary>
    <div class="activity-body"><div class="metric-grid">${METRICS.map(([key,label])=>`<label><span>${esc(label)}</span><select data-rating="${key}" data-assignment="${a.id}" ${locked?'disabled':''}>${ratingOptions(r[key])}</select></label>`).join('')}</div>
      <div class="highlights"><label><input type="checkbox" data-highlight="success" data-assignment="${a.id}" ${r.success_highlight?'checked':''} ${locked?'disabled':''}> פעילות מוצלחת במיוחד</label><label><input type="checkbox" data-highlight="improvement" data-assignment="${a.id}" ${r.needs_improvement?'checked':''} ${locked?'disabled':''}> פעילות שדורשת שיפור</label></div>
      <div class="detail-box ${r.success_highlight?'':'hidden'}" data-box="success-${a.id}"><strong>מה תרם להצלחה?</strong><div class="chips">${chips(SUCCESSES,r.success_reasons,'success',a.id,locked)}</div><textarea data-note="success" data-assignment="${a.id}" placeholder="הערה קצרה" ${locked?'disabled':''}>${esc(r.success_note||'')}</textarea></div>
      <div class="detail-box ${r.needs_improvement?'':'hidden'}" data-box="improvement-${a.id}"><strong>מה דרוש שיפור?</strong><div class="chips">${chips(IMPROVEMENTS,r.improvement_categories,'improvement',a.id,locked)}</div><textarea data-note="improvement" data-assignment="${a.id}" placeholder="מה כדאי לשנות בפועל?" ${locked?'disabled':''}>${esc(r.improvement_note||'')}</textarea></div>
    </div></details>`;
}

function onEdit(event) {
  if (state.submitted && !state.previewMode) return;
  const target = event.target;
  if (target.dataset.highlight) {
    const kind = target.dataset.highlight;
    const checked = document.querySelectorAll(`[data-highlight="${kind}"]:checked`);
    if (checked.length > 3) { target.checked=false; notify('ניתן לבחור עד שלוש פעילויות בכל קטגוריה.',true); return; }
    document.querySelector(`[data-box="${kind}-${target.dataset.assignment}"]`)?.classList.toggle('hidden',!target.checked);
  }
  updateProgress();
  if (state.previewMode) return;
  markDirty();
  queueSave();
}

function markDirty() { state.revision += 1; }
function queueSave() {
  clearTimeout(state.saveTimer);
  const label = document.querySelector('#saveStatus');
  if (label) label.textContent='ממתין לשמירה…';
  state.saveTimer=setTimeout(()=>saveDraft(true).catch(()=>{}),700);
}

function collectSnapshot() {
  const general_answers = Object.fromEntries(GENERAL.map(([key])=>[key,Number(document.querySelector(`[name="general_${key}"]`)?.value)||null]));
  const summary_answers = {};
  document.querySelectorAll('[data-summary]').forEach(el=>{summary_answers[el.dataset.summary]=el.value.trim();});
  const ratings = state.assignments.map(a=>{
    const value = key => Number(document.querySelector(`[data-rating="${key}"][data-assignment="${a.id}"]`)?.value)||null;
    const checked = kind => [...document.querySelectorAll(`[data-kind="${kind}"][data-assignment="${a.id}"]:checked`)].map(el=>el.value);
    return {
      response_id:state.response.id, assignment_id:a.id, cycle_id:state.cycle.id,
      instructor_auth_user_id:state.previewMode ? a.instructor_auth_user_id : state.user.id,
      age_fit:value('age_fit'), time_fit:value('time_fit'), equipment_quality:value('equipment_quality'), student_success:value('student_success'),
      success_highlight:Boolean(document.querySelector(`[data-highlight="success"][data-assignment="${a.id}"]`)?.checked),
      needs_improvement:Boolean(document.querySelector(`[data-highlight="improvement"][data-assignment="${a.id}"]`)?.checked),
      success_reasons:checked('success'), improvement_categories:checked('improvement'),
      success_note:document.querySelector(`[data-note="success"][data-assignment="${a.id}"]`)?.value.trim()||'',
      improvement_note:document.querySelector(`[data-note="improvement"][data-assignment="${a.id}"]`)?.value.trim()||'', additional_note:''
    };
  });
  return { general_answers, summary_answers, ratings };
}

async function saveDraft(silent=true) {
  if (state.previewMode) return true;
  if (state.submitted) return true;
  if (state.savePromise) {
    const previous = await state.savePromise;
    if (!previous) return false;
    return state.savedRevision < state.revision ? saveDraft(silent) : true;
  }
  const version = state.revision;
  const snapshot = collectSnapshot();
  const label = document.querySelector('#saveStatus');
  if (label) label.textContent='שומר…';
  state.savePromise=(async()=>{
    try {
      const responseStatus = state.response.status === 'reopened' ? 'reopened' : 'draft';
      const responseResult = await supabase.from('summer_feedback_responses').update({general_answers:snapshot.general_answers,summary_answers:snapshot.summary_answers,status:responseStatus}).eq('id',state.response.id).select().single();
      if (responseResult.error) throw responseResult.error;
      const ratingsResult = await supabase.from('summer_feedback_activity_ratings').upsert(snapshot.ratings,{onConflict:'response_id,assignment_id'}).select();
      if (ratingsResult.error) throw ratingsResult.error;
      state.response=responseResult.data; state.ratings=ratingsResult.data||snapshot.ratings; state.savedRevision=Math.max(state.savedRevision,version);
      if (label && state.savedRevision>=state.revision) label.textContent=`נשמר ${new Intl.DateTimeFormat('he-IL',{timeStyle:'short'}).format(new Date())}`;
      if (!silent) notify('הטיוטה נשמרה.');
      return true;
    } catch(error) {
      console.error(error); if(label) label.textContent='השמירה נכשלה'; notify('שמירת הטיוטה נכשלה.',true); return false;
    } finally { state.savePromise=null; }
  })();
  const saved=await state.savePromise;
  return saved && state.savedRevision<state.revision && !state.submitted ? saveDraft(true) : saved;
}

function validate() {
  const snapshot=collectSnapshot(); const missing=[];
  GENERAL.forEach(([key,label])=>{if(!snapshot.general_answers[key]) missing.push(label);});
  state.assignments.forEach((a,index)=>{
    const rating=snapshot.ratings[index];
    METRICS.forEach(([key,label])=>{if(!rating[key]) missing.push(`${a.activity_name} – ${label}`);});
    if(rating.success_highlight && !rating.success_reasons.length && !rating.success_note) missing.push(`${a.activity_name} – פירוט לפעילות מוצלחת`);
    if(rating.needs_improvement && !rating.improvement_categories.length && !rating.improvement_note) missing.push(`${a.activity_name} – פירוט לפעילות שדורשת שיפור`);
  });
  if(!snapshot.summary_answers.preserve) missing.push('מה חשוב לשמר');
  if(!snapshot.summary_answers.improve) missing.push('מה חשוב לשפר');
  return missing;
}

async function submitFeedback(event) {
  event.preventDefault();
  if (state.previewMode) return;
  const missing=validate();
  if(missing.length) return notify(`נותרו ${missing.length} שדות חובה למילוי.`,true);
  if(!confirm('להגיש את המשוב? לאחר ההגשה התשובות יינעלו.')) return;
  const button=event.submitter; if(button){button.disabled=true;button.textContent='מגיש…';}
  try {
    clearTimeout(state.saveTimer); markDirty();
    if(!await saveDraft(true)) throw new Error('draft save failed');
    const result=await supabase.from('summer_feedback_responses').update({status:'submitted'}).eq('id',state.response.id).select().single();
    if(result.error) throw result.error;
    state.response=result.data; state.submitted=true; notify('המשוב הוגש בהצלחה.'); renderInstructor(); window.scrollTo({top:0,behavior:'smooth'});
  } catch(error) { console.error(error); notify('הגשת המשוב נכשלה.',true); if(button){button.disabled=false;button.textContent='הגשת המשוב';} }
}

function updateProgress() {
  const snapshot=collectSnapshot();
  const complete=Object.values(snapshot.general_answers).filter(Boolean).length + snapshot.ratings.reduce((sum,r)=>sum+METRICS.filter(([key])=>r[key]).length,0) + ['preserve','improve'].filter(key=>snapshot.summary_answers[key]).length;
  const total=GENERAL.length+state.assignments.length*METRICS.length+2;
  const percent=Math.round(complete/total*100);
  const text=document.querySelector('#progressText'); const bar=document.querySelector('#progressBar');
  if(text) text.textContent=`${percent}%`; if(bar) bar.style.width=`${percent}%`;
  state.assignments.forEach((a,index)=>{const el=document.querySelector(`[data-complete="${a.id}"]`);if(el)el.textContent=`${METRICS.filter(([key])=>snapshot.ratings[index][key]).length}/4`;});
}

function groupedInstructors() {
  const map=new Map();
  state.assignments.forEach(a=>{if(!map.has(a.instructor_auth_user_id))map.set(a.instructor_auth_user_id,{id:a.instructor_auth_user_id,name:a.instructor_name,emp:a.instructor_emp_id,types:0,total:0});const group=map.get(a.instructor_auth_user_id);group.types++;group.total+=Number(a.activity_count||0);});
  return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'he'));
}

function renderAdmin() {
  state.previewMode = false;
  state.mode = 'admin';
  state.assignments = [...state.adminAssignments];
  state.responses = [...state.adminResponses];
  state.ratings = [...state.adminRatings];
  state.response = null;
  state.submitted = false;
  const groups=groupedInstructors();
  const submitted=state.responses.filter(r=>r.status==='submitted').length;
  const holdNotice = cycleIsOpen(state.cycle)
    ? ''
    : '<div class="locked"><strong>המשוב סגור למדריכים.</strong> רק אדמין יכול לצפות בתצוגה המקדימה. לא מתבצעת שמירה או הגשה.</div>';
  app.innerHTML=frame(`<main class="container"><section class="hero"><div><h1>ניהול משוב פעילות הקיץ</h1><p>מעקב מילוי, ניתוח הפעילויות ותצוגה מקדימה לפני הפצה.</p></div><div class="hero-count"><strong>${submitted}/${groups.length}</strong><span>משובים שהוגשו</span></div></section>
    ${holdNotice}
    <div class="admin-tabs"><button class="button ${state.adminTab==='status'?'primary':''}" data-tab="status">מעקב מילוי</button><button class="button ${state.adminTab==='analysis'?'primary':''}" data-tab="analysis">ניתוח פעילויות</button><button class="button" id="exportCsv">ייצוא CSV</button></div>
    <section class="panel">${state.adminTab==='status'?statusTable(groups):analysisTable()}</section></main>`, 'תצוגת ניהול');
  document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{state.adminTab=btn.dataset.tab;renderAdmin();}));
  document.querySelector('#exportCsv')?.addEventListener('click',exportCsv);
  document.querySelectorAll('[data-reopen]').forEach(btn=>btn.addEventListener('click',reopen));
  document.querySelectorAll('[data-preview]').forEach(btn=>btn.addEventListener('click',previewInstructor));
}

function statusTable(groups) {
  return `<h2>סטטוס מדריכים</h2><div class="table-wrap"><table><thead><tr><th>מדריך/ה</th><th>סוגים</th><th>הפעלות</th><th>סטטוס</th><th>עדכון</th><th></th></tr></thead><tbody>${groups.map(group=>{const response=state.responses.find(x=>x.instructor_auth_user_id===group.id);const reopenButton=response?.status==='submitted'?`<button class="button" data-reopen="${response.id}">פתיחה מחדש</button>`:'';return `<tr><td><strong>${esc(group.name)}</strong><small>מס׳ עובד ${esc(group.emp)}</small></td><td>${group.types}</td><td>${group.total}</td><td><span class="badge ${esc(response?.status||'')}">${statusText(response?.status)}</span></td><td>${fmtDate(response?.updated_at)}</td><td><button class="button primary" data-preview="${group.id}">תצוגה מקדימה</button>${reopenButton}</td></tr>`;}).join('')}</tbody></table></div>`;
}

function previewInstructor(event) {
  if (!state.canAdmin) return;
  const instructorId = event.currentTarget.dataset.preview;
  const previewAssignments = state.adminAssignments.filter(row => row.instructor_auth_user_id === instructorId);
  if (!previewAssignments.length) return notify('לא נמצאו פעילויות לתצוגה מקדימה.',true);
  state.previewMode = true;
  state.mode = 'instructor';
  state.assignments = previewAssignments;
  state.ratings = [];
  state.response = { id:'preview', status:'draft', general_answers:{}, summary_answers:{} };
  state.submitted = false;
  state.revision = 0;
  state.savedRevision = 0;
  renderInstructor();
  window.scrollTo({top:0,behavior:'smooth'});
}

function analysisTable() {
  const map=new Map();
  state.assignments.forEach(a=>{if(!map.has(a.activity_key))map.set(a.activity_key,{name:a.activity_name,total:0,ids:[]});const item=map.get(a.activity_key);item.total+=Number(a.activity_count||0);item.ids.push(a.id);});
  const rows=[...map.values()].map(item=>{
    const ratings=state.ratings.filter(r=>item.ids.includes(r.assignment_id));
    const rated=ratings.filter(r=>METRICS.some(([key])=>r[key] !== null && r[key] !== undefined && r[key] !== ''));
    return {...item,count:rated.length,age:mean(rated.map(r=>r.age_fit)),time:mean(rated.map(r=>r.time_fit)),equipment:mean(rated.map(r=>r.equipment_quality)),success:mean(rated.map(r=>r.student_success)),improve:ratings.filter(r=>r.needs_improvement).length,highlight:ratings.filter(r=>r.success_highlight).length};
  }).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'he'));
  const format=n=>n==null?'—':n.toFixed(2);
  return `<h2>ניתוח לפי פעילות</h2><div class="table-wrap"><table><thead><tr><th>פעילות</th><th>הפעלות</th><th>דירוגים</th><th>גיל</th><th>זמן</th><th>ציוד</th><th>הצלחה</th><th>לשיפור</th><th>בולטת</th></tr></thead><tbody>${rows.map(row=>`<tr><td><strong>${esc(row.name)}</strong></td><td>${row.total}</td><td>${row.count}</td><td>${format(row.age)}</td><td>${format(row.time)}</td><td>${format(row.equipment)}</td><td>${format(row.success)}</td><td>${row.improve}</td><td>${row.highlight}</td></tr>`).join('')}</tbody></table></div>`;
}

async function reopen(event) {
  if(!confirm('לפתוח את המשוב מחדש לעריכה?')) return;
  const result=await supabase.from('summer_feedback_responses').update({status:'reopened'}).eq('id',event.currentTarget.dataset.reopen).select().single();
  if(result.error) return notify('פתיחת המשוב נכשלה.',true);
  state.adminResponses=state.adminResponses.map(r=>r.id===result.data.id?result.data:r);
  state.responses=[...state.adminResponses];
  notify('המשוב נפתח מחדש.'); renderAdmin();
}

function csv(value) { const text=Array.isArray(value)?value.join(' | '):String(value??''); return `"${text.replaceAll('"','""')}"`; }
function exportCsv() {
  const responses=new Map(state.responses.map(r=>[r.instructor_auth_user_id,r])); const ratings=new Map(state.ratings.map(r=>[r.assignment_id,r]));
  const rows=[['מדריך','מספר עובד','פעילות','הפעלות','שכבות גיל','סטטוס','התאמה לגיל','התאמה לזמן','ציוד','הצלחה','בולטת','סיבות להצלחה','הערת הצלחה','לשיפור','קשיים','המלצה לשיפור','מה חשוב לשמר','מה חשוב לשפר','הכשרה נוספת','הערות כלליות']];
  state.assignments.forEach(a=>{
    const response=responses.get(a.instructor_auth_user_id); const rating=ratings.get(a.id)||{}; const summary=response?.summary_answers||{};
    rows.push([a.instructor_name,a.instructor_emp_id,a.activity_name,a.activity_count,a.grade_labels,statusText(response?.status),rating.age_fit,rating.time_fit,rating.equipment_quality,rating.student_success,rating.success_highlight?'כן':'לא',rating.success_reasons,rating.success_note,rating.needs_improvement?'כן':'לא',rating.improvement_categories,rating.improvement_note,summary.preserve,summary.improve,summary.training_needed,summary.additional_notes]);
  });
  const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(csv).join(',')).join('\n')],{type:'text/csv;charset=utf-8'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`summer-feedback-${new Date().toISOString().slice(0,10)}.csv`;link.click();URL.revokeObjectURL(link.href);
}

init();

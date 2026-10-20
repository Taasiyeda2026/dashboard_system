/**
 * Manager-only observation form. Separate from campaign/student feedback.
 * One observation = one immutable completed report, with editable drafts.
 */
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import './styles/instructor-observation.css';

const TABLE = 'instructor_observations';
const SECTIONS = [
  { title: 'הכנה ופתיחה', help: 'התבוננו בהיערכות המדריך ובאופן שבו השיעור נפתח.', questions: [
    ['האם המדריך הגיע מוכן לשיעור (ציוד, מצגת, חומרים, סדר עבודה)?', ['כן','חלקית','לא']],
    ['פתיחת השיעור הייתה ברורה, מסקרנת ומכינה את התלמידים לנושא?', ['מצוין','טוב','בינוני','חלש']]
  ]},
  { title: 'שליטה בתוכן ובמבנה השיעור', help: 'בדקו את הידע המקצועי, ההתאמה לסילבוס והרצף הפדגוגי.', questions: [
    ['שליטה בתוכן ובידע הנדרש לשיעור', ['מצוין','טוב','בינוני','חלש']],
    ['עבודה עקבית לפי הסילבוס והמטרות שנקבעו לשיעור', ['כן','חלקית','לא']],
    ['יכולת קישור בין שיעור קודם לנושא הנלמד היום / סיכום בסוף השיעור', ['מצוין','טוב','חלקי','לא בוצע']]
  ]},
  { title: 'איכות ההסבר והעברת התוכן', help: 'התייחסו לבהירות, להמחשות ולעידוד חשיבה.', questions: [
    ['בהירות ההסבר והתאמת השפה לגיל התלמידים', ['מצוין','טוב','בינוני','חלש']],
    ['שימוש בהמחשות, שאלות, דוגמאות, ציוד או מצגת', ['גבוה','בינוני','נמוך']],
    ['עידוד חשיבה, סקרנות או שאלות מצד התלמידים', ['גבוה','בינוני','נמוך']]
  ]},
  { title: 'אינטראקציה עם תלמידים', help: 'בדקו את המעורבות, האווירה ואת היחס לתלמידים.', questions: [
    ['רמת המעורבות של התלמידים במהלך השיעור', ['גבוהה','בינונית','נמוכה']],
    ['יחס אישי, תקשורת נעימה ויצירת קשר עם כלל התלמידים', ['מצוין','טוב','בינוני','חלש']]
  ]},
  { title: 'ניהול כיתה', help: 'תעדו כיצד נשמרו הקשב והסדר, וכיצד התמודדו עם הפרעות.', questions: [
    ['שמירה על סדר וקשב במהלך השיעור', ['מצוין','טוב','בינוני','מאתגר']],
    ['התמודדות עם בעיות משמעת או הפרעות', ['מצוינת','טובה','בינונית','חלשה','לא נדרש']],
    ['עבודה יעילה במהלך פעילות/בנייה (במידת הצורך)', ['מצוין','טוב','בינוני','חלש','לא רלוונטי']]
  ]},
  { title: 'מקצועיות ושיתוף פעולה', help: 'התייחסו לנוכחות המקצועית ולעבודה עם צוות בית הספר, אם נכח.', questions: [
    ['ביטחון מקצועי, נוכחות והובלת השיעור', ['מצוין','טוב','בינוני','נמוך']],
    ['שיתוף פעולה עם צוות בית הספר הנוכח בשיעור (אם יש)', ['מצוין','טוב','בינוני','לא התקיים']]
  ]}
];
const RATING_LABELS = ['','חלש','טעון שיפור','טוב','טוב מאוד','מצוין'];
const e = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const localDate = () => { const d = new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
const allowed = user => ['admin','activities_manager','operation_manager'].includes(String(user?.role || '').trim()) && user?.is_active !== false;
let root, userGetter = () => ({}), selected = null, list = [], stage = -1, empId = '', name = '', saveQueue = Promise.resolve(), debounce, activityOptions = [], lastFocus = null;
let isOpen = false, viewerAuthId = '', observationSlot = 1;
const editable = () => !!selected && selected.status === 'draft' && (!selected.created_by || selected.created_by === viewerAuthId);

const statusNode = () => root?.querySelector('[data-io-status]');
function status(message, bad = false) {
  const node = statusNode();
  if (node) { node.textContent = message || ''; node.classList.toggle('io-error',!!bad); }
}

function modalShell() {
  if (root) return;
  root = document.createElement('div');
  root.className = 'io-root'; root.setAttribute('dir','rtl');
  root.innerHTML = '<div class="io-dialog" role="dialog" aria-modal="true" aria-labelledby="io-heading"></div><div class="io-print" aria-hidden="true"></div>';
  document.body.appendChild(root);
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);
}
function close() {
  if (selected && selected.status === 'draft') { capture(); void persist().catch(()=>{}); }
  isOpen = false; root?.classList.remove('io-visible');
  document.body.classList.remove('io-modal-open');
  selected = null; stage = -1;
  if (lastFocus?.isConnected) lastFocus.focus();
}
async function open(id, display, trigger, slot = 1) {
  if (!allowed(userGetter())) return;
  modalShell();
  empId = id; name = display || id; observationSlot = slot === 2 ? 2 : 1; stage = -1; selected = null;
  lastFocus = trigger; isOpen = true;
  root.classList.add('io-visible');
  document.body.classList.add('io-modal-open');
  dialog('טוען את התצפיות הקיימות…');
  try {
    if (!supabase) throw new Error('חיבור הנתונים אינו זמין');
    await waitForSupabaseAuthSession({ timeoutMs: 6000 });
    const userResponse = await supabase.auth.getUser();
    viewerAuthId = String(userResponse?.data?.user?.id || '');
    const {data,error} = await supabase.from(TABLE).select('*').eq('emp_id',Number(empId)).order('created_at',{ascending:false}).limit(30);
    if (error) throw error;
    list = (data || []).filter((item) => Number(item.details?.observation_slot || 1) === observationSlot);
    activityOptions = [];
    try {
      const meetingDates = Array.from({length:35},(_,i)=>'date_'+(i+1)).join(',');
      const response = await supabase.from('activities')
        .select('row_id,activity_name,program_name,school,authority,grade,class_group,activity_season,emp_id,emp_id_2,'+meetingDates)
        .eq('activity_season','school_2027')
        .or('emp_id.eq.'+empId+',emp_id_2.eq.'+empId)
        .limit(200);
      if (!response.error) activityOptions = response.data || [];
    } catch (_) { /* manual course and school entry still available */ }
    home();
  } catch(err) {
    dialog('<div class="io-note io-error">לא ניתן לטעון תצפיות. יש לוודא שטבלת התצפיות וההרשאות הופעלו ב-Supabase.<p>'+e(err?.message || err)+'</p></div>');
  }
}
function dialog(body) {
  const host = root.querySelector('.io-dialog');
  host.innerHTML = '<header class="io-top"><div><small>מעקב צוות / תצפית '+observationSlot+'</small><h2 id="io-heading">'+e(name)+'</h2></div><button type="button" class="io-x" data-io-action="close" aria-label="סגירה">✕</button></header>'+body;
}
function home() {
  stage = -1;
  dialog('<div class="io-content"><div class="io-lead"><h3>משוב תצפית '+observationSlot+' – צפייה והערכת מדריך</h3></div>'+
    '<button type="button" class="io-primary" data-io-action="new">＋ התחלת תצפית חדשה</button>'+
    '<h3>תצפיות קודמות</h3><div class="io-history">'+(list.length ? list.map((item) =>
    '<button type="button" data-io-resume="'+e(item.id)+'" class="io-history-row"><span><strong>'+e(item.observation_date || 'ללא תאריך')+'</strong><small>'+e(item.details?.course || 'טרם נבחר קורס')+' · '+e(item.observer_name || 'צופה לא מוגדר')+'</small></span><span class="io-pill">'+(item.status === 'completed' ? 'הושלם · דו"ח' : 'טיוטה · המשך מילוי')+'</span></button>').join('') : '<p class="io-muted">עדיין לא נערכו תצפיות למדריך זה.</p>')+'</div></div>');
}
function blankRecord() {
  const u = userGetter();
  return {emp_id:Number(empId), instructor_name:name, observer_name:String(u?.full_name || u?.name || u?.display_name || '').trim(),
    observation_date:localDate(), details:{observation_slot:observationSlot}, responses:{}, comments:{}, overall_rating:null, strengths:'', improvements:'', summary:'', status:'draft'};
}
async function create() {
  dialog('<div class="io-content">יוצר טיוטת תצפית…</div>');
  try {
    const {data,error} = await supabase.from(TABLE).insert(blankRecord()).select('*').single();
    if (error) throw error;
    selected=data; list.unshift(data); stage=0; render();
  } catch(err) { dialog('<div class="io-content"><p class="io-error">יצירת הטיוטה נכשלה: '+e(err?.message || err)+'</p><button type="button" class="io-secondary" data-io-action="home">חזרה לרשימה</button></div>'); }
}
function resume(id) {
  selected=list.find(item=>item.id===id);
  if (!selected) return;
  // Completed observations reopen at the report/print step instead of forcing
  // a manager to click through every already-finalized section.
  stage=selected.status==='completed'?9:0; render();
}
function field(label,key,type='text',required=false,value='') {
  return '<label class="io-field"><span>'+e(label)+(required ? ' <em>חובה</em>' : '')+'</span><input type="'+e(type)+'" data-io-detail="'+e(key)+'" value="'+e(value)+'" '+(!editable()?'disabled':'')+'></label>';
}
function choice(key,question,choices) {
  const current=selected.responses?.[key] || '';
  return '<fieldset class="io-question"><legend>'+e(question)+'</legend><div class="io-options">'+choices.map((v) =>
    '<label class="io-option"><input type="radio" name="io-'+e(key)+'" data-io-answer="'+e(key)+'" value="'+e(v)+'" '+(current===v?'checked ':'')+(!editable()?'disabled':'')+'><span>'+e(v)+'</span></label>').join('')+'</div></fieldset>';
}

/** Populate only facts already held in the chosen activity. Never invent a meeting number. */
function observationActivityPrefill(activity, observationDate) {
  const grade=String(activity?.grade || '').trim();
  const group=String(activity?.class_group || '').trim();
  const className=grade && group ? grade+' · '+(/^[0-9]+$/.test(group) ? 'קבוצה '+group : group) : grade || group;
  const date=String(observationDate || '').slice(0,10);
  let meeting='';
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) {
    for(let i=1;i<=35;i++) {
      if(String(activity?.['date_'+i] || '').slice(0,10) === date) {
        meeting=String(i);
        break;
      }
    }
  }
  return {
    activity_row_id:String(activity?.row_id || ''),
    course:String(activity?.activity_name || activity?.program_name || '').trim(),
    school:String(activity?.school || '').trim(),
    class:className,
    meeting,
    meeting_source_date:meeting ? date : ''
  };
}
function selectedActivityOption() {
  return activityOptions.find(a=>String(a.row_id) === String(selected?.details?.activity_row_id || '')) || null;
}
function setObservationDetailValue(key,value) {
  const input=root?.querySelector('[data-io-detail="'+key+'"]');
  if(input) input.value=String(value ?? '');
}
function showActivityPrefillStatus(data) {
  const problems=[];
  if (!data.class) problems.push('הכיתה אינה מופיעה בפעילות');
  if (!data.meeting) problems.push('לא נמצא מפגש בתאריך הצפייה');
  const message=problems.length ? 'הפרטים הקיימים מולאו. '+problems.join('; ')+'. יש לבדוק ולהשלים ידנית.' :
    'פרטי הקורס, בית הספר, הכיתה ומספר המפגש מולאו מהפעילות.';
  const el=root?.querySelector('[data-io-activity-info]');
  if(el) el.textContent=message;
}
function applyActivityPrefill(activity) {
  if(!activity || !selected || !editable()) return;
  const data=observationActivityPrefill(activity,selected.observation_date);
  selected.details={...selected.details,...data};
  for(const key of ['course','school','class','meeting']) setObservationDetailValue(key,data[key]);
  showActivityPrefillStatus(data);
}
/** Changing the visit date updates only a meeting number that was derived automatically. */
function refreshMeetingForDate() {
  const activity=selectedActivityOption();
  if (!activity || !selected || !editable()) return;
  const d=selected.details || {};
  if(d.meeting && !d.meeting_source_date) return; // The observer entered a manual number.
  const next=observationActivityPrefill(activity,selected.observation_date);
  d.meeting=next.meeting;
  d.meeting_source_date=next.meeting_source_date;
  setObservationDetailValue('meeting',d.meeting);
  showActivityPrefillStatus({...next,class:d.class});
}

function detailScreen() {
  const d=selected.details || {};
  const pickOptions = activityOptions.map((a,i)=>'<option value="'+i+'" '+(String(d.activity_row_id || '')===String(a.row_id)?'selected':'')+'>'+e((a.activity_name || a.program_name || 'פעילות')+' · '+(a.school || '')+' · '+(a.authority || '')+' · '+(a.grade || '')+' '+(a.class_group || ''))+'</option>').join('');
  return '<h3>פרטי התצפית — לפני תחילת השיעור</h3><p class="io-muted">בחרו פעילות קיימת כדי למלא אוטומטית את הקורס, בית הספר, הכיתה ומספר המפגש אם תאריך התצפית תואם למועד במערכת. יש לאמת את הפרטים.</p>'+
    (activityOptions.length ? '<label class="io-field"><span>מילוי מתוך פעילות קיימת (לבחירה)</span><select data-io-pick-activity '+(!editable()?'disabled':'')+'><option value="">בחרו פעילות…</option>'+pickOptions+'</select></label><p class="io-muted" data-io-activity-info role="status">שדות שלא קיימים בפעילות נשארים להשלמה ידנית; מספר התלמידים ונוכחות צוות בית הספר מתועדים לפי המצב בפועל.</p>' : '')+
    '<div class="io-fields">'+field('תאריך צפייה','date','date',true,selected.observation_date || '')+field('שם הצופה','observer','text',true,selected.observer_name || '')+
    field('שם הקורס','course','text',true,d.course || '')+field('מספר מפגש','meeting','number',true,d.meeting || '')+
    field('בית הספר','school','text',true,d.school || '')+field('כיתה','class','text',true,d.class || '')+
    field('מספר תלמידים','students','number',true,d.students || '')+
    '<label class="io-field"><span>נוכחות צוות בית הספר <em>חובה</em></span><select data-io-detail="school_staff" '+(!editable()?'disabled':'')+'><option value="">בחרו…</option><option value="כן" '+(d.school_staff==='כן'?'selected':'')+'>כן</option><option value="לא" '+(d.school_staff==='לא'?'selected':'')+'>לא</option></select></label></div>'+
    '<label class="io-field"><span>מידע חשוב לצופה לפני תחילת השיעור (אם יש)</span><textarea data-io-detail="important" rows="3" '+(!editable()?'disabled':'')+'>'+e(d.important||'')+'</textarea></label>';
}
function sectionScreen(index) {
  const s=SECTIONS[index];
  return '<h3>'+e(index+1)+'. '+e(s.title)+'</h3><p class="io-muted">'+e(s.help)+'</p>'+
    s.questions.map((q,i)=>choice(index+'-'+i,q[0],q[1])).join('')+
    '<label class="io-field"><span>הערות ודוגמאות מהצפייה (לא חובה)</span><textarea data-io-comment="'+index+'" rows="4" placeholder="מה ראיתם בפועל? מה כדאי לשמר או לשפר?" '+(!editable()?'disabled':'')+'>'+e(selected.comments?.[index]||'')+'</textarea></label>';
}
function summaryScreen() {
  return '<h3>סיכום המשוב</h3><p class="io-muted">הדירוג הכולל הוא הערכת המנהל ואינו ממוצע אוטומטי של סולמות התשובה השונים.</p>'+
    '<fieldset class="io-question"><legend>דירוג כולל של ביצועי המדריך בשיעור</legend><div class="io-options">'+[1,2,3,4,5].map(n=>
      '<label class="io-option"><input type="radio" name="io-overall" data-io-overall value="'+n+'" '+(Number(selected.overall_rating)===n?'checked ':'')+(!editable()?'disabled':'')+'><span>'+n+' · '+e(RATING_LABELS[n])+'</span></label>').join('')+'</div></fieldset>'+
    [['strengths','נקודות כוח'],['improvements','נקודות לשיפור'],['summary','סיכום מקצועי וחוות דעת']].map(([key,label])=>
      '<label class="io-field"><span>'+e(label)+' <em>חובה</em></span><textarea rows="5" data-io-text="'+key+'" '+(!editable()?'disabled':'')+'>'+e(selected[key]||'')+'</textarea></label>').join('');
}
function overview() {
  const d=selected.details||{};
  return '<h3>בדיקה לפני סיום והפקת דו"ח</h3><p class="io-muted">בדקו שכל הפרטים נכונים. לאחר הסיום המשוב יינעל לעריכה ויהיה זמין לצפייה ולהפקת PDF.</p>'+
    '<div class="io-overview"><strong>'+e(selected.instructor_name)+'</strong><span>'+e(selected.observation_date)+' · '+e(d.school || 'ללא בית ספר')+' · '+e(d.course || 'ללא קורס')+'</span></div>'+
    SECTIONS.map((s,i)=>'<div class="io-overview"><strong>'+e(s.title)+'</strong><span>'+s.questions.filter((q,j)=>!!selected.responses?.[i+'-'+j]).length+' מתוך '+s.questions.length+' מדדים מולאו</span></div>').join('')+
    '<div class="io-overview"><strong>דירוג מסכם</strong><span>'+e(selected.overall_rating ? selected.overall_rating+' · '+RATING_LABELS[selected.overall_rating] : 'טרם דורג')+'</span></div>'+
    (selected.status==='completed' ? '<p class="io-success">המשוב הושלם ונשמר. ניתן להפיק דו"ח PDF.</p>' : '<p class="io-muted">ניתן לחזור לכל שלב ולהשלים פרטים חסרים.</p>');
}
function report() {
  const d=selected.details||{};
  return '<div class="io-report"><header><h1>תעשיידע · משוב תצפית '+Number(selected.details?.observation_slot || observationSlot)+' – צפייה והערכת מדריך</h1><p>דו"ח תצפית מקצועי · שנת הלימודים תשפ״ז</p></header>'+
    '<table><tbody>'+[['שם המדריך',selected.instructor_name],['תאריך הצפייה',selected.observation_date],['שם הצופה',selected.observer_name],
    ['שם הקורס',d.course],['מספר מפגש',d.meeting],['בית הספר',d.school],['כיתה',d.class],['מספר תלמידים',d.students],
    ['נוכחות צוות בית הספר',d.school_staff],['מידע מקדים',d.important]].map(([k,v])=>'<tr><th>'+e(k)+'</th><td>'+e(v||'—')+'</td></tr>').join('')+'</tbody></table>'+
    SECTIONS.map((s,i)=>'<section><h2>'+(i+1)+'. '+e(s.title)+'</h2>'+
      s.questions.map((q,j)=>'<div class="io-report-answer"><strong>'+e(q[0])+'</strong><span>'+e(selected.responses?.[i+'-'+j] || 'לא מולא')+'</span></div>').join('')+
      '<p><strong>הערות ודוגמאות: </strong>'+e(selected.comments?.[i]||'לא נרשמו')+'</p></section>').join('')+
    '<section><h2>סיכום מקצועי</h2><p><strong>דירוג כולל:</strong> '+e(selected.overall_rating ? selected.overall_rating+' · '+RATING_LABELS[selected.overall_rating] : '—')+'</p>'+
    '<h3>נקודות כוח</h3><p>'+e(selected.strengths||'—')+'</p><h3>נקודות לשיפור</h3><p>'+e(selected.improvements||'—')+'</p><h3>חוות דעת מסכמת</h3><p>'+e(selected.summary||'—')+'</p></section>'+
    '<footer>תאריך הפקת הדו"ח: '+e(localDate())+' · נוצר במערכת תעשיידע</footer></div>';
}
function render() {
  if (!selected) return home();
  const done=selected.status==='completed';
  const stages=['הקדמה','פרטי התצפית',...SECTIONS.map(s=>s.title),'סיכום','בדיקה והפקה'];
  const body = stage===0 ? '<div class="io-lead"><h3>לפני שמתחילים — מטרת התצפית</h3><p>המשוב נועד להעריך את איכות ההדרכה בפועל, לזהות חוזקות ותחומים לשיפור ולבסס ליווי מקצועי.</p></div><h3>הנחיות לצופה</h3><ol><li>יש ליידע את המדריך מראש על מועד התצפית, מטרותיה ומדדי ההערכה.</li><li>יש לתעד רק מה שנצפה בפועל ובאופן ענייני ומדויק.</li><li>רצוי לציין דוגמאות קונקרטיות בכל תחום.</li><li>בסיום יש לכתוב נקודות כוח, נקודות לשיפור וחוות דעת מסכמת.</li><li>אפשר לשמור טיוטה בכל שלב. הדו"ח זמין למנהל בלבד ואינו נשלח אוטומטית למדריך.</li></ol>' :
    stage===1 ? detailScreen() : stage>=2&&stage<=7 ? sectionScreen(stage-2) : stage===8 ? summaryScreen() : overview();
  const footer = '<footer class="io-actions"><button type="button" class="io-secondary" data-io-action="home">לכל התצפיות</button><div class="io-actions-main">'+
    (stage>0?'<button type="button" class="io-secondary" data-io-action="back">הקודם</button>':'')+
    (stage<9?'<button type="button" class="io-primary" data-io-action="next">המשך</button>':'')+
    (stage===9 && editable()?'<button type="button" class="io-primary" data-io-action="finish">סיום ושמירת המשוב</button>':'')+
    (stage===9 && done?'<button type="button" class="io-primary" data-io-action="print">הפקת PDF</button>':'')+
    '</div></footer>';
  dialog('<div class="io-progress"><div class="io-progress-header"><span>שלב '+(stage+1)+' מתוך '+stages.length+' · '+e(stages[stage])+'</span><span>'+Math.round((stage+1)/stages.length*100)+'%</span></div><div class="io-track"><span style="width:'+Math.round((stage+1)/stages.length*100)+'%"></span></div></div>'+
    '<main class="io-content">'+body+'</main><p class="io-save-status" data-io-status aria-live="polite">'+(done?'המשוב הושלם וננעל לעריכה':editable()?'שינויים נשמרים כטיוטה':'טיוטה לצפייה בלבד')+'</p>'+footer);
  root.querySelector('.io-print').innerHTML=report();
}
function capture() {
  if (!editable()) return;
  root.querySelectorAll('[data-io-detail]').forEach(el => {
    const key=el.dataset.ioDetail, val=el.value;
    if (key==='date') selected.observation_date=val;
    else if (key==='observer') selected.observer_name=val;
    else { selected.details=selected.details||{}; selected.details[key]=val; }
  });
  root.querySelectorAll('[data-io-answer]:checked').forEach(el=>{ selected.responses=selected.responses||{}; selected.responses[el.dataset.ioAnswer]=el.value; });
  root.querySelectorAll('[data-io-comment]').forEach(el=>{selected.comments=selected.comments||{};selected.comments[el.dataset.ioComment]=el.value;});
  root.querySelectorAll('[data-io-text]').forEach(el=>{selected[el.dataset.ioText]=el.value;});
  const rating=root.querySelector('[data-io-overall]:checked');
  if (rating) selected.overall_rating=Number(rating.value);
}
function persist(final=false) {
  if (!editable()) return Promise.resolve();
  const snapshot={observer_name:selected.observer_name,observation_date:selected.observation_date,
    details:{...selected.details},responses:{...selected.responses},comments:{...selected.comments},
    overall_rating:selected.overall_rating,strengths:selected.strengths,improvements:selected.improvements,summary:selected.summary,
    status:final?'completed':'draft',completed_at:final?new Date().toISOString():null};
  const id=selected.id;
  saveQueue=saveQueue.catch(()=>{}).then(async()=>{
    const {data,error}=await supabase.from(TABLE).update(snapshot).eq('id',id).eq('status','draft').select('id,status').single();
    if(error) throw error;
    if(final && data?.status==='completed') selected.status='completed';
  });
  return saveQueue;
}
function validate() {
  const d=selected.details||{};
  if (!selected.observation_date || !selected.observer_name || !d.course || !d.meeting || Number(d.meeting)<1 || !d.school || !d.class ||
    !d.students || Number(d.students)<1 || !['כן','לא'].includes(d.school_staff))
    return 'יש להשלים את כל שדות החובה בפרטי התצפית (שלב 2).';
  for(let i=0;i<SECTIONS.length;i++) for(let j=0;j<SECTIONS[i].questions.length;j++) {
    if(!SECTIONS[i].questions[j][1].includes(selected.responses?.[i+'-'+j])) return 'לא מולאו כל המדדים בתחום: '+SECTIONS[i].title;
  }
  if(!(selected.overall_rating>=1&&selected.overall_rating<=5)||!selected.strengths?.trim()||!selected.improvements?.trim()||!selected.summary?.trim())
    return 'יש להשלים דירוג כולל, נקודות כוח, נקודות לשיפור וסיכום מקצועי.';
  return '';
}
async function onClick(event) {
  const button=event.target.closest('[data-io-action], [data-io-resume]');
  if (!button) return;
  const action=button.dataset.ioAction;
  if (button.dataset.ioResume) return resume(button.dataset.ioResume);
  if (action==='close') return close();
  if (action==='new') return create();
  if (action==='print') { if (selected?.status==='completed') window.print(); return; }
  if (action==='home' || action==='next' || action==='back' || action==='finish') {
    clearTimeout(debounce); capture();
    if (action==='finish') {
      const error=validate();
      if(error){status(error,true);return;}
    }
    try {
      button.disabled=true; status('שומר…');
      if (selected.status==='draft') await persist(action==='finish');
      if (action==='home') home();
      else if (action==='next') {stage=Math.min(9,stage+1);render();}
      else if (action==='back') {stage=Math.max(0,stage-1);render();}
      else if (action==='finish') {stage=9;render();status('המשוב נשמר וננעל. ניתן להפיק PDF.');}
    } catch(err) { button.disabled=false;status('השמירה נכשלה: '+(err?.message||err),true); }
  }
}
function onInput(event) {
  if (!editable()) return;
  const target=event.target;
  if (target.matches('[data-io-pick-activity]')) {
    const idx=Number(target.value);
    const activity=target.value!==''?activityOptions[idx]:null;
    if(activity) applyActivityPrefill(activity);
    else if(selected?.details) {
      delete selected.details.activity_row_id;
      delete selected.details.meeting_source_date;
      const info=root?.querySelector('[data-io-activity-info]');
      if(info) info.textContent='הפעילות נותקה. אפשר למלא או לערוך את הפרטים ידנית.';
    }
  }
  if (target.matches('[data-io-detail="meeting"]')) {
    if (selected?.details) delete selected.details.meeting_source_date;
  }
  if (target.matches('[data-io-detail="date"]')) {
    capture();
    refreshMeetingForDate();
  }
  if (!target.closest('[data-io-detail],[data-io-answer],[data-io-comment],[data-io-overall],[data-io-text],[data-io-pick-activity]')) return;
  capture(); clearTimeout(debounce);
  debounce=setTimeout(()=>{ void persist().then(()=>status('הטיוטה נשמרה')).catch(err=>status('השמירה נכשלה: '+(err?.message||err),true)); },1100);
}
export function installInstructorObservationRuntime({getUser=()=>({})}={}) {
  if (typeof document==='undefined' || window.__instructorObservationInstalled) return;
  window.__instructorObservationInstalled=true;userGetter=getUser;
  document.addEventListener('click',event=>{
    const btn=event.target.closest('[data-io-open]');
    if(!btn)return;
    event.preventDefault();event.stopPropagation();
    void open(String(btn.dataset.ioOpen),String(btn.dataset.ioName || ''),btn,Number(btn.dataset.ioSlot));
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && isOpen){event.preventDefault();close();}});
}

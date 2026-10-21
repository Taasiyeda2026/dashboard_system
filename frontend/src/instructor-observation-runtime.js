/**
 * Manager-only observation form. Separate from campaign/student feedback.
 * One observation = one immutable completed report, with editable drafts.
 */
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import './styles/instructor-observation.css';

const TABLE = 'instructor_observations';
const RATING_OPTIONS = [
  ['5','מצוין'], ['4','טוב מאוד'], ['3','טוב'], ['2','טעון שיפור'], ['1','חלש']
];
const GRADED = RATING_OPTIONS.map(([score])=>score);
const SECTIONS = [
  { title: 'הכנה ופתיחה', help: 'התבוננו בהיערכות המדריך ובאופן שבו השיעור נפתח.', questions: [
    ['האם המדריך הגיע מוכן לשיעור (ציוד, מצגת, חומרים, סדר עבודה)?', ['כן','חלקית','לא']],
    ['פתיחת השיעור הייתה ברורה, מסקרנת ומכינה את התלמידים לנושא?', GRADED]
  ]},
  { title: 'שליטה בתוכן ובמבנה השיעור', help: 'בדקו את הידע המקצועי, ההתאמה לסילבוס והרצף הפדגוגי.', questions: [
    ['שליטה בתוכן ובידע הנדרש לשיעור', GRADED],
    ['עבודה עקבית לפי הסילבוס והמטרות שנקבעו לשיעור', ['כן','חלקית','לא']],
    ['יכולת קישור בין שיעור קודם לנושא הנלמד היום / סיכום בסוף השיעור', [...GRADED,'לא בוצע']]
  ]},
  { title: 'איכות ההסבר והעברת התוכן', help: 'התייחסו לבהירות, להמחשות ולעידוד חשיבה.', questions: [
    ['בהירות ההסבר והתאמת השפה לגיל התלמידים', GRADED],
    ['שימוש בהמחשות, שאלות, דוגמאות, ציוד או מצגת', GRADED],
    ['עידוד חשיבה, סקרנות או שאלות מצד התלמידים', GRADED]
  ]},
  { title: 'אינטראקציה עם תלמידים', help: 'בדקו את המעורבות, האווירה ואת היחס לתלמידים.', questions: [
    ['רמת המעורבות של התלמידים במהלך השיעור', GRADED],
    ['יחס אישי, תקשורת נעימה ויצירת קשר עם כלל התלמידים', GRADED]
  ]},
  { title: 'ניהול כיתה', help: 'תעדו כיצד נשמרו הקשב והסדר, וכיצד התמודדו עם הפרעות.', questions: [
    ['שמירה על סדר וקשב במהלך השיעור', GRADED],
    ['התמודדות עם בעיות משמעת או הפרעות', [...GRADED,'לא נדרש']],
    ['עבודה יעילה במהלך פעילות/בנייה (במידת הצורך)', [...GRADED,'לא רלוונטי']]
  ]},
  { title: 'מקצועיות ושיתוף פעולה', help: 'התייחסו לנוכחות המקצועית ולעבודה עם צוות בית הספר, אם נכח.', questions: [
    ['ביטחון מקצועי, נוכחות והובלת השיעור', GRADED],
    ['שיתוף פעולה עם צוות בית הספר הנוכח בשיעור (אם יש)', [...GRADED,'לא התקיים']]
  ]}
];
const RATING_LABELS = ['','חלש','טעון שיפור','טוב','טוב מאוד','מצוין'];
const isNumericRating = choice => /^[1-5]$/.test(String(choice));
const ratingText = choice => isNumericRating(choice) ? String(choice)+' – '+RATING_LABELS[Number(choice)] : String(choice || '');
const gradedChoices = choices => choices.some(isNumericRating);
const responseLabel = (value,choices) => {
  if(!value) return 'לא מולא';
  if(gradedChoices(choices) && !choices.includes(String(value)))
    return 'תשובה בסולם קודם: '+String(value);
  return ratingText(value);
};
const e = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const localDate = () => { const d = new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
const allowed = user => ['admin','activities_manager','operation_manager'].includes(String(user?.role || '').trim()) && user?.is_active !== false;
let root, userGetter = () => ({}), selected = null, list = [], stage = -1, empId = '', name = '', saveQueue = Promise.resolve(), debounce, activityOptions = [], lastFocus = null;
let isOpen = false, viewerAuthId = '', observationSlot = 1, reviewReached = false;
let sharepointReceipt=null, sharepointBusy=false, sharepointError='';
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
  selected = null; stage = -1; reviewReached = false; sharepointReceipt=null;sharepointBusy=false;sharepointError='';
  if (lastFocus?.isConnected) lastFocus.focus();
}
async function open(id, display, trigger, slot = 1) {
  if (!allowed(userGetter())) return;
  modalShell();
  empId = id; name = display || id; observationSlot = slot === 2 ? 2 : 1; stage = -1; selected = null; reviewReached = false; sharepointReceipt=null;sharepointBusy=false;sharepointError='';
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
  stage=-1;
  const history=list.length ? list.map(item=>
    '<button type="button" data-io-resume="'+e(item.id)+'" class="io-history-row"><span><strong>'+
    e(item.observation_date || 'ללא תאריך')+'</strong><small>'+
    e(item.details?.course || 'טרם נבחר קורס')+' · '+e(item.observer_name || 'צופה לא מוגדר')+
    '</small></span><span class="io-pill">'+
    (item.status==='completed'?'הושלם · דו"ח':'המשך מילוי')+'</span></button>').join(''):
    '<p class="io-home-empty">עדיין לא נערכו תצפיות למדריך זה.</p>';
  dialog('<div class="io-content io-home"><div class="io-home-head"><div><h3>משוב תצפית '+observationSlot+'</h3>'+
    '<p class="io-home-subtitle">צפייה והערכת מדריך</p></div>'+
    '<button type="button" class="io-primary" data-io-action="new">＋ התחלת תצפית חדשה</button></div>'+
    '<section class="io-home-history" aria-label="תצפיות קודמות"><h3>תצפיות קודמות</h3>'+
    '<div class="io-history">'+history+'</div></section></div>');
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
    selected=data; list.unshift(data); stage=0; reviewReached=false;sharepointReceipt=null;sharepointBusy=false;sharepointError=''; render();
  } catch(err) { dialog('<div class="io-content"><p class="io-error">יצירת הטיוטה נכשלה: '+e(err?.message || err)+'</p><button type="button" class="io-secondary" data-io-action="home">חזרה לרשימה</button></div>'); }
}
function resume(id) {
  selected=list.find(item=>item.id===id);
  if (!selected) return;
  // Completed observations reopen at the report/print step instead of forcing
  // a manager to click through every already-finalized section.
  stage=selected.status==='completed'?9:0; reviewReached=stage===9; sharepointReceipt=null;sharepointError=''; render();
  if(stage===9)void checkSharePointReceipt(selected.id);
}
function field(label,key,type='text',required=false,value='') {
  return '<label class="io-field"><span>'+e(label)+(required ? ' <em>חובה</em>' : '')+'</span><input type="'+e(type)+'" data-io-detail="'+e(key)+'" value="'+e(value)+'" '+(!editable()?'disabled':'')+'></label>';
}
function choice(key,question,choices) {
  const current=String(selected.responses?.[key] || '');
  const numeric=gradedChoices(choices);
  const legacy=!!current && !choices.includes(current);
  const options=choices.map(v=>
    '<label class="io-option"><input type="radio" name="io-'+e(key)+'" data-io-answer="'+e(key)+
    '" value="'+e(v)+'" '+(current===v?'checked ':'')+(!editable()?'disabled':'')+
    '><span>'+e(numeric?ratingText(v):v)+'</span></label>').join('');
  return '<fieldset class="io-question'+(numeric?' io-question--rating':'')+'"><legend>'+e(question)+
    '</legend><div class="io-options'+(numeric?' io-options--rating':'')+'">'+options+'</div>'+
    (legacy?'<p class="io-legacy-rating">תשובה שנשמרה בסולם הקודם: '+e(current)+
      (editable()?'. יש לבחור דירוג חדש כדי להשלים את המדד.':'.')+'</p>':'')+
    '</fieldset>';
}
/** Scheduled meetings are identified by source date_N, not by arithmetic on weekdays. */
function scheduledMeetings(activity) {
  const meetings=[];
  for(let index=1;index<=35;index++) {
    const date=String(activity?.['date_'+index] || '').slice(0,10);
    if(/^\d{4}-\d{2}-\d{2}$/.test(date)) meetings.push({number:index,date});
  }
  return meetings;
}
function shortMeetingDate(iso) {
  const match=String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? match[3]+'.'+match[2]+'.'+match[1] : '';
}
function meetingPickerMarkup() {
  const activity=selectedActivityOption();
  if(!activity) return '';
  const meetings=scheduledMeetings(activity);
  const d=selected?.details || {};
  if(!meetings.length) return '<p class="io-muted">לא נמצאו מועדי מפגשים בפעילות זו. יש להזין את מספר המפגש ידנית.</p>';
  return '<label class="io-field"><span>בחירת מפגש מתוכנן מהפעילות</span><select data-io-pick-meeting '+(!editable()?'disabled':'')+'>'+
    '<option value="">בחרו מפגש ותאריך…</option>'+
    meetings.map(m=>'<option value="'+m.number+'" '+(String(d.meeting)===String(m.number) && d.meeting_source_date===m.date?'selected':'')+'>'+
      'מפגש '+m.number+' — '+e(shortMeetingDate(m.date))+'</option>').join('')+
    '</select></label>';
}
function refreshMeetingPicker() {
  const holder=root?.querySelector('[data-io-meeting-picker]');
  if(holder) holder.innerHTML=meetingPickerMarkup();
}

/** Populate only facts already held in the chosen activity. Never invent a meeting number. */
function observationActivityPrefill(activity, observationDate) {
  const grade=String(activity?.grade || '').trim();
  const group=String(activity?.class_group || '').trim();
  const className=grade && group ? grade+' · '+(/^[0-9]+$/.test(group) ? 'קבוצה '+group : group) : grade || group;
  const date=String(observationDate || '').slice(0,10);
  let meeting='';
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
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
function showActivityPrefillStatus(data, {proposedDate=false}={}) {
  const activity=selectedActivityOption();
  const meetings=scheduledMeetings(activity);
  const problems=[];
  if (!data.class) problems.push('הכיתה אינה מופיעה בפעילות');
  if (!data.meeting) problems.push(meetings.length ? 'התאריך אינו תואם למפגש מתוכנן: בחרו מפגש מהרשימה או הזינו מספר ידנית' :
    'לא קיימים מועדי מפגשים בפעילות: יש למלא מספר ידנית');
  let message=problems.length ? 'הפרטים הקיימים מולאו. '+problems.join('; ')+'.' :
    'פרטי הקורס, בית הספר, הכיתה ומספר המפגש מולאו מהפעילות.';
  if(proposedDate) message='נבחר באופן אוטומטי מפגש '+data.meeting+' בתאריך '+shortMeetingDate(data.meeting_source_date)+
    ' כמועד מתוכנן לתצפית (לא אישור ביצוע). יש לאמת או לשנות את המועד לפני השלמת המשוב. '+(problems.length?problems.join('; '):'');
  const el=root?.querySelector('[data-io-activity-info]');
  if(el) el.textContent=message;
}
function applyActivityPrefill(activity) {
  if(!activity || !selected || !editable()) return;
  let data=observationActivityPrefill(activity,selected.observation_date);
  let proposedDate=false;
  // A new draft initially contains today's date, not an intentional observation date.
  // Offer the next *actual scheduled* meeting and its date instead of leaving the
  // meeting field empty, but never override a date explicitly entered by the observer.
  if(!data.meeting && !selected.details?.observation_date_manual) {
    const next=scheduledMeetings(activity).find(m=>m.date>=String(selected.observation_date || '').slice(0,10));
    if(next) {
      selected.observation_date=next.date;
      data=observationActivityPrefill(activity,next.date);
      setObservationDetailValue('date',next.date);
      proposedDate=true;
    }
  }
  selected.details={...selected.details,...data};
  for(const key of ['course','school','class','meeting']) setObservationDetailValue(key,data[key]);
  refreshMeetingPicker();
  showActivityPrefillStatus(data,{proposedDate});
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
  refreshMeetingPicker();
  showActivityPrefillStatus({...next,class:d.class});
}

function detailScreen() {
  const d=selected.details || {};
  const pickOptions = activityOptions.map((a,i)=> {
    const first=scheduledMeetings(a)[0];
    const title=(a.activity_name || a.program_name || 'פעילות')+' · '+(a.school || '')+
      ' · '+(a.authority || '')+' · '+(a.grade || '')+' '+(a.class_group || '')+
      (first?' · מפגש ראשון '+shortMeetingDate(first.date):'');
    return '<option value="'+i+'" '+(String(d.activity_row_id || '')===String(a.row_id)?'selected':'')+'>'+e(title)+'</option>';
  }).join('');
  return '<h3>פרטי התצפית — לפני תחילת השיעור</h3><p class="io-muted">בחרו פעילות קיימת כדי למלא אוטומטית את הקורס, בית הספר, הכיתה ומספר המפגש אם תאריך התצפית תואם למועד במערכת. יש לאמת את הפרטים.</p>'+
    (activityOptions.length ? '<label class="io-field"><span>מילוי מתוך פעילות קיימת (לבחירה)</span><select data-io-pick-activity '+(!editable()?'disabled':'')+'><option value="">בחרו פעילות…</option>'+pickOptions+'</select></label><div data-io-meeting-picker>'+meetingPickerMarkup()+'</div><p class="io-muted" data-io-activity-info role="status">יש לוודא את מועד התצפית בפועל; מספר התלמידים ונוכחות צוות בית הספר ממולאים לפי מה שנצפה.</p>' : '')+
    '<div class="io-fields">'+field('תאריך צפייה','date','date',true,selected.observation_date || '')+field('שם הצופה','observer','text',true,selected.observer_name || '')+
    field('שם הקורס','course','text',true,d.course || '')+field('מספר מפגש','meeting','number',true,d.meeting || '')+
    field('בית הספר','school','text',true,d.school || '')+field('כיתה','class','text',true,d.class || '')+
    field('מספר תלמידים','students','number',true,d.students || '')+
    '<label class="io-field"><span>נוכחות צוות בית הספר <em>חובה</em></span><select data-io-detail="school_staff" '+(!editable()?'disabled':'')+'><option value="">בחרו…</option><option value="כן" '+(d.school_staff==='כן'?'selected':'')+'>כן</option><option value="לא" '+(d.school_staff==='לא'?'selected':'')+'>לא</option></select></label></div>'+
    '<label class="io-field"><span>מידע חשוב לצופה לפני תחילת השיעור (אם יש)</span><textarea data-io-detail="important" rows="3" '+(!editable()?'disabled':'')+'>'+e(d.important||'')+'</textarea></label>';
}
function sectionScreen(index) {
  const s=SECTIONS[index];
  return '<div class="io-stage-heading"><div><span class="io-stage-eyebrow">תחום הערכה '+(index+1)+' מתוך '+SECTIONS.length+'</span>'+
    '<h3>'+e(s.title)+'</h3><p class="io-muted">'+e(s.help)+'</p></div></div>'+
    (s.questions.some(q=>gradedChoices(q[1]))?'<div class="io-rating-key"><strong>סולם ההערכה:</strong> '+
      RATING_OPTIONS.map(([v,label])=>'<span>'+v+' – '+e(label)+'</span>').join('')+'</div>':'')+
    '<div class="io-question-list">'+
    s.questions.map((q,i)=>choice(index+'-'+i,q[0],q[1])).join('')+'</div>'+
    '<label class="io-field io-section-comment"><span>הערות ודוגמאות מהצפייה (לא חובה)</span>'+
    '<textarea data-io-comment="'+index+'" rows="4" placeholder="מה ראיתם בפועל? מה כדאי לשמר או לשפר?" '+
    (!editable()?'disabled':'')+'>'+e(selected.comments?.[index]||'')+'</textarea></label>';
}
function summaryScreen() {
  return '<h3>סיכום המשוב</h3><p class="io-muted">הדירוג הכולל הוא הערכת המנהל ואינו ממוצע אוטומטי של סולמות התשובה השונים.</p>'+
    '<fieldset class="io-question io-question--rating"><legend>דירוג כולל של ביצועי המדריך בשיעור</legend><div class="io-options io-options--rating">'+RATING_OPTIONS.map(([n,label])=>
      '<label class="io-option"><input type="radio" name="io-overall" data-io-overall value="'+n+'" '+(Number(selected.overall_rating)===Number(n)?'checked ':'')+(!editable()?'disabled':'')+'><span>'+n+' – '+e(label)+'</span></label>').join('')+'</div></fieldset>'+
    [['strengths','נקודות כוח'],['improvements','נקודות לשיפור'],['summary','סיכום מקצועי וחוות דעת']].map(([key,label])=>
      '<label class="io-field"><span>'+e(label)+' <em>חובה</em></span><textarea rows="5" data-io-text="'+key+'" '+(!editable()?'disabled':'')+'>'+e(selected[key]||'')+'</textarea></label>').join('');
}
/** One canonical completion summary powers the final review and validation. */
function completionRows() {
  const d=selected?.details || {};
  const present=value=>String(value ?? '').trim().length>0;
  const validPositive=value=>/^[1-9]\d*$/.test(String(value ?? ''));
  const details=[
    ['תאריך הצפייה',present(selected?.observation_date)],
    ['שם הצופה',present(selected?.observer_name)],
    ['שם הקורס',present(d.course)],
    ['מספר מפגש',validPositive(d.meeting)],
    ['בית הספר',present(d.school)],
    ['כיתה',present(d.class)],
    ['מספר תלמידים',validPositive(d.students)],
    ['נוכחות צוות בית הספר',['כן','לא'].includes(d.school_staff)]
  ];
  const rows=[{
    stage:1,label:'פרטי התצפית',complete:details.every(([,ok])=>ok),
    count:details.filter(([,ok])=>ok).length,total:details.length,
    missing:details.filter(([,ok])=>!ok).map(([name])=>name)
  }];
  for(let i=0;i<SECTIONS.length;i++) {
    const s=SECTIONS[i];
    const questions=s.questions.map((q,j)=>q[1].includes(selected?.responses?.[i+'-'+j]));
    rows.push({
      stage:i+2,label:s.title,complete:questions.every(Boolean),
      count:questions.filter(Boolean).length,total:questions.length,
      missing:questions.flatMap((ok,j)=>ok?[]:['מדד '+(j+1)])
    });
  }
  const summary=[
    ['דירוג כולל',Number.isInteger(Number(selected?.overall_rating)) && Number(selected?.overall_rating)>=1 && Number(selected?.overall_rating)<=5],
    ['נקודות כוח',present(selected?.strengths)],['נקודות לשיפור',present(selected?.improvements)],
    ['חוות דעת מסכמת',present(selected?.summary)]
  ];
  rows.push({
    stage:8,label:'סיכום המשוב',complete:summary.every(([,ok])=>ok),
    count:summary.filter(([,ok])=>ok).length,total:summary.length,
    missing:summary.filter(([,ok])=>!ok).map(([name])=>name)
  });
  return rows;
}
function overview() {
  const d=selected.details||{};
  const rows=completionRows();
  const missing=rows.filter(row=>!row.complete);
  const intro=selected.status==='completed'
    ? 'המשוב הושלם וננעל לעריכה. ניתן להפיק דו"ח PDF.'
    : missing.length
      ? 'נותרו '+missing.length+' שלבים להשלמה. לחצו על כל שלב המסומן "דורש השלמה" כדי לחזור אליו ישירות, ולאחר מכן חזרו לסיכום.'
      : 'כל שדות החובה מולאו. ניתן לחזור לערוך כל שלב לפני סיום ושמירת המשוב.';
  const rowHtml=row=>{
    const status=row.complete?'הושלם':'דורש השלמה';
    const info=row.count+' מתוך '+row.total+' שדות מולאו'+
      (row.missing.length?' · חסר: '+row.missing.join(', '):'');
    const children='<strong>'+e(row.label)+'</strong><span class="io-review-result">'+
      '<span class="io-review-state '+(row.complete?'is-complete':'is-incomplete')+'">'+e(status)+'</span>'+
      '<small>'+e(info)+'</small>'+(editable()?'<span class="io-review-link">'+(row.complete?'עריכה':'מעבר להשלמה')+' ←</span>':'')+'</span>';
    return editable()
      ? '<button type="button" class="io-overview io-review-row '+(row.complete?'is-complete':'is-incomplete')+'" data-io-action="jump" data-io-jump="'+row.stage+'" aria-label="'+e(row.label+': '+status+'; מעבר לשלב')+'">'+children+'</button>'
      : '<div class="io-overview io-review-row is-readonly">'+children+'</div>';
  };
  return '<h3>בדיקה לפני סיום והפקת דו"ח</h3><p class="io-muted">'+e(intro)+'</p>'+
    '<div class="io-overview"><strong>'+e(selected.instructor_name)+'</strong><span>'+
      e(selected.observation_date)+' · '+e(d.school || 'ללא בית ספר')+' · '+e(d.course || 'ללא קורס')+'</span></div>'+
    '<div class="io-review-list" aria-label="מצב השלמת שלבי התצפית">'+rows.map(rowHtml).join('')+'</div>'+
    (selected.status==='completed' ? '<p class="io-success">המשוב הושלם ונשמר. ניתן להפיק דו"ח PDF.</p>'+sharepointStatusHtml() :
      missing.length ? '<p class="io-review-reminder" role="status">לא ניתן לסיים את המשוב עד להשלמת '+missing.length+' שלבים.</p>' :
      '<p class="io-success">כל שדות החובה הושלמו. אפשר לסיים ולשמור את המשוב.</p>');
}
async function checkSharePointReceipt(observationId) {
  if(!observationId || !supabase?.functions?.invoke)return;
  const {data,error}=await supabase.functions.invoke('instructor-observation-sharepoint',{
    body:{action:'status',observation_id:observationId}
  });
  if(error || data?.error)return;
  if(selected?.id!==observationId || selected?.status!=='completed' || !isOpen)return;
  sharepointReceipt=data?.saved ? data : null;
  if(stage===9)render();
  // Previously completed observations (before this feature was deployed) need
  // the same automatic archival as newly completed reports. Saving is idempotent
  // on the server, so reopening can safely recover a missing SharePoint PDF.
  if(!sharepointReceipt && stage===9)void saveSharePointPdf();
}
async function sharePointErrorText(error,data) {
  if(data?.error)return String(data.error);
  const response=error?.context;
  if(response?.clone) {
    try {
      const body=await response.clone().json();
      const detail=body?.error || body?.message || body?.detail;
      if(detail)return String(detail);
    } catch {}
    if(response.status)return 'שגיאת שירות PDF (HTTP '+response.status+')';
  }
  return String(error?.message || 'שמירת PDF ב־SharePoint נכשלה');
}
async function saveSharePointPdf() {
  if(!selected || selected.status!=='completed' || sharepointBusy)return false;
  const id=selected.id;
  sharepointBusy=true;sharepointError='';
  if(stage===9)render();
  status('שומר PDF בתיקייה האישית ב־SharePoint…');
  try {
    if(!supabase?.functions?.invoke)throw new Error('שירות שמירת SharePoint אינו זמין');
    const {data,error}=await supabase.functions.invoke('instructor-observation-sharepoint',{
      body:{action:'save',observation_id:id}
    });
    if(error || data?.error)throw new Error(await sharePointErrorText(error,data));
    if(!data?.saved || !data?.url)throw new Error('לא התקבל אישור שמירה מ־SharePoint');
    if(selected?.id!==id)return false;
    sharepointReceipt=data;sharepointError='';
    return true;
  } catch(err) {
    if(selected?.id===id)sharepointError=String(err?.message || err);
    return false;
  } finally {
    sharepointBusy=false;
    if(selected?.id===id && stage===9){
      render();
      status(sharepointReceipt?'הדוח נשמר ב־SharePoint בתיקיית התצפית של המדריך.':
        'משוב התצפית נשמר במערכת, אך שמירת ה־PDF ב־SharePoint נכשלה: '+sharepointError,!sharepointReceipt);
    }
  }
}
function sharepointStatusHtml() {
  if(!selected || selected.status!=='completed')return '';
  if(sharepointReceipt?.saved)return '<p class="io-sp-saved">ה־PDF נשמר בתיק האישי: <a target="_blank" rel="noopener noreferrer" href="'+
    e(sharepointReceipt.url)+'">'+e(sharepointReceipt.file_name || 'פתיחת PDF ב־SharePoint')+'</a></p>';
  if(sharepointBusy)return '<p class="io-muted">שומר PDF בתיקיית התצפית ב־SharePoint…</p>';
  return '<p class="io-sp-warning">'+(sharepointError?'שמירת ה־PDF נכשלה: '+e(sharepointError)+'. אפשר לנסות שוב.':'ה־PDF עדיין לא נשמר ב־SharePoint.')+'</p>';
}

function printedQuestion(question,key) {
  const [label,choices]=question;
  const current=String(selected.responses?.[key] || '');
  const legacy=current && !choices.includes(current);
  const grade=gradedChoices(choices);
  return '<div class="io-report-question"><div class="io-report-question-title"><strong>'+e(label)+
    '</strong><span>'+e(responseLabel(current,choices))+'</span></div>'+
    (legacy?'<p class="io-report-legacy">התשובה ניתנה לפי סולם קודם; לא הוסב לה דירוג מספרי.</p>':
    '<div class="io-report-choices'+(grade?' io-report-choices--rating':'')+'">'+
      choices.map(value=>'<span class="io-report-choice'+(current===value?' is-selected':'')+'">'+
        '<span class="io-report-check" aria-hidden="true">'+(current===value?'☒':'☐')+'</span> '+
        e(grade?ratingText(value):value)+'</span>').join('')+'</div>')+
    '</div>';
}
function report() {
  const d=selected.details||{};
  const facts=[
    ['שם המדריך',selected.instructor_name],['תאריך הצפייה',selected.observation_date],
    ['שם הצופה',selected.observer_name],['שם הקורס',d.course],
    ['מספר מפגש',d.meeting],['בית הספר',d.school],
    ['כיתה',d.class],['מספר תלמידים',d.students],
    ['נוכחות צוות בית הספר',d.school_staff],['מידע מקדים',d.important]
  ];
  return '<div class="io-report"><header><h1>תעשיידע · משוב תצפית '+
    Number(selected.details?.observation_slot || observationSlot)+' – צפייה והערכת מדריך</h1>'+
    '<p>דו"ח תצפית מקצועי · שנת הלימודים תשפ״ז</p></header>'+
    '<section class="io-report-details"><h2>פרטי התצפית</h2><table><tbody>'+
    facts.map(([k,v])=>'<tr><th>'+e(k)+'</th><td>'+e(v||'—')+'</td></tr>').join('')+
    '</tbody></table></section>'+
    '<div class="io-report-rating-key"><strong>סולם ההערכה:</strong> '+
    RATING_OPTIONS.map(([n,label])=>'<span>'+n+' – '+e(label)+'</span>').join('')+
    '</div>'+
    SECTIONS.map((s,i)=>'<section class="io-report-section"><h2>'+(i+1)+'. '+e(s.title)+'</h2>'+
      s.questions.map((q,j)=>printedQuestion(q,i+'-'+j)).join('')+
      (selected.comments?.[i]?'<p class="io-report-notes"><strong>הערות ודוגמאות:</strong> '+
        e(selected.comments[i])+'</p>':'')+'</section>').join('')+
    '<section class="io-report-section"><h2>סיכום מקצועי</h2>'+
    '<p><strong>דירוג כולל:</strong> '+
      e(selected.overall_rating?selected.overall_rating+' – '+RATING_LABELS[selected.overall_rating]:'—')+'</p>'+
    '<h3>נקודות כוח</h3><p>'+e(selected.strengths||'—')+'</p>'+
    '<h3>נקודות לשיפור</h3><p>'+e(selected.improvements||'—')+'</p>'+
    '<h3>חוות דעת מסכמת</h3><p>'+e(selected.summary||'—')+'</p></section>'+
    '<footer>תאריך הפקת הדו"ח: '+e(localDate())+' · נוצר במערכת תעשיידע</footer></div>';
}
function render() {
  if (!selected) return home();
  const done=selected.status==='completed';
  if(stage===9) reviewReached=true;
  const stages=['הקדמה','פרטי התצפית',...SECTIONS.map(s=>s.title),'סיכום','בדיקה והפקה'];
  const body = stage===0 ? '<div class="io-lead"><h3>לפני שמתחילים — מטרת התצפית</h3><p>המשוב נועד להעריך את איכות ההדרכה בפועל, לזהות חוזקות ותחומים לשיפור ולבסס ליווי מקצועי.</p></div><h3>הנחיות לצופה</h3><ol><li>יש ליידע את המדריך מראש על מועד התצפית, מטרותיה ומדדי ההערכה.</li><li>יש לתעד רק מה שנצפה בפועל ובאופן ענייני ומדויק.</li><li>רצוי לציין דוגמאות קונקרטיות בכל תחום.</li><li>בסיום יש לכתוב נקודות כוח, נקודות לשיפור וחוות דעת מסכמת.</li><li>אפשר לשמור טיוטה בכל שלב. הדו"ח זמין למנהל בלבד ואינו נשלח אוטומטית למדריך.</li></ol>' :
    stage===1 ? detailScreen() : stage>=2&&stage<=7 ? sectionScreen(stage-2) : stage===8 ? summaryScreen() : overview();
  const footer = '<footer class="io-actions"><button type="button" class="io-secondary" data-io-action="home">לכל התצפיות</button><div class="io-actions-main">'+
    (stage>0?'<button type="button" class="io-secondary" data-io-action="back">הקודם</button>':'')+
    (reviewReached && stage!==9 && editable()?'<button type="button" class="io-secondary" data-io-action="review">חזרה לסיכום</button>':'')+
    (stage<9?'<button type="button" class="io-primary" data-io-action="next">המשך</button>':'')+
    (stage===9 && editable()?'<button type="button" class="io-primary" data-io-action="finish">סיום ושמירת המשוב</button>':'')+
    (stage===9 && done?'<button type="button" class="io-primary" data-io-action="print">הפקת PDF</button>':'')+
    (stage===9 && done && !sharepointReceipt?'<button type="button" class="io-secondary" data-io-action="sharepoint" '+(sharepointBusy?'disabled':'')+'>שמירה ב־SharePoint</button>':'')+
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
  const firstMissing=completionRows().find(row=>!row.complete);
  if (!firstMissing) return '';
  return 'נדרש להשלים את השלב: '+firstMissing.label+'. לחצו על השורה המתאימה בסיכום כדי לחזור אליו.';
}

async function onClick(event) {
  const button=event.target.closest('[data-io-action], [data-io-resume]');
  if (!button) return;
  const action=button.dataset.ioAction;
  if (button.dataset.ioResume) return resume(button.dataset.ioResume);
  if (action==='close') return close();
  if (action==='new') return create();
  if (action==='print') { if (selected?.status==='completed') window.print(); return; }
  if (action==='sharepoint') { if(selected?.status==='completed')await saveSharePointPdf();return; }
  if (['home','next','back','finish','jump','review'].includes(action)) {
    if (action==='jump') {
      const destination=Number(button.dataset.ioJump);
      if (stage!==9 || !editable() || !Number.isInteger(destination) || destination<1 || destination>8) return;
    }
    if (action==='review' && (!reviewReached || stage===9 || !editable())) return;
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
      else if (action==='jump') {stage=Number(button.dataset.ioJump);render();}
      else if (action==='review') {stage=9;render();}
      else if (action==='finish') {stage=9;render();await saveSharePointPdf();}
    } catch(err) { button.disabled=false;status('השמירה נכשלה: '+(err?.message||err),true); }
  }
}
function onInput(event) {
  if (!editable()) return;
  const target=event.target;
  if(event.type==='input' && target.matches('[data-io-pick-activity],[data-io-pick-meeting]')) return;
  if (target.matches('[data-io-pick-activity]')) {
    const idx=Number(target.value);
    const activity=target.value!==''?activityOptions[idx]:null;
    if(activity) applyActivityPrefill(activity);
    else if(selected?.details) {
      delete selected.details.activity_row_id;
      delete selected.details.meeting_source_date;
      refreshMeetingPicker();
      const info=root?.querySelector('[data-io-activity-info]');
      if(info) info.textContent='הפעילות נותקה. אפשר למלא או לערוך את הפרטים ידנית.';
    }
  }
  if (target.matches('[data-io-pick-meeting]')) {
    const activity=selectedActivityOption();
    const meeting=scheduledMeetings(activity).find(m=>String(m.number)===target.value);
    if(meeting) {
      selected.observation_date=meeting.date;
      selected.details={...selected.details,meeting:String(meeting.number),
        meeting_source_date:meeting.date,observation_date_manual:true};
      setObservationDetailValue('date',meeting.date);
      setObservationDetailValue('meeting',meeting.number);
      showActivityPrefillStatus({...selected.details,class:selected.details.class});
    }
  }
  if (target.matches('[data-io-detail="meeting"]')) {
    if (selected?.details) delete selected.details.meeting_source_date;
    refreshMeetingPicker();
  }
  if (target.matches('[data-io-detail="date"]')) {
    selected.details={...selected.details,observation_date_manual:true};
    capture();
    refreshMeetingForDate();
  }
  if (!target.closest('[data-io-detail],[data-io-answer],[data-io-comment],[data-io-overall],[data-io-text],[data-io-pick-activity],[data-io-pick-meeting]')) return;
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

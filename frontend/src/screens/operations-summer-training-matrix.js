import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import { getActivityName, activityMatchesPeriod, activityOverlapsDateRange, isActivityDeleted } from './shared/operations-activity-helpers.js';
import { ACTIVITY_SEASON_SUMMER_2026 } from './shared/summer-activity.js';

const KEY='opsSummerTrainingActive';
const FROM='2026-06-15';
const TO='2026-08-31';
const RANGE_LABEL='15.6.26 עד 31.8.26';
const ACTIVITY_COL_PERCENT=18;
let queued=false,busy=false,token=0;
const clean=(v)=>String(v||'').trim();
const norm=(v)=>clean(v).replace(/[״"]/g,'').replace(/[׳']/g,'').replace(/[\u2010-\u2015]/g,'-').replace(/\s+/g,' ').toLowerCase();
const keyOf=(w,i)=>`${norm(w)}|${norm(i)}`;
const sortHe=(arr)=>Array.from(new Set(arr.map(clean).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'he',{numeric:true}));
const validInstructor=(v)=>clean(v)&&!['לא משויך','ללא שיוך','-'].includes(clean(v));
const isTamir=(v)=>norm(v).includes('תמיר');
const isEscapeRoomType=(v)=>{const n=norm(v);return n==='escape_room'||n.includes('escape_room')||n.includes('escape room')||n.includes('חדר בריחה');};
const activityIsEscapeRoom=(row)=>isEscapeRoomType(row?.activity_type)||isEscapeRoomType(row?.item_type);
const workshopName=(row)=>clean(getActivityName(row)||row.activity_name||row.name||row.title||row.program_name);
const instructorNames=(row)=>sortHe([row.instructor_name,row.instructor_name_2,row.instructor,row.guide_name,row.guide].filter(validInstructor));

function addStyle(){
  if(document.getElementById('ops-training-matrix-style'))return;
  const s=document.createElement('style');
  s.id='ops-training-matrix-style';
  s.textContent=`
    .ops-trx{direction:rtl;background:#fff;border:1px solid #d8e5ee;border-radius:16px;overflow:hidden;width:min(1160px,96%);margin:0 auto;box-shadow:0 1px 2px rgba(15,23,42,.04)}
    .ops-trx-h{padding:14px 16px;background:#f8fbfd;border-bottom:1px solid #e2e8f0}.ops-trx-h h2{margin:0;font-size:18px;color:#0f172a}
    .ops-trx-wrap{overflow-y:auto;overflow-x:hidden;max-height:70vh;width:100%}.ops-trx table{border-collapse:collapse;table-layout:fixed;background:#fff;font-size:12px;width:100%}.ops-trx th,.ops-trx td{border:1px solid #cbd5e1;padding:0;text-align:center;vertical-align:middle;box-sizing:border-box;overflow:hidden;background:#fff}.ops-trx th{height:44px;line-height:44px;background:#f1f5f9;font-weight:800;color:#111827}.ops-trx tbody td{height:38px;line-height:38px}.ops-trx thead th{position:sticky;top:0;z-index:5;box-shadow:0 2px 0 rgba(148,163,184,.32)}.ops-trx tr:nth-child(even) td{background:#f8fafc}
    .ops-trx-workshop{position:sticky;right:0;z-index:2;text-align:right!important;padding-inline:10px!important;font-weight:800;color:#0f172a;background:#fff!important}.ops-trx th.ops-trx-workshop{z-index:7;text-align:right!important;background:#f1f5f9!important}.ops-trx-guide{min-width:0}.ops-trx-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ops-trx tbody .ops-trx-name{line-height:38px}.ops-trx thead .ops-trx-name{line-height:44px}
    .ops-trx-mark{font-size:22px;font-weight:900;line-height:38px;display:inline-flex;width:100%;height:38px;align-items:center;justify-content:center}.ops-trx-ok{color:#16a34a}.ops-trx-warn{color:#ef4444}
    .ops-trx-section td{height:38px;line-height:38px;background:#dff5fb!important;color:#075985;font-weight:900;text-align:right!important;padding-inline:14px!important;border-top:4px solid var(--ds-accent,#0292b7)!important;border-bottom:2px solid var(--ds-accent,#0292b7)!important}.ops-trx-section-title{position:static!important;text-align:right!important;background:#dff5fb!important}
    .ops-trx-legend{display:flex;gap:12px;flex-wrap:wrap;padding:10px 16px;color:#475569;font-size:12px;border-top:1px solid #e2e8f0;background:#f8fbfd}.ops-trx-msg{padding:20px;text-align:center;font-weight:700;color:#475569}.ops-trx-err{color:#b91c1c;background:#fef2f2}
  `;
  document.head.appendChild(s);
}
async function loadTrainings(){
  const res=await supabase.from('summer_workshop_trainings').select('workshop_name,instructor_name,is_trained').eq('is_trained',true);
  if(res.error)throw res.error;
  return Array.isArray(res.data)?res.data:[];
}
async function loadActivities(){
  const res=await supabase.from('activities').select('*');
  if(res.error)throw res.error;
  return (Array.isArray(res.data)?res.data:[])
    .filter((row)=>!isActivityDeleted(row))
    .filter((row)=>!['בוטל','מבוטל','נמחק'].includes(clean(row.status)))
    .filter((row)=>activityMatchesPeriod(row,ACTIVITY_SEASON_SUMMER_2026))
    .filter((row)=>activityOverlapsDateRange(row,FROM,TO))
    .filter((row)=>!isTamir(workshopName(row)));
}
function buildModel(activities,trainings){
  const trained=new Set(),assigned=new Map(),workshops=[],escapeWorkshops=[],instructors=[],escapeByWorkshop=new Set();
  activities.forEach((row)=>{const w=workshopName(row);if(!w||isTamir(w))return;if(activityIsEscapeRoom(row))escapeByWorkshop.add(norm(w));});
  const addWorkshop=(v,isEscape=false)=>{const w=clean(v);if(!w||isTamir(w))return;(isEscape||escapeByWorkshop.has(norm(w))?escapeWorkshops:workshops).push(w);};
  const addInstructor=(v)=>{if(validInstructor(v))instructors.push(clean(v));};
  trainings.forEach((row)=>{const w=clean(row.workshop_name),i=clean(row.instructor_name);if(!w||isTamir(w)||!validInstructor(i))return;addWorkshop(w);addInstructor(i);trained.add(keyOf(w,i));});
  activities.forEach((row)=>{const w=workshopName(row);if(!w||isTamir(w))return;addWorkshop(w,activityIsEscapeRoom(row));instructorNames(row).forEach((i)=>{addInstructor(i);const k=keyOf(w,i);assigned.set(k,(assigned.get(k)||0)+1);});});
  return{workshops:sortHe(workshops),escapeWorkshops:sortHe(escapeWorkshops),instructors:sortHe(instructors),trained,assigned};
}
function cell(model,w,i){
  const k=keyOf(w,i),count=model.assigned.get(k)||0;
  if(model.trained.has(k)){const note=count?`${count} שיבוצים בטווח ${RANGE_LABEL}`:`ללא שיבוץ בטווח ${RANGE_LABEL}`;return `<td class="ops-trx-guide" title="${escapeHtml(`${w} — ${i}: עבר הכשרה · ${note}`)}"><span class="ops-trx-mark ops-trx-ok">✓</span></td>`;}
  if(count>0)return `<td class="ops-trx-guide" title="${escapeHtml(`${w} — ${i}: משובץ ללא הכשרה · ${count} שיבוצים בטווח ${RANGE_LABEL}`)}"><span class="ops-trx-mark ops-trx-warn">!</span></td>`;
  return '<td class="ops-trx-guide"></td>';
}
function rowHtml(model,w){return `<tr><td class="ops-trx-workshop" title="${escapeHtml(w)}"><span class="ops-trx-name">${escapeHtml(w)}</span></td>${model.instructors.map((i)=>cell(model,w,i)).join('')}</tr>`;}
function sectionRow(title,count){return `<tr class="ops-trx-section"><td class="ops-trx-section-title" colspan="${count+1}">${escapeHtml(title)}</td></tr>`;}
function colgroup(model){
  const guideCount=Math.max(model.instructors.length,1);
  const guidePercent=(100-ACTIVITY_COL_PERCENT)/guideCount;
  return `<colgroup><col style="width:${ACTIVITY_COL_PERCENT}%">${model.instructors.map(()=>`<col style="width:${guidePercent}%">`).join('')}</colgroup>`;
}
function html(model){
  const rowsCount=model.workshops.length+model.escapeWorkshops.length;
  const head=`<tr><th class="ops-trx-workshop">שם הפעילות</th>${model.instructors.map((i)=>`<th class="ops-trx-guide" title="${escapeHtml(i)}"><span class="ops-trx-name">${escapeHtml(i)}</span></th>`).join('')}</tr>`;
  const regular=model.workshops.map((w)=>rowHtml(model,w)).join('');
  const escape=model.escapeWorkshops.length?sectionRow('חדרי בריחה',model.instructors.length)+model.escapeWorkshops.map((w)=>rowHtml(model,w)).join(''):'';
  const body=regular+escape;
  const table=rowsCount&&model.instructors.length?`<div class="ops-trx-wrap"><table>${colgroup(model)}<thead>${head}</thead><tbody>${body}</tbody></table></div>`:'<div class="ops-trx-msg">לא נמצאו הכשרות או שיבוצים להצגה</div>';
  return `<section class="ops-trx" dir="rtl"><div class="ops-trx-h"><h2>הכשרות קיץ</h2></div>${table}<div class="ops-trx-legend"><span><strong class="ops-trx-mark ops-trx-ok">✓</strong> עבר הכשרה לסדנה</span><span><strong class="ops-trx-mark ops-trx-warn">!</strong> משובץ ללא הכשרה</span></div></section>`;
}
function setActive(root,active){root?.querySelectorAll?.('.ds-ops-mgmt-tab').forEach((btn)=>{const mine=btn.hasAttribute('data-ops-training-tab');btn.classList.toggle('is-active',active&&mine);if(active||mine)btn.setAttribute('aria-pressed',active&&mine?'true':'false');});}
async function render(root,force=false){
  if(!root||busy)return;
  const container=root.querySelector('.ds-ops-mgmt-content');
  if(!container)return;
  if(!force&&container.querySelector('.ops-trx'))return;
  const current=++token;busy=true;addStyle();setActive(root,true);
  container.innerHTML='<section class="ops-trx" dir="rtl"><div class="ops-trx-msg">טוען הכשרות קיץ...</div></section>';
  try{const [activities,trainings]=await Promise.all([loadActivities(),loadTrainings()]);if(current!==token)return;container.innerHTML=html(buildModel(activities,trainings));}
  catch(e){if(current!==token)return;console.warn('[summer-training-matrix]',e?.message||e);container.innerHTML=`<section class="ops-trx" dir="rtl"><div class="ops-trx-msg ops-trx-err">לא ניתן לטעון את נתוני הכשרות הקיץ כרגע. ${escapeHtml(e?.message||'')}</div></section>`;}
  finally{busy=false;}
}
function ensureTab(){
  const root=document.querySelector('.ds-ops-mgmt-screen'),nav=root?.querySelector?.('.ds-ops-mgmt-tabs');
  if(!root||!nav)return;
  let button=nav.querySelector('[data-ops-training-tab]');
  if(!button){button=document.createElement('button');button.type='button';button.className='ds-exceptions-tab ds-ops-mgmt-tab';button.textContent='הכשרות קיץ';button.setAttribute('data-ops-training-tab','1');button.setAttribute('aria-pressed','false');nav.appendChild(button);}
  if(!button.dataset.opsTrainingBound){button.dataset.opsTrainingBound='1';button.addEventListener('click',()=>{sessionStorage.setItem(KEY,'1');render(root,true);});}
  nav.querySelectorAll('[data-ops-tab]').forEach((b)=>{if(b.dataset.opsTrainingClearBound)return;b.dataset.opsTrainingClearBound='1';b.addEventListener('click',()=>sessionStorage.removeItem(KEY),{capture:true});});
  if(sessionStorage.getItem(KEY)==='1'){setActive(root,true);render(root,false);}
}
function schedule(){if(queued)return;queued=true;setTimeout(()=>{queued=false;ensureTab();},80);}
if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});
  else schedule();
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
}

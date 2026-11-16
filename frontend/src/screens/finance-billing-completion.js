import { escapeHtml } from './shared/html.js';
import { defaultGefenCourseRate, isGefenFundingName } from '../course-hourly-pricing.js';
const esc=value=>escapeHtml(String(value??''));
const key=value=>String(value??'');
const money=value=>Number(value||0).toLocaleString('he-IL',{maximumFractionDigits:2});
const course=row=>String(row?.activity_type||'').toLowerCase()==='course';
const approvedGefenRate=rows=>rows.find(r=>r.gefenFunding&&Number(r.approvedGefenRate)>0)?.approvedGefenRate;
const hasGefenFunding=(a,rows)=>rows.some(r=>r.gefenFunding)||(!rows.length&&String(a.funding||'').split('+').some(isGefenFundingName));
const missingCourseRate=(a,rows,mode='editable')=>mode!=='manual'&&hasGefenFunding(a,rows)&&!Number(a.course_hourly_rate)&&!approvedGefenRate(rows);
const gefenRateGap=rows=>rows.some(r=>r.gefenFunding&&Number(r.approvedGefenRate)>0&&Number(r.fundingAmount)>Math.round(Number(r.approvedGefenRate)*Number(r.plannedHours)*100)/100+0.02);
export function financeIncompleteBillingActivities(data,mode) {
  const rows=data.transactionContext?.billingRows||[];
  return (data.collectionActivities||[]).filter(a=>{
    const matches=rows.filter(r=>key(r.activityRowId)===key(a.row_id));
    const relevant=mode==='editable'||matches.some(r=>r.gefenFunding===(mode==='automatic')||!r.fundingSourceId)
      || (!matches.length && (mode==='automatic'?isGefenFundingName(a.funding):!isGefenFundingName(a.funding)));
    if(!relevant)return false;
    return (course(a)&&(missingCourseRate(a,matches,mode)||!Number.isInteger(Number(a.sessions))||Number(a.sessions)<1||Number(a.sessions)>35))
      || !Number(a.price)
      || (mode!=='manual'&&gefenRateGap(matches))
      || matches.some(r=>r.blockedReason&&(r.gefenFunding||!/חסר מחיר שעתי/.test(r.blockedReason))&&r.eligibilityStatus!=='waiting_three_meetings'
        && (mode==='editable'||r.gefenFunding===(mode==='automatic')||!r.fundingSourceId)
        && !['הפקה בתהליך','חלק המממן חויב במלואו'].includes(r.blockedReason));
  });
}
export function financeBillingMissingReasons(activity, billingRows=[]) {
  const matches=billingRows.filter(r=>key(r.activityRowId)===key(activity.row_id));
  const reasons=new Set();
  const add=reason=>{if(reason)reasons.add(reason);};
  if(course(activity)){
    if(missingCourseRate(activity,matches))add('מחיר שעתי לגפ״ן');
    const sessions=Number(activity.sessions);
    if(!Number.isInteger(sessions)||sessions<1||sessions>35)add('מספר מפגשים');
  }
  if(!Number(activity.price))add('מחיר כולל');
  if(gefenRateGap(matches))add('פער בין מסגרת גפ״ן לתעריף × שעות — נדרש בירור');
  for(const row of matches){
    const reason=String(row.blockedReason||'').replace(/^billing_blocked:/,'').trim();
    if(!reason||row.eligibilityStatus==='waiting_three_meetings'||['הפקה בתהליך','חלק המממן חויב במלואו'].includes(reason))continue;
    if(/חסר מחיר שעתי/.test(reason)){if(row.gefenFunding)add('מחיר שעתי לגפ״ן');continue;}
    if(/חסר מספר מפגשים|מספר מפגשים לא תקין/.test(reason)){add('מספר מפגשים');continue;}
    if(/חסר מחיר כולל/.test(reason)){add('מחיר כולל');continue;}
    add(reason);
  }
  return [...reasons];
}
export function financeBillingCompletionHtml(data,mode='editable') {
  if(!data.financeCanComplete||data.collectionError)return '';
  if(data.collectionLoading)return '<p class="ds-empty-state">טוען פעילויות…</p>';
  const incomplete=financeIncompleteBillingActivities(data,mode).slice().sort((a,b)=>
    String(a.authority||'').localeCompare(String(b.authority||''),'he')||
    String(a.school||'').localeCompare(String(b.school||''),'he')||
    String(a.activity_name||'').localeCompare(String(b.activity_name||''),'he'));
  const editor=data.billingCompletion;
  const rows=data.transactionContext?.billingRows||[];
  const visibleIds=new Set(incomplete.map(a=>key(a.row_id)));
  const missing='<span style="color:var(--ds-text-muted,#64748b)">חסר</span>';
  const value=v=>v==null||v===''||Number(v)===0?missing:esc(v);
  const price=v=>Number(v)>0?esc(money(v))+' ₪':missing;
  const list=incomplete.map(a=>{
    const reasons=financeBillingMissingReasons(a,rows);
    const active=key(editor?.row_id)===key(a.row_id);
    const activityRows=rows.filter(r=>key(r.activityRowId)===key(a.row_id));
    const orderRate=approvedGefenRate(activityRows);
    const funding=a.funding||[...new Set(rows.filter(r=>key(r.activityRowId)===key(a.row_id)&&r.fundingSourceId).map(r=>r.funding).filter(Boolean))].join(' + ');
    const searchText=[a.school,a.authority,a.activity_name,a.activity_no,funding,...reasons].join(' ').toLowerCase();
    return '<tr data-finance-completion-row data-completion-search-text="'+esc(searchText)+'"'+(active?' data-completion-selected="true"':'')+'><td><strong>'+esc(a.school||'—')+'</strong>'+(a.authority?'<small style="display:block;color:var(--ds-text-muted,#64748b)">'+esc(a.authority)+'</small>':'')+'</td><td><strong>'+esc(a.activity_name||'—')+'</strong>'+(a.activity_no?'<small style="display:block;color:var(--ds-text-muted,#64748b)">'+esc(a.activity_no)+'</small>':'')+'</td><td>'+esc(funding||'חסר')+'</td><td>'+ (course(a)?value(a.sessions):'—')+'</td><td>'+(course(a)&&hasGefenFunding(a,activityRows)?price(orderRate??a.course_hourly_rate):'—')+'</td><td>'+price(a.price)+'</td><td style="white-space:normal"><div style="display:grid;gap:3px">'+(reasons.length?reasons:['נדרשת השלמת נתוני חיוב']).map(reason=>'<span>'+esc(reason)+'</span>').join('')+'</div></td><td><button type="button" class="ds-btn ds-btn--sm '+(active?'ds-btn--ghost':'ds-btn--primary')+'" data-finance-complete-open="'+esc(a.row_id)+'">'+(active?'פתוח':'השלמה')+'</button></td></tr>'+(active?'<tr data-finance-completion-inline><td colspan="8" style="white-space:normal;padding:8px 0">'+financeBillingCompletionEditorHtml(editor)+'</td></tr>':'');
  }).join('');
  const outsideEditor=editor&&!visibleIds.has(key(editor.row_id))?financeBillingCompletionEditorHtml(editor):'';
  return '<section data-finance-completion-section dir="rtl"><div class="ds-fin-collect-toolbar" style="align-items:end;justify-content:space-between"><div><h3 style="margin:0">פעילויות להשלמת פרטים</h3><small style="color:var(--ds-text-muted,#64748b)" data-finance-completion-count>'+incomplete.length+' פעילויות</small></div><label>חיפוש<input class="ds-input" type="search" data-finance-completion-search value="'+esc(data.billingCompletionSearch||'')+'" placeholder="מוסד, פעילות, מממן או חוסר"></label></div>'+outsideEditor+(incomplete.length?'<div class="ds-table-wrap"><table class="ds-table" dir="rtl"><thead><tr><th>מוסד / רשות</th><th>פעילות</th><th>מימון</th><th>מפגשים</th><th>מחיר לשעה (גפ״ן)</th><th>מחיר כולל</th><th>מה חסר / נדרש בירור</th><th></th></tr></thead><tbody>'+list+'</tbody></table></div><p class="ds-empty-state" data-finance-completion-no-results hidden>לא נמצאו פעילויות מתאימות.</p>':'<p class="ds-empty-state">אין פעילויות עם פרטים חסרים להשלמה.</p>')+'</section>';
}
export function syncCompletionSearch(root,query='') {
  const section=root?.querySelector('[data-finance-completion-section]');
  if(!section)return;
  const terms=String(query||'').toLowerCase().trim().split(/\s+/).filter(Boolean);
  const rows=[...section.querySelectorAll('[data-finance-completion-row]')];
  let visible=0;
  for(const row of rows){
    const matches=row.dataset.completionSelected==='true'||terms.every(t=>(row.dataset.completionSearchText||'').includes(t));
    row.hidden=!matches;
    if(matches)visible++;
  }
  const count=section.querySelector('[data-finance-completion-count]');
  if(count)count.textContent=visible===rows.length?rows.length+' פעילויות':visible+' מתוך '+rows.length+' פעילויות';
  const empty=section.querySelector('[data-finance-completion-no-results]');
  if(empty)empty.hidden=visible!==0;
}
function financeBillingCompletionEditorHtml(editor) {
  const e=editor;
  const field=(label,name,value,type='text',attrs='')=>'<label class="ds-fin-collect-search"><span>'+esc(label)+'</span><input class="ds-input" name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+attrs+'></label>';
  const allocations=new Map((e.allocations||[]).map(x=>[key(x.id),x.amount]));
  const hasGefen=(e.allocations||[]).some(a=>isGefenFundingName(a.name))||isGefenFundingName(e.funding);
  const defaultRate=e.rate??e.proposal_rate??(hasGefen?defaultGefenCourseRate({...e,activity_name:e.name}):null)??'';
  const dates=Array.from({length:Math.min(35,Math.max(1,Number(e.sessions)||1))},(_,i)=>'date_'+(i+1));
  return '<section class="ds-fin-payer" style="padding:16px" data-finance-completion-editor><h3>השלמת נתוני חיוב — '+esc(e.name)+' · '+esc(e.school)+'</h3><p>יש להשלים את הפרטים החסרים ולשמור. אין הפקה או שליחה בעת השמירה.</p><form data-finance-completion-form data-activity-id="'+esc(e.row_id)+'"><div style="display:flex;flex-wrap:wrap;gap:12px">'+(course(e)?field('מספר מפגשים','sessions',e.sessions,'number','min="1" max="35" step="1" required')+ '<span data-completion-gefen-rate>'+field('מחיר לשעה בגפ״ן (₪)','rate',e.order_rate??defaultRate,'number','min="0.01" max="1000000" step="any"'+(e.approved_order_rate?' readonly':''))+'</span>':'')+field('מחיר כולל מוסכם (₪)','price',e.price,'number','min="1" step="1" required')+field('סמל מוסד (אם חסר)','school_symbol',e.school_symbol,'number',e.school_symbol?'readonly':'min="1" step="1"')+field('מספר תוכנית גפ״ן (אם חסר)','program_code',e.activity_no||e.gefen_number,'text',/^\d+$/.test(String(e.activity_no||''))?'readonly':'')+field('שעת התחלה (אם חסרה)','start_time',e.start_time,'time',e.start_time?'readonly':'')+field('שעת סיום (אם חסרה)','end_time',e.end_time,'time',e.end_time?'readonly':'')+field('מייל איש קשר (אם חסר)','contact_email',e.contact_email,'email',e.contact_email?'readonly':'')+'</div>'+(course(e)?'<p data-completion-gefen-calculation>מחיר לפי 1.5 שעות למפגש: <strong data-finance-completion-calculated>—</strong> · <button type="button" class="ds-btn ds-btn--sm" data-finance-completion-calculate>השתמש במחיר המחושב</button></p>'+(e.proposal_rate?'<p>תעריף בהצעה: '+esc(e.proposal_rate)+' ₪ לשעה'+(e.proposal_hours?' · '+esc(e.proposal_hours)+' שעות בהצעה':'')+'</p>':'')+(e.order_rate?'<p>תעריף בהזמנת גפ״ן מאומתת: '+esc(e.order_rate)+' ₪ לשעה</p>':''):'')+'<h4>חלוקת מימון (סכום כולל לכל מממן)</h4><div style="display:grid;gap:6px;max-height:280px;overflow:auto">'+(e.funding_options||[]).map(f=>'<label style="display:grid;grid-template-columns:auto 1fr minmax(100px,140px);gap:8px;align-items:center"><input type="checkbox" data-completion-funder="'+esc(f.id)+'" data-completion-gefen="'+String(isGefenFundingName(f.name))+'" '+(allocations.has(key(f.id))?'checked':'')+'><span>'+esc(f.name)+'</span><input type="number" min="0.01" step="0.01" class="ds-input" data-completion-amount="'+esc(f.id)+'" value="'+esc(allocations.get(key(f.id))??'')+'" placeholder="₪"></label>').join('')+'</div><p>סכום המימון: <strong data-finance-completion-funding-total>—</strong></p><details><summary>השלמת מועדי מפגשים חסרים</summary><div data-finance-completion-dates style="display:flex;flex-wrap:wrap;gap:8px">'+Array.from({length:35},(_,i)=>{const name='date_'+(i+1);const value=e.dates?.[name]||'';return '<div data-completion-date-index="'+(i+1)+'" '+(i+1>dates.length?'hidden':'')+'>'+field('מפגש '+(i+1),name,value,'date',value?'readonly':'')+'</div>';}).join('')+'</div></details>'+(e.has_prior?'<p>קיימים חשבונות קודמים; שינוי מחיר, חלוקת מימון או תעריף שאינו תואם לחשבון קודם ייחסם.</p>':'')+'<div style="display:flex;gap:8px;margin-top:12px"><button type="button" class="ds-btn ds-btn--primary" data-finance-complete-save>שמור ורענן זכאות</button><button type="button" class="ds-btn" data-finance-complete-cancel>ביטול</button></div></form></section>';
}
export function completionPayload(form,editor) {
  const get=name=>form.elements.namedItem(name)?.value??'';
  const allocations=[...form.querySelectorAll('[data-completion-funder]:checked')].map(box=>{
    const id=box.dataset.completionFunder;
    return {id,amount:[...form.querySelectorAll('[data-completion-amount]')].find(x=>x.dataset.completionAmount===id)?.value||''};
  });
  const dates={};for(let i=1;i<=35;i++){const name='date_'+i;if(get(name)&&!editor.dates?.[name])dates[name]=get(name);}
  return {updated_at:editor.updated_at,price:get('price'),sessions:get('sessions'),rate:editor.approved_order_rate!=null?'':get('rate'),school_symbol:get('school_symbol'),program_code:get('program_code'),start_time:get('start_time'),end_time:get('end_time'),contact_email:get('contact_email'),allocations,dates};
}
export function syncCompletionForm(form,calculate=false) {
  if(!form)return;
  const get=name=>form.elements.namedItem(name);
  const gefenSelected=Boolean(form.querySelector('[data-completion-funder][data-completion-gefen="true"]:checked'));
  const rateField=get('rate');if(rateField){rateField.required=gefenSelected&&!rateField.readOnly;rateField.disabled=!gefenSelected;}
  const rateWrapper=form.querySelector('[data-completion-gefen-rate]');if(rateWrapper)rateWrapper.hidden=!gefenSelected;
  const calculation=form.querySelector('[data-completion-gefen-calculation]');if(calculation)calculation.hidden=!gefenSelected||Boolean(rateField?.readOnly)||form.querySelectorAll('[data-completion-funder]:checked').length!==1;
  const sessions=Number(get('sessions')?.value||0),rate=Number(rateField?.value||0);
  const total=sessions*1.5*rate;
  const calc=form.querySelector('[data-finance-completion-calculated]');
  if(calc)calc.textContent=total>0?money(total)+' ₪':'—';
  if(calculate&&total>0){
    if(Math.abs(total-Math.round(total))>0.01&&!window.confirm('המחיר המחושב כולל אגורות. מחיר הפעילות נשמר בשקלים שלמים. לעגל לשקל הקרוב?'))return;
    get('price').value=String(Math.round(total));
  }
  const checked=[...form.querySelectorAll('[data-completion-funder]:checked')];
  if(calculate&&checked.length===1){
    const id=checked[0].dataset.completionFunder;
    const amount=[...form.querySelectorAll('[data-completion-amount]')].find(x=>x.dataset.completionAmount===id);
    if(amount)amount.value=get('price').value;
  }
  const funding=checked.reduce((sum,box)=>sum+Number([...form.querySelectorAll('[data-completion-amount]')].find(x=>x.dataset.completionAmount===box.dataset.completionFunder)?.value||0),0);
  const fundingTotal=form.querySelector('[data-finance-completion-funding-total]');
  if(fundingTotal)fundingTotal.textContent=money(funding)+' ₪';
  for(const field of form.querySelectorAll('[data-completion-date-index]'))field.hidden=Number(field.dataset.completionDateIndex)>Math.min(35,Math.max(1,sessions||1));
}

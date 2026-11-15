import { escapeHtml } from './shared/html.js';
import { defaultGefenCourseRate, isGefenFundingName } from '../course-hourly-pricing.js';
const esc=value=>escapeHtml(String(value??''));
const key=value=>String(value??'');
const money=value=>Number(value||0).toLocaleString('he-IL',{maximumFractionDigits:2});
const course=row=>String(row?.activity_type||'').toLowerCase()==='course';
export function financeIncompleteBillingActivities(data,mode) {
  const rows=data.transactionContext?.billingRows||[];
  return (data.collectionActivities||[]).filter(a=>{
    const matches=rows.filter(r=>key(r.activityRowId)===key(a.row_id));
    const relevant=mode==='editable'||matches.some(r=>r.gefenFunding===(mode==='automatic')||!r.fundingSourceId)
      || (!matches.length && (mode==='automatic'?isGefenFundingName(a.funding):!isGefenFundingName(a.funding)));
    if(!relevant)return false;
    return (course(a)&&(!Number(a.course_hourly_rate)||!Number(a.sessions)))
      || !Number(a.price)
      || matches.some(r=>r.blockedReason&&r.eligibilityStatus!=='waiting_three_meetings'
        && (mode==='editable'||r.gefenFunding===(mode==='automatic')||!r.fundingSourceId)
        && !['הפקה בתהליך','חלק המממן חויב במלואו'].includes(r.blockedReason));
  });
}
export function financeBillingCompletionHtml(data,mode) {
  if(!data.financeCanComplete || data.collectionError)return '';
  const incomplete=financeIncompleteBillingActivities(data,mode);
  const editor=data.billingCompletion;
  const rows=data.transactionContext?.billingRows||[];
  const table=incomplete.length?'<details class="ds-fin-payer" data-finance-completion-section'+(editor?' open':'')+'><summary>השלמה ידנית של נתוני חיוב ('+incomplete.length+')</summary><p>פעילות עם נתונים חסרים לא תיעלם מהמסך. בחרו פעילות, השלימו את הפרטים ושמרו כדי לחשב מחדש את הזכאות.</p><div class="ds-table-wrap"><table class="ds-table"><thead><tr><th>מוסד</th><th>פעילות</th><th>נתונים להשלמה</th><th></th></tr></thead><tbody>'+incomplete.map(a=>{
    const reason=[...new Set(rows.filter(r=>key(r.activityRowId)===key(a.row_id)&&r.blockedReason&&r.eligibilityStatus!=='waiting_three_meetings').map(r=>r.blockedReason))];
    if(course(a)&&!Number(a.course_hourly_rate))reason.unshift('חסר מחיר שעתי');
    if(!Number(a.price))reason.unshift('חסר מחיר כולל');
    return '<tr><td>'+esc(a.school||'—')+'</td><td>'+esc(a.activity_name)+'</td><td>'+esc(reason.join(' · ')||'חסרים נתוני תמחור')+'</td><td><button type="button" class="ds-btn ds-btn--sm" data-finance-complete-open="'+esc(a.row_id)+'">השלמה / עריכה</button></td></tr>';
  }).join('')+'</tbody></table></div></details>':'';
  if(!editor)return table;
  const e=editor;
  const field=(label,name,value,type='text',attrs='')=>'<label class="ds-fin-collect-search"><span>'+esc(label)+'</span><input class="ds-input" name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+attrs+'></label>';
  const allocations=new Map((e.allocations||[]).map(x=>[key(x.id),x.amount]));
  const hasGefen=(e.allocations||[]).some(a=>isGefenFundingName(a.name))||isGefenFundingName(e.funding);
  const defaultRate=e.rate??e.proposal_rate??(hasGefen?defaultGefenCourseRate({...e,activity_name:e.name}):null)??'';
  const dates=Array.from({length:Math.min(35,Math.max(1,Number(e.sessions)||1))},(_,i)=>'date_'+(i+1));
  return table+'<section class="ds-fin-payer" style="padding:16px" data-finance-completion-editor><h3>השלמת נתוני חיוב — '+esc(e.name)+' · '+esc(e.school)+'</h3><p>השמירה מעדכנת את הפעילות ומחשבת מחדש את הזכאות. המחיר הכולל וחלוקת המימון אינם משתנים ללא הזנה מפורשת. אין הפקה או שליחה בעת השמירה.</p><form data-finance-completion-form data-activity-id="'+esc(e.row_id)+'"><div style="display:flex;flex-wrap:wrap;gap:12px">'+(course(e)?field('מספר מפגשים','sessions',e.sessions,'number','min="1" max="35" step="1" required')+field('מחיר לשעה (₪)','rate',defaultRate,'number','min="0.01" max="1000000" step="any" required'):'')+field('מחיר כולל מוסכם (₪)','price',e.price,'number','min="1" step="1" required')+field('סמל מוסד (אם חסר)','school_symbol',e.school_symbol,'number',e.school_symbol?'readonly':'min="1" step="1"')+field('מספר תוכנית גפ״ן (אם חסר)','program_code',e.activity_no||e.gefen_number,'text',/^\d+$/.test(String(e.activity_no||''))?'readonly':'')+field('שעת התחלה (אם חסרה)','start_time',e.start_time,'time',e.start_time?'readonly':'')+field('שעת סיום (אם חסרה)','end_time',e.end_time,'time',e.end_time?'readonly':'')+field('מייל איש קשר (אם חסר)','contact_email',e.contact_email,'email',e.contact_email?'readonly':'')+'</div>'+(course(e)?'<p>מחיר לפי 1.5 שעות למפגש: <strong data-finance-completion-calculated>—</strong> · <button type="button" class="ds-btn ds-btn--sm" data-finance-completion-calculate>השתמש במחיר המחושב</button></p>'+(e.proposal_rate?'<p>תעריף בהצעה: '+esc(e.proposal_rate)+' ₪ לשעה'+(e.proposal_hours?' · '+esc(e.proposal_hours)+' שעות בהצעה':'')+'</p>':'')+(e.order_rate?'<p>תעריף בהזמנת גפ״ן מאומתת: '+esc(e.order_rate)+' ₪ לשעה</p>':''):'')+'<h4>חלוקת מימון (סכום כולל לכל מממן)</h4><div style="display:grid;gap:6px;max-height:280px;overflow:auto">'+(e.funding_options||[]).map(f=>'<label style="display:grid;grid-template-columns:auto 1fr minmax(100px,140px);gap:8px;align-items:center"><input type="checkbox" data-completion-funder="'+esc(f.id)+'" '+(allocations.has(key(f.id))?'checked':'')+'><span>'+esc(f.name)+'</span><input type="number" min="0.01" step="0.01" class="ds-input" data-completion-amount="'+esc(f.id)+'" value="'+esc(allocations.get(key(f.id))??'')+'" placeholder="₪"></label>').join('')+'</div><p>סכום המימון: <strong data-finance-completion-funding-total>—</strong></p><details><summary>השלמת מועדי מפגשים חסרים</summary><div data-finance-completion-dates style="display:flex;flex-wrap:wrap;gap:8px">'+Array.from({length:35},(_,i)=>{const name='date_'+(i+1);const value=e.dates?.[name]||'';return '<div data-completion-date-index="'+(i+1)+'" '+(i+1>dates.length?'hidden':'')+'>'+field('מפגש '+(i+1),name,value,'date',value?'readonly':'')+'</div>';}).join('')+'</div></details>'+(e.has_prior?'<p>קיימים חשבונות קודמים; שינוי מחיר, חלוקת מימון או תעריף שאינו תואם לחשבון קודם ייחסם.</p>':'')+'<div style="display:flex;gap:8px;margin-top:12px"><button type="button" class="ds-btn ds-btn--primary" data-finance-complete-save>שמור ורענן זכאות</button><button type="button" class="ds-btn" data-finance-complete-cancel>ביטול</button></div></form></section>';
}
export function completionPayload(form,editor) {
  const get=name=>form.elements.namedItem(name)?.value??'';
  const allocations=[...form.querySelectorAll('[data-completion-funder]:checked')].map(box=>{
    const id=box.dataset.completionFunder;
    return {id,amount:[...form.querySelectorAll('[data-completion-amount]')].find(x=>x.dataset.completionAmount===id)?.value||''};
  });
  const dates={};for(let i=1;i<=35;i++){const name='date_'+i;if(get(name)&&!editor.dates?.[name])dates[name]=get(name);}
  return {updated_at:editor.updated_at,price:get('price'),sessions:get('sessions'),rate:get('rate'),school_symbol:get('school_symbol'),program_code:get('program_code'),start_time:get('start_time'),end_time:get('end_time'),contact_email:get('contact_email'),allocations,dates};
}
export function syncCompletionForm(form,calculate=false) {
  if(!form)return;
  const get=name=>form.elements.namedItem(name);
  const sessions=Number(get('sessions')?.value||0),rate=Number(get('rate')?.value||0);
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

// Course pricing is per 1.5-hour meeting; funding and catalog presence are distinct.
export const COURSE_MEETING_HOURS = 1.5;
const RATES = Object.freeze({'6089':600,'57651':630,'9545':640,'53819':630,'27342':550,'57646':640,'67867':640});
const clean = value => String(value ?? '').trim();
export function isGefenFundingName(value) {
  return ['גפן','gefen','gefenfunding'].includes(clean(value).toLowerCase().replace(/["'׳״\s]/g,''));
}
export function defaultGefenCourseRate({activity_no,gefen_number,activity_name,program_name,catalog_slug} = {}) {
  const code = clean(gefen_number) || clean(activity_no);
  if (code !== '52279') return RATES[code] ?? null;
  const name = clean(activity_name);
  const program = clean(program_name);
  if (/פורצות דרך/.test(name) || /פורצות דרך/.test(program) || clean(catalog_slug) === '3604') return 575;
  if (/יזמות.*תעשיי[הת]|יזמות.*בתעשייה/.test(name) || /יזמות.*תעשיי[הת]|יזמות.*בתעשייה/.test(program)) return 640;
  // The catalog identifies this exact short label as industry entrepreneurship.
  // A conflicting linked program must be reviewed rather than guessed.
  if (name === 'אופק פרימיום' && (!program || program === name) && !clean(catalog_slug)) return 640;
  return null;
}
export function coursePriceFromRate(rate, sessions) {
  const r=Number(rate), n=Number(sessions);
  if (!clean(rate) || !Number.isFinite(r) || r<=0 || r>1000000 || !Number.isInteger(n) || n<1 || n>35) return null;
  // activities.price is an integer shekel contract; do not silently round.
  const price = Math.round(r*n*COURSE_MEETING_HOURS*1e6)/1e6;
  return Number.isSafeInteger(price) ? price : null;
}
export function agreedCourseRate(price,sessions) {
  const n=Number(sessions), p=Number(price);
  if (!clean(price) || !Number.isSafeInteger(p) || p<=0 || !Number.isInteger(n) || n<1 || n>35) return null;
  const rate=Math.round(p/(n*COURSE_MEETING_HOURS)*1e8)/1e8;
  return coursePriceFromRate(rate,n)===p ? rate : null;
}
export function gefenSlotGross(rate, cap, ordinal) {
  const n=Number(ordinal), r=Number(rate), c=Number(cap);
  if (!Number.isInteger(n)||n<1||!Number.isFinite(r)||r<=0||!Number.isFinite(c)||c<0) return 0;
  const cumulative=i=>Math.round(Math.min(c,r*COURSE_MEETING_HOURS*i)*100)/100;
  return Math.round((cumulative(n)-cumulative(n-1))*100)/100;
}

export function courseFundingHasGefen(form) {
  const select=form.querySelector('select[name="funding_sources"]');
  if (select) return [...select.selectedOptions].some(o=>isGefenFundingName(o.textContent));
  return [...form.querySelectorAll('[data-funding-source-id]:checked')].some(o=>isGefenFundingName(o.dataset.fundingName));
}
export function courseFormPricing(form,{fresh=false,applyDefault=false}={}) {
  const rate=form.querySelector('[name="course_hourly_rate"]');
  const price=form.querySelector('[name="price"]');
  const sessions=form.querySelector('[name="sessions"]');
  const type=clean(form.querySelector('[name="activity_type"]')?.value);
  if (!rate||!price||!sessions) return {active:false,valid:true};
  const active=type==='course'||type==='קורס';
  const host=rate.closest('[data-course-pricing]');
  if(host) host.hidden=!active;
  if(!active) {price.readOnly=false;return {active:false,valid:true};}
  const hasGefen=courseFundingHasGefen(form);
  const name=clean(form.querySelector('[name="activity_name"]')?.value);
  const originalName=clean(rate.dataset.originalName);
  const useOriginal=name===originalName;
  const suggested=hasGefen ? defaultGefenCourseRate({
    activity_no:form.querySelector('[name="activity_no"]')?.value,
    gefen_number:form.querySelector('[name="gefen_number"]')?.value,
    activity_name:name,
    program_name:useOriginal?rate.dataset.programName:undefined,
    catalog_slug:useOriginal?rate.dataset.catalogSlug:undefined
  }) : null;
  if(applyDefault||(fresh&&(!rate.value||rate.dataset.autoRate==='yes'))) {
    if(suggested!=null) {rate.value=String(suggested);rate.dataset.autoRate='yes';}
    else if(rate.dataset.autoRate==='yes') {rate.value='';price.value='';delete rate.dataset.autoRate;}
    else if(applyDefault&&!hasGefen) {
      const agreed=agreedCourseRate(price.value,sessions.value);
      if(agreed!=null) rate.value=String(agreed);
    }
  }
  const hours=host?.querySelector('[data-course-hours]');
  if(hours) hours.textContent=Number(sessions.value)>0?String(Number(sessions.value)*COURSE_MEETING_HOURS):'—';
  const total=rate.value?coursePriceFromRate(rate.value,sessions.value):null;
  const valid=!rate.value||total!==null;
  rate.setCustomValidity(valid?'':'יש להזין מחיר ומספר מפגשים תקינים; המחיר הכולל חייב להיות בשקלים שלמים');
  price.readOnly=Boolean(rate.value);
  if(total!==null) price.value=String(total);
  return {active,valid,rate:rate.value,total,hasGefen,suggested};
}
export function bindCourseFormPricing(form,{fresh=false,signal}={}) {
  const rate=form.querySelector('[name="course_hourly_rate"]');
  if(!rate||rate.dataset.hourlyBound==='yes') return;
  rate.dataset.hourlyBound='yes';
  const sync=()=>courseFormPricing(form,{fresh});
  for(const event of ['input','change']) form.addEventListener(event,e=>{
    if(e.target===rate) delete rate.dataset.autoRate;
    if(e.target.matches?.('[name="course_hourly_rate"],[name="sessions"],[name="activity_type"],[name="activity_name"],[name="funding_sources"],[data-funding-source-id]')) sync();
  },{signal});
  form.querySelector('[data-use-course-rate]')?.addEventListener('click',()=>{
    courseFormPricing(form,{fresh,applyDefault:true});
  },{signal});
  // An existing record must not change simply because its drawer is opened.
  if(fresh) sync();
}

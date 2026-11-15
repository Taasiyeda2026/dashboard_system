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

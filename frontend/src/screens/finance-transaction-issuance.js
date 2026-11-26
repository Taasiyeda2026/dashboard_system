import { gefenBillingGroups, gefenBillingValues, gefenBillingAmount, gefenBillingRequest, updateGefenBillingValue } from './finance-gefen-billing-overrides.js';
import { financeBillingCompletionHtml, financeActivitySchoolIdentity, financeBillingCompletionEditorHtml, financeGefenAccountEditModalHtml } from './finance-billing-completion.js';
import {invoiceRevisionEditorHtml,invoiceRevisionAdminHtml} from './finance-invoice-revisions.js';
import '../finance-transaction-page-data-hotfix.js';
import { manualAccountViewHtml } from './finance-manual-account.js';
import { financeError } from './finance-errors.js';
import { escapeHtml } from './shared/html.js';
import { dsEmptyState, dsScreenStack, dsTableWrap } from './shared/layout.js';
import {
  TRANSACTION_MODE_AUTOMATIC,
  TRANSACTION_MEETING_HOURS,
  TRANSACTION_MODE_MANUAL,
  financeCycleCutoff,
  financeGefenCycle,
  financeToday
} from './finance-transaction-accounts.js';

const text = (value) => String(value ?? '').trim();
const formatDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : text(value) || '—';
};
const formatAmount = (value) => {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;
};

function statusLabel(status) {
  const value = text(status);
  return ({
    generating: 'בהפקה', issued: 'הופק', mail_draft_ready: 'טיוטת מייל הוכנה', sent: 'נשלח', cancelled: 'בוטל',
    pending: 'ממתין ליצירת טיוטה', waiting_connection: 'ממתין לחיבור Microsoft', draft_ready: 'טיוטה מוכנה', failed: 'שגיאה הדורשת טיפול', missing_recipient: 'חסר נמען',
    needs_review:'נדרשת בדיקה לפני ניסיון נוסף', already_sent:'ההודעה כבר נשלחה מתיבת Outlook',
    awaiting_payment: 'ממתין לתשלום', partially_paid: 'שולם חלקית', paid: 'שולם'
  })[value] || value || '—';
}

export function transactionYearStart(data) {
  const year=Number(/school_(\d{4})/.exec(data.collectionPeriod || 'school_2027')?.[1]);
  return `${year-1}-09`;
}
export function transactionMonth(data, mode, now = new Date()) {
  const lastClosed=transactionMaxMonth(data, mode, now);
  const month=data.transactionMonths?.[mode];
  return /^\d{4}-\d{2}$/.test(month||'') && month<=lastClosed && month>=transactionYearStart(data) ? month : lastClosed;
}
export function transactionGefenCycle(data, now = new Date()) {
  // The loaded server preview is authoritative, including when a tab crosses a cycle boundary.
  const row = data.transactionContext?.billingRows?.find(row => row.gefenFunding && row.billingCutoff && row.nextBillingUpdate);
  return row ? { cutoff: row.billingCutoff, nextUpdate: row.nextBillingUpdate } : financeGefenCycle(now);
}
export function transactionMaxMonth(data, mode, now = new Date()) {
  return (mode === TRANSACTION_MODE_AUTOMATIC ? transactionGefenCycle(data, now).cutoff : financeCycleCutoff(now)).slice(0,7);
}
function monthPicker(data, mode) {
  if(mode===TRANSACTION_MODE_AUTOMATIC)return `<p data-finance-transaction-period-readonly>תקופת החיוב נקבעת לפי מועדי הפעילות עד ${escapeHtml(formatDate(transactionGefenCycle(data).cutoff))}</p>`;
  return `<label class="ds-fin-collect-search"><span>חודש ביצוע</span>
    <input class="ds-input" type="month" data-finance-transaction-month="${mode}" value="${transactionMonth(data,mode)}" min="${transactionYearStart(data)}" max="${transactionMaxMonth(data,mode)}"></label>`;
}

export const transactionSelectionKey = (row) => [row.activityRowId, row.fundingSourceId, row.period || 'completion'].join(':');
const serviceActivity = (row) => ['tour','workshop'].includes(text(row.activityType || row.activity_type).toLowerCase());
const invoiceQuantity = (row) => Number(row.unbilledCount || 0);
// Customer-facing Gefen display only. Source activity_no / snapshots stay unchanged
// until an approved data migration rewrites them. Poratzot keeps the 3604→52279
// alias; רוקחים עולם is always shown as 46091.
export function displayGefenProgramNumber(line = {}) {
  const name = text(line.activityName || line.activity_name);
  if (/רוקחים\s*עולם/u.test(name)) return '46091';
  const gefen = text(line.gefenNumber || line.gefen_number);
  const activityNo = text(line.activityNo || line.activity_no || line.sourceActivityNo);
  if (gefen === '3604' && (!activityNo || activityNo === '3604')) return '52279';
  return gefen || 'לא הוגדר';
}
function progressHeading(lines) {
  const units = lines.some(serviceActivity);
  const courses = lines.some(row => !serviceActivity(row));
  return units ? (courses ? 'מפגשים / כמות' : 'כמות') : 'מפגשים';
}
function compactNumber(value) {
  return Number(Number(value || 0).toFixed(6)).toLocaleString('he-IL', { maximumFractionDigits: 6 });
}
function activityMeetings(row) {
  return serviceActivity(row) ? `כמות ${compactNumber(invoiceQuantity(row))}` : `${compactNumber(row.unbilledCount)}/${compactNumber(row.plannedCount)}`;
}
function activityHours(row) {
  return serviceActivity(row) ? '—' : `${compactNumber(row.unbilledHours)}/${compactNumber(row.plannedHours ?? row.plannedCount * TRANSACTION_MEETING_HOURS)}`;
}

function groupProgress(lines) {
  const courses = lines.filter(row => !serviceActivity(row));
  const services = lines.filter(serviceActivity);
  return [
    `${new Set(lines.map(row => row.activityRowId)).size} פעילויות`,
    ...(courses.length ? [`${courses.reduce((sum,row)=>sum+Number(row.unbilledCount||0),0)} מפגשים`,
      `${courses.reduce((sum,row)=>sum+Number(row.unbilledHours||0),0).toLocaleString('he-IL', { maximumFractionDigits: 2 })} שעות`] : []),
    ...(services.length ? [`${services.reduce((sum,row)=>sum+invoiceQuantity(row),0)} סדנאות/סיורים`] : [])
  ].join(' · ');
}


export function transactionBacklog(data, mode) {
  const selected = transactionMonth(data, mode);
  return (data.transactionContext?.billingRows || []).filter((row) => row.gefenFunding === (mode === TRANSACTION_MODE_AUTOMATIC)
    && row.eligible && !row.blockedReason && row.period
    && row.period.slice(0,7)>=transactionYearStart(data) && row.period.slice(0,7)<selected);
}

export function transactionIssuanceActivities(data, { mode = TRANSACTION_MODE_AUTOMATIC } = {}) {
  return (data.transactionContext?.billingRows || [])
    .filter((row) => row.gefenFunding === (mode === TRANSACTION_MODE_AUTOMATIC) || (!row.fundingSourceId && row.blockedReason))
    .filter((row) => row.period?.slice(0,7)>=transactionYearStart(data) && row.period?.slice(0, 7) === transactionMonth(data, mode) || (!row.period && row.blockedReason))
    .map((row) => ({ row_id: row.activityRowId, transaction_summary: row }));
}

// A missing billing field is not itself evidence of an overdue invoice.
export function transactionBlockedDueRows(data, mode = TRANSACTION_MODE_AUTOMATIC) {
  const selected = transactionMonth(data, mode);
  const start = transactionYearStart(data);
  return [...new Map((data.transactionContext?.billingRows || []).filter(row => {
    const period = text(row.period).slice(0,7);
    if (row.eligible && row.payerEmailMissing) return row.gefenFunding === (mode === TRANSACTION_MODE_AUTOMATIC) && period >= start && period <= selected;
    const reason = text(row.blockedReason).replace(/^billing_blocked:/,'').trim();
    if (!reason || row.eligible || ['הפקה בתהליך','חלק המממן חויב במלואו','ממתין להשלמת שלושה מפגשים'].includes(reason)) return false;
    if (row.gefenFunding !== (mode === TRANSACTION_MODE_AUTOMATIC) || !row.fundingSourceId) return false;
    if (!/^\d{4}-\d{2}$/.test(period) || period < start || period > selected) return false;
    if (Number(row.unbilledCount) <= 0 || !(Number(row.unbilledAmount) > 0)) return false;
    if (mode === TRANSACTION_MODE_AUTOMATIC) {
      if (row.eligibilityStatus === 'waiting_three_meetings') return false;
      if (!serviceActivity(row) && !(Number(row.completedCount) >= 3)) return false;
    } else if (row.finished !== true) return false;
    return true;
  }).map(row => [transactionSelectionKey(row),row.eligible && row.payerEmailMissing
    ? {...row, eligible:false, blockedReason:'חסרה כתובת דוא״ל של הגורם המשלם'} : row])).values()];
}

// Display one row per activity, not one per billing month. Keep underlying
// period rows untouched for eligibility and financial processing.
export function consolidateBlockedActivities(rows) {
  const groups = new Map();
  for (const row of rows) {
    const id = row.activityRowId;
    if (!groups.has(id)) groups.set(id, {...row, periods: new Set(), reasons: new Set()});
    const group = groups.get(id);
    if (row.period) group.periods.add(row.period.slice(0,7));
    if (row.blockedReason) group.reasons.add(text(row.blockedReason).replace(/^billing_blocked:/,'').trim());
  }
  return [...groups.values()].map(group => ({...group, periods: [...group.periods].sort(), reasons: [...group.reasons]}));
}

// An automatic Gefen batch must expose every mixed-funded activity and its
// actual program number before it can reserve invoice numbers. The review is
// drawn from the same billing snapshot as the invoice, not a course-name map.
export function automaticMixedFundingProgramReview(data, month, previewKey = null) {
  const scoped = { ...data, transactionMonths: { ...data.transactionMonths, automatic: month } };
  const preview = transactionPreviewForVisit(scoped, TRANSACTION_MODE_AUTOMATIC);
  const allRows = data.transactionContext?.billingRows || [];
  const activities = data.collectionActivities || [];
  const seen = new Set();
  const result = [];
  for (const account of preview.accounts.filter(a=>!previewKey||accountPreviewKey(a)===previewKey)) for (const line of account.lines) {
    const activityId = String(line.activityRowId || '');
    if (!activityId || seen.has(activityId)) continue;
    const hasOtherFunding = allRows.some(row => row.activityRowId === activityId
      && row.fundingSourceId && row.fundingSourceId !== line.fundingSourceId
      && row.gefenFunding === false);
    if (!hasOtherFunding) continue;
    seen.add(activityId);
    const activity = activities.find(row => String(row.row_id) === activityId);
    // The preflight must use the same customer-facing Gefen program number
    // as the invoice preview. Keep source codes untouched for accounting.
    const code = displayGefenProgramNumber(line);
    const sourceCode = String(activity?.gefen_number || activity?.activity_no || '').trim();
    const displayedSourceCode = sourceCode
      ? displayGefenProgramNumber({ activityName: activity?.activity_name || line.activityName, gefenNumber: sourceCode, activityNo: sourceCode })
      : '';
    result.push({
      activityId,
      school: String(activity?.school || line.customerName || account.schoolName || ''),
      course: String(line.activityName || ''),
      code,
      sourceCode,
      valid: /^\d+$/.test(code) && (!displayedSourceCode || displayedSourceCode === code)
    });
  }
  return result;
}

export function transactionPreviewForVisit(data, mode = TRANSACTION_MODE_AUTOMATIC) {
  const selected = transactionIssuanceActivities(data, { mode }).map((row) => row.transaction_summary);
  const candidates=[...selected,...transactionBacklog(data,mode)];
  const rows=[...new Map(candidates.map(row=>[JSON.stringify([transactionSelectionKey(row),row.institutionSymbol,row.payerKey || row.payerName]),row])).values()];
  const accounts = new Map();
  if (!data.collectionError) for (const row of rows.filter((row) => row.eligible && !row.blockedReason && !row.payerEmailMissing)) {
    // Gefen remains per school. Every other payer gets one account across schools.
    const key = mode === TRANSACTION_MODE_AUTOMATIC
      ? [row.institutionSymbol, row.fundingSourceId, row.payerKey || row.payerName].join(':')
      : [row.fundingSourceId, row.payerKey || row.payerName, row.period || 'completion'].join(':');
    if (!accounts.has(key)) accounts.set(key, { institutionSymbol: mode === TRANSACTION_MODE_AUTOMATIC ? row.institutionSymbol : '', customerName: row.payerName,
      schoolName: row.customerName, funding: row.funding, period: row.period, customerEmails: [], lines: [], totalAmount: 0 });
    const account = accounts.get(key);
    account.lines.push(row);
    if (mode === TRANSACTION_MODE_AUTOMATIC && row.period > account.period) account.period = row.period;
    account.totalAmount += Number(row.issuableAmount);
    if (row.customerEmail && !account.customerEmails.includes(row.customerEmail)) account.customerEmails.push(row.customerEmail);
  }
  const result = [...accounts.values()];
  for (const account of result) {
    account.lines.sort((a,b)=>String(a.activityRowId).localeCompare(String(b.activityRowId))||String(a.period).localeCompare(String(b.period)));
    account.periods=[...new Set(account.lines.map(row=>row.period))].filter(Boolean).sort();
    if(mode===TRANSACTION_MODE_AUTOMATIC)account.totalAmount=gefenBillingGroups(account.lines).reduce((n,g)=>n+gefenBillingAmount(gefenBillingValues(data,g)),0);
    const schools = new Set(account.lines.map(row => String(row.financeSchoolId || row.institutionSymbol || row.customerName || '')).filter(Boolean));
    // A consolidated sponsor/authority invoice covering different schools
    // must not be addressed to contacts of the other schools.
    if (schools.size > 1) account.customerEmails = [];
    else account.customerEmails = [...new Map(account.customerEmails
      .flatMap(email => String(email).split(/[;,]/))
      .map(email => email.trim()).filter(Boolean)
      .map(email => [email.toLowerCase(), email])).values()];
  }
  return { mode, cutoff: mode === TRANSACTION_MODE_MANUAL ? financeToday() : transactionGefenCycle(data).cutoff, accounts: result,
    blocked: transactionBlockedDueRows(data, mode), deferred: rows.filter((row) => !row.eligible && !row.blockedReason),
    totals: { schools: new Set(result.map((row) => row.institutionSymbol)).size,
      activities: new Set(result.flatMap((account) => account.lines.map((line) => line.activityRowId))).size,
      meetings: mode===TRANSACTION_MODE_AUTOMATIC ? result.flatMap(a=>gefenBillingGroups(a.lines)).reduce((n,g)=>n+Number(gefenBillingValues(data,g).meetings),0) : result.reduce((sum, a) => sum + a.lines.filter(l => !serviceActivity(l)).reduce((n, l) => n + Number(l.unbilledCount || 0), 0), 0),
      hours: mode===TRANSACTION_MODE_AUTOMATIC ? result.flatMap(a=>gefenBillingGroups(a.lines)).reduce((n,g)=>n+Number(gefenBillingValues(data,g).hours),0) : result.reduce((sum, a) => sum + a.lines.filter(l => !serviceActivity(l)).reduce((n, l) => n + Number(l.unbilledHours || 0), 0), 0),
      units: result.reduce((sum, a) => sum + a.lines.filter(serviceActivity).reduce((n, l) => n + invoiceQuantity(l), 0), 0),
      containsCourses: mode===TRANSACTION_MODE_AUTOMATIC ? result.length>0 : result.some(a => a.lines.some(l => !serviceActivity(l))),
      containsUnits: mode===TRANSACTION_MODE_AUTOMATIC ? false : result.some(a => a.lines.some(serviceActivity)),
      amount: result.reduce((sum, a) => sum + a.totalAmount, 0) } };
}

function summaryCards(preview) {
  if(preview.mode===TRANSACTION_MODE_AUTOMATIC)return `<dl class="ds-fin-transaction-summary ds-fin-issuance-totals" data-gefen-billing-summary dir="rtl">
    ${[['פעילויות',preview.totals.activities],['מפגשים',preview.totals.meetings],['שעות',compactNumber(preview.totals.hours)],['סה״כ להפקה',formatAmount(preview.totals.amount)]].map(([label,value])=>`<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join('')}
  </dl>`;
  const cards = [
    ['חשבונות עסקה',preview.accounts.length],
    ['בתי ספר', preview.totals.schools],
    ['פעילויות', preview.totals.activities],
    ...(preview.totals.containsCourses !== false ? [['מפגשים לחיוב', preview.totals.meetings], ['שעות לחיוב', Number(preview.totals.hours || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })]] : []),
    ...(preview.totals.containsUnits ? [['כמות סדנאות/סיורים', preview.totals.units]] : []),
    ['סכום להפקה', formatAmount(preview.totals.amount)]
  ];
  return `<div class="ds-fin-transaction-summary" data-gefen-billing-summary dir="rtl" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;width:fit-content;max-width:100%;margin:12px auto 16px;">
    ${cards.map(([label, value]) => `
      <article class="ds-fin-collect-summary-card" style="box-sizing:border-box;width:140px;min-height:62px;padding:9px 10px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
        <span class="ds-fin-collect-summary-card__label" style="font-size:12px;line-height:1.25;white-space:nowrap;">${escapeHtml(label)}</span>
        <strong class="ds-fin-collect-summary-card__value" style="font-size:20px;line-height:1.2;margin-top:4px;white-space:nowrap;">${escapeHtml(String(value))}</strong>
      </article>
    `).join('')}
  </div>`;
}

function groupSelectAllHtml(lines, data, mode) {
  if (mode !== TRANSACTION_MODE_MANUAL) return '';
  const keys = [...new Set(lines.map(transactionSelectionKey))];
  const selected = keys.filter((key) => data.transactionManualSelected?.[key]).length;
  return `<label class="ds-fin-transaction-all"><input type="checkbox" data-finance-transaction-select-all aria-label="סימון כל החשבונות בקבוצה"${selected===keys.length ? ' checked' : ''}${selected>0 && selected<keys.length?' data-indeterminate="true"':''}> סמן הכל</label>`;
}

function billingLineHtml(line, data, mode) {
  const slots = Array.isArray(line.unbilledSlots) ? line.unbilledSlots : [];
  const school = mode === TRANSACTION_MODE_MANUAL && line.customerName
    ? `<small class="ds-fin-transaction-school" style="display:block;color:var(--ds-text-muted,#64748b)">${escapeHtml(line.customerName)}</small>` : '';
  // Internal-only billing provenance. Customer-facing PDF/email never receives this marker.
  const billingBasisLabel = line.billingBasis === 'gefen_matched_order'
    ? `חיוב לפי הזמנת גפ״ן מאומתת ${text(line.matchedGefenOrderNumber)} · תעריף ${formatAmount(line.matchedGefenOrderHourlyRate)} לשעה`
    : 'חיוב לפי נתוני הפעילות · התאמת הזמנת גפ״ן טרם הושלמה';
  const internalBillingBasis = mode === TRANSACTION_MODE_AUTOMATIC && line.gefenFunding
    ? `<small class="ds-fin-internal-billing-basis" style="display:block;color:var(--ds-text-muted,#64748b)">בקרה פנימית: ${escapeHtml(billingBasisLabel)}</small>`
    : '';
  const meetingDetails = slots.length
    ? `<details class="ds-fin-transaction-meetings"><summary>${serviceActivity(line) ? 'פירוט מועדי פעילות' : 'פירוט מפגשים'}</summary>
      <div>${slots.map(slot => `<div>${serviceActivity(line) ? 'מועד פעילות' : `מפגש ${escapeHtml(slot.slot)}`} · ${escapeHtml(formatDate(slot.date))}${serviceActivity(line) ? '' : ` · ${compactNumber(slot.remainingHours ?? TRANSACTION_MEETING_HOURS)} שעות`}</div>`).join('')}</div>
    </details>` : '';
  return `<tr>
    <td><strong>${escapeHtml(line.activityName || line.activityRowId)}</strong>${line.gefenFunding ? `<small class="ds-fin-transaction-program" style="display:block;color:var(--ds-text-muted,#64748b)">מספר גפ״ן: ${escapeHtml(displayGefenProgramNumber(line))}</small>` : ''}${internalBillingBasis}${school}${line.periods?.length>0?`<small style="display:block;color:var(--ds-text-muted,#64748b)">חודשי ביצוע: ${escapeHtml(line.periods.map(p=>p.slice(0,7)).join(' · '))}</small>`:''}${meetingDetails}${data.financeCanComplete?`<button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-finance-complete-open="${escapeHtml(line.activityRowId)}">עריכת נתוני חיוב</button>`:''}</td>
    <td>${escapeHtml(formatAmount(line.activityPrice ?? line.fundingAmount))}${line.gefenFunding&&!serviceActivity(line)&&Number(line.hourlyRate)>0?`<small style="display:block;color:var(--ds-text-muted,#64748b)">${escapeHtml(formatAmount(line.hourlyRate))} לשעה</small>`:''}</td>
    <td>${escapeHtml(activityMeetings(line))}</td>
    <td>${escapeHtml(activityHours(line))}</td>
    <td><strong>${escapeHtml(formatAmount(line.issuableAmount))}</strong>
      ${line.billedAmount != null ? `<small style="display:block">חויב: ${escapeHtml(formatAmount(line.billedAmount))}</small>` : ''}
      ${line.fullFundingAmount != null ? `<small style="display:block">יתרת מממן: ${escapeHtml(formatAmount(line.fullFundingAmount))}</small>` : ''}
    </td>
  </tr>`;
}
export function consolidatedGefenDisplayLines(lines) {
  const grouped=new Map();
  for(const row of lines){
    const k=JSON.stringify([row.activityRowId,row.fundingSourceId,row.hourlyRate]);
    if(!grouped.has(k))grouped.set(k,{...row,periods:[],unbilledSlots:[],unbilledCount:0,unbilledHours:0,issuableAmount:0});
    const line=grouped.get(k);line.periods.push(row.period);line.unbilledSlots.push(...(row.unbilledSlots||[]));line.unbilledCount+=Number(row.unbilledCount||0);line.unbilledHours+=Number(row.unbilledHours||0);line.issuableAmount+=Number(row.issuableAmount||0);
  }
  return [...grouped.values()].map(line=>({...line,periods:[...new Set(line.periods)].sort(),unbilledSlots:line.unbilledSlots.sort((a,b)=>Number(a.slot)-Number(b.slot)),issuableAmount:Number(line.issuableAmount.toFixed(2))}));
}
function billingTableHtml(lines, data, mode) {
  if(mode===TRANSACTION_MODE_AUTOMATIC)return dsTableWrap(`<table class="ds-table ds-fin-gefen-billing-table" dir="rtl"><thead><tr><th>שם הפעילות / קבוצה</th><th>מספר מפגשים</th><th>סה״כ שעות</th><th>מחיר לשעה</th><th>סה״כ לחיוב</th></tr></thead><tbody>${gefenBillingGroups(lines).map(group=>{
    const values=gefenBillingValues(data,group);
    const activity=(data.collectionActivities||[]).find(a=>String(a.row_id)===String(group.activityRowId));
    const label=[group.activityName,activity?.grade,activity?.class_group].filter(Boolean).join(' · ');
    const input=(field,title,step)=>`<input class="ds-input ds-fin-gefen-billing-input" type="number" inputmode="decimal" min="${field==='meetings'?'1':'0.000001'}" step="${step}" aria-label="${escapeHtml(title+' · '+label)}" data-gefen-billing-key="${escapeHtml(group.key)}" data-gefen-billing-field="${field}" value="${escapeHtml(String(values[field]))}"${data.financeBusy||data.transactionRunning?' disabled':''}>`;
    const dates=group.rows.flatMap(row=>row.unbilledSlots||[]).map(slot=>slot.date).filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date||'')).sort();
    const period=dates.length?`<details class="ds-fin-transaction-meetings"><summary>תקופת ביצוע: ${escapeHtml(formatDate(dates[0]))}–${escapeHtml(formatDate(dates.at(-1)))}</summary><div>${dates.map(date=>`<div>${escapeHtml(formatDate(date))}</div>`).join('')}</div></details>`:'';
    return `<tr data-gefen-billing-row="${escapeHtml(group.key)}"><td><strong>${escapeHtml(label)}</strong>${period}</td><td><span data-gefen-billing-meetings aria-label="מספר מפגשים לפי מועדי הפעילות">${escapeHtml(String(values.meetings))}</span></td><td>${input('hours','סה״כ שעות','0.000001')}</td><td>${input('rate','מחיר לשעה','0.000001')}</td><td><strong data-gefen-billing-amount>${escapeHtml(formatAmount(gefenBillingAmount(values)))}</strong></td></tr>`;
  }).join('')}</tbody></table>`);
  return dsTableWrap(`<table class="ds-table ds-fin-transaction-table" dir="rtl"><thead><tr>
    <th>פעילות ${groupSelectAllHtml(lines,data,mode)}</th><th>מחיר הפעילות</th><th>${escapeHtml(progressHeading(lines))}</th><th>שעות</th><th>סכום לחיוב</th>
  </tr></thead><tbody>${lines.map(line => billingLineHtml(line,data,mode)).join('')}</tbody></table>`);
}

function issueButtonLabel(mode, data) {
  if (mode !== TRANSACTION_MODE_MANUAL) return 'הפקת כל חשבונות העסקה';
  const selected = Object.values(data.transactionManualSelected || {}).filter(Boolean).length;
  return selected > 0 ? 'הפקת המסומנים' : 'הפקת כל חשבונות העסקה';
}

export function accountPreviewKey(account) {
  return [account.institutionSymbol || '', account.customerName || '', account.period || '', account.lines.map((l) => l.activityRowId).join(',')].join('|');
}

function pendingGroupHtml(rows, data, mode) {
  const groups = new Map();
  for (const row of rows) {
    const key = [row.period, mode === TRANSACTION_MODE_AUTOMATIC ? row.institutionSymbol : (row.payerKey || row.fundingSourceId)].join(':');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].sort((a,b) => a[0].period.localeCompare(b[0].period)).map((lines) => {
    const row = lines[0];
    return `<details class="ds-fin-payer" data-finance-transaction-group${mode===TRANSACTION_MODE_AUTOMATIC&&preview.accounts.length===1?' open':''}><summary>${escapeHtml(row.period.slice(0,7))} · ${escapeHtml(mode === TRANSACTION_MODE_AUTOMATIC ? `${row.customerName} · ${row.institutionSymbol}` : row.payerName)} · ${lines.length} חיובים · ${escapeHtml(formatAmount(lines.reduce((sum,line) => sum + Number(line.issuableAmount),0)))}</summary>
      ${billingTableHtml(lines,data,mode)}
      <button type="button" class="ds-btn ds-btn--primary" data-finance-transaction-run="${mode}" data-finance-transaction-period="${row.period.slice(0,7)}"${mode === TRANSACTION_MODE_MANUAL && !transactionBacklog(data, mode).some((line) => line.period.slice(0,7) === row.period.slice(0,7) && data.transactionManualSelected?.[transactionSelectionKey(line)]) ? ' disabled' : ''}>${mode === TRANSACTION_MODE_AUTOMATIC ? 'הפק חשבונות לחודש זה' : 'הפק חשבונות מסומנים לחודש זה'}</button></details>`;
  }).join('');
}

function billingView(data, mode) {
  const preview = transactionPreviewForVisit(data, mode);
  const backlog = transactionBacklog(data, mode);
  const rows = transactionIssuanceActivities(data, { mode }).map((row) => row.transaction_summary);
  const ready = rows.filter((row) => row.eligible && !row.blockedReason);
  const waiting = [...new Map(rows.filter((row) => row.eligibilityStatus === 'waiting_three_meetings' || (mode === TRANSACTION_MODE_AUTOMATIC && row.gefenFunding === true && !row.eligible && !serviceActivity(row) && Number(row.completedCount) < 3))
    .map(row=>[row.activityRowId,row])).values()];
  const waitingHtml = waiting.length ? `<details class="ds-fin-payer" data-finance-waiting-courses>
    <summary>${mode === TRANSACTION_MODE_AUTOMATIC ? '<span class="ds-fin-gefen-arrow" aria-hidden="true">▸</span>' : ''}<span>בהמתנה (${waiting.length})</span></summary>
    ${dsTableWrap(`<table class="ds-table" dir="rtl"><thead><tr><th>מוסד</th><th>קורס</th><th>מפגשים</th></tr></thead>
    <tbody>${waiting.map(row=>`<tr><td>${escapeHtml(row.customerName || '—')}</td><td>${escapeHtml(row.activityName)}</td><td>${Number(row.completedCount || 0)} מתוך 3</td></tr>`).join('')}</tbody></table>`)}
  </details>` : '';
  const blocked = consolidateBlockedActivities(preview.blocked);
  const blockedEditorId = data.billingCompletion?.row_id;
  const blockedEditorVisible = mode!==TRANSACTION_MODE_AUTOMATIC && blocked.some(row=>String(row.activityRowId)===String(blockedEditorId));
  const blockedHtml = blocked.length ? `<details class="ds-fin-payer" data-finance-blocked-rows${blockedEditorVisible?' open':''}>
    <summary>${mode === TRANSACTION_MODE_AUTOMATIC ? '<span class="ds-fin-gefen-arrow" aria-hidden="true">▸</span>' : ''}<span>חסומים להפקה (${blocked.length})</span></summary>
    ${dsTableWrap(`<table class="ds-table" dir="rtl"><thead><tr><th>מוסד</th><th>סמל מוסד</th><th>רשות</th><th>פעילות</th><th>חודשי חיוב</th><th>סיבת החסימה</th></tr></thead>
    <tbody>${blocked.map(row=>{const identity=financeActivitySchoolIdentity(data,row);const activity=(data.collectionActivities||[]).find(a=>String(a.row_id)===String(row.activityRowId));const group=[activity?.grade,activity?.class_group].filter(Boolean).join(' · ');return `<tr><td>${escapeHtml(identity.name)}</td><td>${escapeHtml(identity.symbol)}</td><td>${escapeHtml(identity.authority)}</td><td>${escapeHtml(row.activityName || row.activityRowId || '—')}${group?`<small style="display:block;color:var(--ds-text-muted,#64748b)">${escapeHtml(group)}</small>`:''}<small style="display:block;color:var(--ds-text-muted,#64748b)" title="${escapeHtml(row.activityRowId)}">${escapeHtml(String(row.activityRowId).slice(-8))}</small></td><td>${escapeHtml(row.periods.join(' · '))}</td><td>${escapeHtml(row.reasons.join(' · '))}${data.financeCanComplete&&mode!==TRANSACTION_MODE_AUTOMATIC?` <button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-finance-complete-open="${escapeHtml(row.activityRowId)}">השלמת נתונים</button>`:''}</td></tr>${blockedEditorVisible&&String(row.activityRowId)===String(blockedEditorId)?`<tr data-finance-blocked-editor><td colspan="6" style="white-space:normal;padding:8px 0">${financeBillingCompletionEditorHtml(data.billingCompletion)}</td></tr>`:''}`;}).join('')}</tbody></table>`)}
  </details>` : '';
  {
    const selectedMonth = transactionMonth(data, mode);
    const current = mode===TRANSACTION_MODE_AUTOMATIC ? preview.accounts : preview.accounts.filter(account => account.period?.slice(0,7) === selectedMonth);
    const previous = mode===TRANSACTION_MODE_AUTOMATIC ? [] : preview.accounts.filter(account => account.period?.slice(0,7) < selectedMonth);
    const editOpen=Boolean(data.billingAccountEdit||data.billingCompletion);
    const groupsHtml = (accounts, older = false) => accounts.map(account => {
      const heading=mode===TRANSACTION_MODE_AUTOMATIC ? [account.lines.map(line=>financeActivitySchoolIdentity(data,line).authority).find(authority=>authority&&authority!=='—'),account.schoolName,account.institutionSymbol].filter(Boolean).join(' · ') : account.customerName;
      const accountKey=accountPreviewKey(account);
      return `<details class="ds-fin-payer" data-finance-transaction-group${mode===TRANSACTION_MODE_AUTOMATIC&&(preview.accounts.length===1||String(data.billingAccountEdit?.accountKey)===accountKey)?' open':''}>
      <summary><span class="ds-fin-gefen-arrow" aria-hidden="true">▸</span><span class="ds-fin-payer__title">${escapeHtml(heading)}${older ? ` · ${escapeHtml(account.period.slice(0,7))}` : ''}</span>
      <span class="ds-fin-payer__meta" data-gefen-account-key="${escapeHtml(accountKey)}">${mode===TRANSACTION_MODE_AUTOMATIC?new Set(account.lines.map(line=>line.activityRowId)).size:account.lines.length} ${mode===TRANSACTION_MODE_AUTOMATIC?'פעילויות':'חיובים'} · ${escapeHtml(formatAmount(account.totalAmount))}</span></summary>
      ${billingTableHtml(account.lines,data,mode)}
      <div class="ds-fin-gefen-group-actions">
        ${mode===TRANSACTION_MODE_AUTOMATIC&&data.financeCanComplete?`<button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-finance-account-edit-open="${escapeHtml(accountKey)}"${editOpen||data.financeBusy||data.transactionRunning?' disabled':''}>עריכת פרטים</button>`:''}
        ${mode===TRANSACTION_MODE_AUTOMATIC?`<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-finance-transaction-run="automatic" data-finance-transaction-account="${escapeHtml(accountKey)}"${editOpen||data.financeBusy||data.transactionRunning?' disabled':''}>הפקת חשבון</button>`:''}
        <button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-finance-transaction-preview="${mode}" data-finance-transaction-preview-key="${escapeHtml(accountKey)}"${mode===TRANSACTION_MODE_AUTOMATIC&&editOpen?' disabled':''}>תצוגת PDF</button>
      </div></details>`;
    }).join('');
    return `<div class="ds-fin-gefen" dir="rtl">
      ${mode === TRANSACTION_MODE_AUTOMATIC ? `<header class="ds-fin-issuance-toolbar"><div><h2>חשבונות להפקה${preview.accounts.length?` <span>(${preview.accounts.length})</span>`:''}</h2><span class="ds-fin-issuance-cutoff" data-finance-gefen-cycle data-finance-transaction-period-readonly>עד ${escapeHtml(formatDate(transactionGefenCycle(data).cutoff))}</span></div>${preview.accounts.length>1?`<button type="button" class="ds-btn ds-btn--primary" data-finance-transaction-run="automatic" data-finance-transaction-main-run${editOpen||data.financeBusy||data.transactionRunning?' disabled':''}>הפקה מרוכזת</button>`:''}</header>` : monthPicker(data,mode)}
      ${preview.accounts.length ? summaryCards(preview) : ''}
      <section data-finance-gefen-current>${mode!==TRANSACTION_MODE_AUTOMATIC?'<h3>חשבונות החודש הנבחר</h3>':''}
        ${groupsHtml(current) || dsEmptyState('אין חשבונות להפקה בחודש שנבחר.')}</section>
      ${previous.length ? `<section class="ds-fin-gefen-backlog" data-finance-gefen-backlog><h3>חיובים זכאים מחודשים קודמים</h3>${groupsHtml(previous,true)}</section>` : ''}
      ${mode!==TRANSACTION_MODE_AUTOMATIC&&preview.accounts.length ? `<div class="ds-fin-gefen-issue"><button type="button" class="ds-btn ds-btn--primary" data-finance-transaction-run="${mode}" data-finance-transaction-main-run>${escapeHtml(issueButtonLabel(mode, data))}</button></div>` : ''}
      ${data.transactionIssuancePreview ? `<section class="ds-fin-transaction-preview-pane" tabindex="-1" aria-label="תצוגת PDF לפני הפקה"><strong>תצוגת PDF לפני הפקה</strong><p>${escapeHtml(data.transactionIssuancePreview.quote?.customer_name_snapshot || '')} · ${escapeHtml(formatAmount(data.transactionIssuancePreview.quote?.total_amount))}</p><div class="ds-fin-gefen-group-actions"><button type="button" class="ds-btn ds-btn--primary" data-finance-transaction-issuance-pdf-open>פתיחת PDF</button><button type="button" class="ds-btn" data-finance-transaction-issuance-pdf-download>הורדת PDF</button></div></section>` : ''}
      ${mode!==TRANSACTION_MODE_AUTOMATIC&&data.billingCompletion&&!blockedEditorVisible?financeBillingCompletionEditorHtml(data.billingCompletion):''}
      ${waitingHtml}
      ${blockedHtml}
    </div>`;
  }
}

function historyView(data) {
  const search = text(data.transactionHistorySearch).toLocaleLowerCase('he');
  const month = text(data.transactionHistoryMonth);
  const status = text(data.transactionHistoryStatus);
  const balances = new Map((data.paymentContext?.balances || []).map(balance => [balance.accountId,balance]));
  const collectionStatus = account => {
    const balance = balances.get(account.id);
    if (!balance) return account.collection_status;
    if (Number(balance.balance) <= 0) return 'paid';
    return Number(balance.paidAmount) > 0 ? 'partially_paid' : 'awaiting_payment';
  };
  const accounts = (data.transactionContext?.accounts || []).filter(account => {
    if (account.deleted_at || (month && !text(account.issue_date).startsWith(month))) return false;
    if (status && account.document_status !== status && collectionStatus(account) !== status) return false;
    const names = (account.finance_transaction_account_lines || []).flatMap(line => [line.school_name_snapshot,line.funding_snapshot]);
    return !search || [account.transaction_account_number,account.customer_name_snapshot,account.payer_identity_snapshot,...names]
      .some(value => text(value).toLocaleLowerCase('he').includes(search));
  }).sort((a,b) => text(b.transaction_account_number).localeCompare(text(a.transaction_account_number),'en',{numeric:true}));
  const filters = `<div class="ds-fin-manual__selectors">
    <label>חיפוש חשבון<input class="ds-input" type="search" data-finance-history-search value="${escapeHtml(search)}" placeholder="מספר חשבון, בית ספר או מממן"></label>
    <label>חודש הפקה<input class="ds-input" type="month" data-finance-history-month value="${escapeHtml(month)}"></label>
    <label>סטטוס<select class="ds-input" data-finance-history-status><option value="">כל הסטטוסים</option>
      ${['issued','mail_draft_ready','sent','cancelled','awaiting_payment','partially_paid','paid'].map(value =>
        `<option value="${value}"${status===value?' selected':''}>${escapeHtml(statusLabel(value))}</option>`).join('')}
    </select></label>
  </div>`;
  const recovery = !data.financeTransactionsReadOnly && data.pendingPdfUploads?.length
    ? `<section class="ds-fin-manual__section"><h3>חשבונות שהפקתם טרם אומתה</h3>
      ${data.pendingPdfUploads.map(account=>`<p>${escapeHtml(account.customerName)} · ${escapeHtml(formatAmount(account.total))}
        <button type="button" class="ds-btn ds-btn--secondary" data-finance-resume-pdf="${escapeHtml(account.id)}">השלמת הפקה</button></p>`).join('')}</section>` : '';
  if (!accounts.length) return filters+recovery+invoiceRevisionAdminHtml(data)+invoiceRevisionEditorHtml(data)+dsEmptyState('אין חשבונות עסקה התואמים לסינון.');
  return filters+recovery+invoiceRevisionAdminHtml(data)+invoiceRevisionEditorHtml(data)+accounts.map((account) => {
    const balance = balances.get(account.id);
    const actualCollectionStatus = collectionStatus(account);
    const lines = (account.finance_transaction_account_lines || []).map((line) => `<tr>
      <td>${escapeHtml(line.activity_name_snapshot || '—')}</td>
      <td>${escapeHtml(line.funding_snapshot || '—')} · ${escapeHtml(line.school_name_snapshot || '')}</td>
      <td>${escapeHtml(String(line.billed_hours || 0))}</td>
      <td>${escapeHtml(formatAmount(line.amount))}</td>
    </tr>`).join('');
    const pdf = account.sharepoint_web_url
      ? `<a class="ds-btn ds-btn--ghost ds-btn--sm" href="${escapeHtml(account.sharepoint_web_url)}" target="_blank" rel="noopener">מסמך PDF</a>`
      : '';
    return `<details class="ds-fin-payer">
      <summary><span class="ds-fin-payer__title">חשבון ${escapeHtml(String(account.transaction_account_number))} · ${escapeHtml(account.customer_name_snapshot || '')}</span><span class="ds-fin-payer__meta">${escapeHtml(`${formatDate(account.issue_date)} · ${formatAmount(account.total_amount)}`)}</span></summary>
      <div class="ds-fin-history-meta">
        <span>לתשלום עד: <strong>${escapeHtml(formatDate(account.payment_due_date))}</strong></span>
        <span>מסמך: <strong>${escapeHtml(statusLabel(account.document_status))}</strong></span>
        <span>Outlook: <strong>${escapeHtml(statusLabel(account.outlook_status))}</strong></span>
        ${account.outlook_owner_mailbox ? `<span>תיבת המפיק: ${escapeHtml(account.outlook_owner_mailbox)}</span>` : ''}
        ${account.outlook_error ? `<span role="status">${escapeHtml(financeError(new Error(account.outlook_error)))}</span>` : ''}
        ${!data.financeTransactionsReadOnly && (account.outlook_status==='waiting_connection' || account.outlook_error==='invoice_microsoft_account_mismatch') && account.outlook_owner_id===data.financeAuthUserId ? '<button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-finance-microsoft-connect>חיבור Microsoft</button>' : ''}
        <span>גבייה: <strong>${escapeHtml(statusLabel(actualCollectionStatus))}</strong></span>
        ${balance ? `<span>שולם: ${escapeHtml(formatAmount(balance.paidAmount))} · יתרה: ${escapeHtml(formatAmount(balance.balance))}</span>` : ''}
        ${pdf}
        ${data.financeTransactionsReadOnly ? '' : `<button class="ds-btn ds-btn--ghost" data-invoice-revision-open="${escapeHtml(account.id)}">${['issued','mail_draft_ready','sent'].includes(account.document_status)?'עריכת חשבון':'גרסאות ופרטי התיקון'}</button>`}
        ${!data.financeTransactionsReadOnly && account.replaces_account_id?`<button class="ds-btn ds-btn--ghost" data-invoice-revision-open="${escapeHtml(account.replaces_account_id)}">חשבון מקורי שבוטל</button>`:''}
        ${!data.financeTransactionsReadOnly && account.replaced_by_account_id?`<button class="ds-btn ds-btn--ghost" data-invoice-revision-open="${escapeHtml(account.replaced_by_account_id)}">חשבון חלופי</button>`:''}
        ${!data.financeTransactionsReadOnly && ['issued','mail_draft_ready'].includes(account.document_status) && ['pending','failed','missing_recipient','needs_review'].includes(account.outlook_status) ? `<button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-finance-account-draft="${escapeHtml(account.id)}"${data.financeBusy ? ' disabled' : ''}>נסה להשלים את טיוטת הדוא״ל</button>` : ''}
        ${data.financeAdmin ? `<button class="ds-btn ds-btn--ghost" data-finance-account-delete="${escapeHtml(account.id)}">מחיקת חשבון</button>` : ''}
        ${account.cancellation_reason ? `<span>${escapeHtml(account.cancellation_reason)}</span>` : ''}
      </div>
      ${dsTableWrap(`<table class="ds-table" dir="rtl"><thead><tr><th>פעילות</th><th>גורם מימון</th><th>שעות</th><th>סכום</th></tr></thead><tbody>${lines}</tbody></table>`)}
    </details>`;
  }).join('');
}


function transactionApprovalDialogHtml(data) {
  const pending = data.pendingTransactionApproval;
  if (!pending) return '';
  const format = (value) => formatAmount(value);
  const mixed = Array.isArray(pending.mixed) ? pending.mixed : [];
  const mixedHtml = mixed.length ? `<div style="margin-top:14px;text-align:right">
    <strong>פעילויות במימון משותף (חלק הגפ״ן בלבד)</strong>
    <ul style="margin:8px 0;padding-inline-start:22px;line-height:1.7">
      ${mixed.map(row => `<li>${escapeHtml(row.school)} · ${escapeHtml(row.course)} · מספר גפ״ן ${escapeHtml(row.code)}</li>`).join('')}
    </ul></div>` : '';
  return `<div data-finance-transaction-approval-overlay style="position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(12,30,43,.58)" dir="rtl">
    <section role="dialog" aria-modal="true" aria-labelledby="finance-transaction-approval-title"
      style="box-sizing:border-box;width:min(100%,620px);max-height:85vh;overflow:auto;background:var(--ds-bg,#fff);color:var(--ds-text,#142b3c);padding:24px;border-radius:16px;box-shadow:0 12px 50px rgba(0,0,0,.22)">
      <h2 id="finance-transaction-approval-title" style="margin:0 0 10px;font-size:22px">אישור הפקת חשבונות גפ״ן</h2>
      <p style="margin:0 0 8px">חודש ביצוע: <strong>${escapeHtml(pending.month)}</strong></p>
      <p style="margin:0 0 8px">חשבונות להפקה: <strong>${Number(pending.accountCount)}</strong></p>
      <p style="margin:0 0 8px">סכום כולל להפקה: <strong>${escapeHtml(format(pending.amount))}</strong></p>
      ${mixedHtml}
      <p style="margin:12px 0 0">החיוב כולל רק את חלק הגפ״ן ולא את חלקו של המממן השותף. יש לוודא התאמה להזמנות לפני ההפקה.</p>
      <p style="margin:8px 0 18px;color:var(--ds-text-muted,#64748b)">לאחר ההפקה מספרי החשבונות והמפגשים יחויבו ולא ישתנו אוטומטית.</p>
      <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-start">
        <button type="button" class="ds-btn ds-btn--primary" data-finance-transaction-approve>אישור והפקת החשבונות</button>
        <button type="button" class="ds-btn ds-btn--ghost" data-finance-transaction-cancel>ביטול</button>
      </div>
    </section>
  </div>`;
}

export const FINANCE_TRANSACTION_SHAREPOINT_FOLDER_URL = 'https://think365orgil.sharepoint.com/Site9/Shared%20Documents/%D7%A2%D7%99%D7%93%D7%9F%20-%20%D7%98%D7%95%D7%A0%D7%99/%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA%20%D7%A2%D7%A1%D7%A7%D7%94%20-%20%D7%AA%D7%A9%D7%A4%D7%96';

export function transactionAccountsViewHtml(data, backBarHtml) {
  const tab = data.financeTransactionsReadOnly ? 'history' : data.transactionTab === 'completion' && data.financeCanComplete ? 'completion' : ['manual', 'history', 'editable'].includes(data.transactionTab) ? data.transactionTab : 'automatic';
  const action = data.transactionActionMessage
    ? `<div class="ds-empty-state" style="margin-bottom:12px">${escapeHtml(data.transactionActionMessage)}</div>`
    : '';
  const body = data.collectionError ? dsEmptyState(data.collectionError) : tab === 'history' ? historyView(data) : tab === 'editable' ? manualAccountViewHtml(data) : tab === 'completion' ? financeBillingCompletionHtml(data, 'editable') : billingView(data, tab);
  return dsScreenStack(`
    ${backBarHtml('חשבונות עסקה')}
    <div class="ds-fin-collect-shell${tab==='automatic'?' ds-fin-issuance-shell':''}" dir="rtl">
      ${action}
      <div class="ds-fin-transaction-nav">
        ${data.financeTransactionsReadOnly ? '' : `<div class="ds-fin-tabs" role="tablist">
          <button type="button" class="ds-fin-tab${tab === 'automatic' ? ' is-active' : ''}" data-finance-transaction-tab="automatic">גפ״ן</button>
          <button type="button" class="ds-fin-tab${tab === 'manual' ? ' is-active' : ''}" data-finance-transaction-tab="manual">לפי מממן</button>
${data.financeCanComplete ? `          <button type="button" class="ds-fin-tab${tab === 'completion' ? ' is-active' : ''}" data-finance-transaction-tab="completion">עדכון פרטים</button>` : ''}
          <button type="button" class="ds-fin-tab${tab === 'history' ? ' is-active' : ''}" data-finance-transaction-tab="history">חשבונות שהופקו</button>
          <button type="button" class="ds-fin-tab${tab === 'editable' ? ' is-active' : ''}" data-finance-transaction-tab="editable">בהתאמה אישית</button>
        </div>`}
        <a class="ds-fin-transaction-folder-link"
           href="${FINANCE_TRANSACTION_SHAREPOINT_FOLDER_URL}" target="_blank" rel="noopener noreferrer"
           title="תיקיית חשבונות עסקה ב-SharePoint"
           aria-label="פתיחת תיקיית חשבונות עסקה ב-SharePoint">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M3.5 6.75A1.75 1.75 0 0 1 5.25 5h4.1c.46 0 .9.18 1.22.5l1.18 1.18c.33.33.77.52 1.24.52h5.76a1.75 1.75 0 0 1 1.75 1.75v7.8a2.25 2.25 0 0 1-2.25 2.25H5.75a2.25 2.25 0 0 1-2.25-2.25v-10Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3.75 10h16.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </a>
      </div>
      ${body}
      ${financeGefenAccountEditModalHtml(data.billingAccountEdit, data)}
      ${transactionApprovalDialogHtml(data)}
    </div>
  `);
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export async function previewTransactionAccountGroup(data, api, mode, previewKey) {
  const preview = transactionPreviewForVisit(data, mode);
  const account = preview.accounts.find((row) => accountPreviewKey(row) === previewKey);
  if (!account?.lines?.length) throw new Error('לא נמצא חשבון לתצוגה מקדימה.');
  if(mode===TRANSACTION_MODE_AUTOMATIC){
    const output=await api.previewFinanceGefenBillingAccount(gefenBillingRequest(data,account,preview.cutoff));
    if(!output?.pdfBase64)throw Error('לא התקבלה תצוגת PDF');
    data.transactionIssuancePreview=output;return output;
  }
  const items = account.lines.map((line) => ({
    activity: line.activityRowId,
    funder: line.fundingSourceId,
    month: line.period || `${transactionMonth(data, mode)}-01`,
    draft: {
      ...(mode===TRANSACTION_MODE_AUTOMATIC?{automatic_cumulative_preview:true}:{}),
      customer_name: account.customerName,
      customer_email: (account.customerEmails || []).join(';'),
      institution_symbol: account.institutionSymbol || ''
    }
  }));
  const output = items.length > 1
    ? await api.previewFinanceFunderBatchAccount(items)
    : await api.previewFinanceManualAccount(items[0]);
  if (!output?.pdfBase64) throw new Error('לא התקבלה תצוגת PDF');
  data.transactionIssuancePreview = output;
  return output;
}

export async function runTransactionIssuance(data, api, mode, month = transactionMonth(data, mode), previewKey = null) {
  const scoped = { ...data, transactionMonths: { ...data.transactionMonths, [mode]: month } };
  const preview = transactionPreviewForVisit(scoped, mode);
  if (!preview.accounts.length) throw new Error('אין חשבונות מוכנים להפקה.');
  const results = [];
  data.transactionRequestIds ||= {};
  // Automatic Gefen combines unissued periods in a single school account.
  // Keep month-specific source lines/claims for server validation and audit.
  const accounts=preview.accounts.filter(a=>!previewKey||accountPreviewKey(a)===previewKey).sort((a,b)=>String(a.period||'').localeCompare(String(b.period||'')));
  for (const account of accounts) {
    const requestKey=JSON.stringify([mode,account.period?.slice(0,7) || month,account.institutionSymbol,account.lines.map(line=>[line.activityRowId,line.fundingSourceId,line.period,line.issuableAmount,line.unbilledSlots]),mode===TRANSACTION_MODE_AUTOMATIC?gefenBillingRequest(data,account,preview.cutoff):null]);
    data.transactionRequestIds[requestKey] ||= uuid();
    let reserved;
    try {
    if(mode===TRANSACTION_MODE_AUTOMATIC){
      const request=gefenBillingRequest(data,account,preview.cutoff);
      data.transactionBillingQuotes||={};
      const quote=data.transactionBillingQuotes[requestKey]||await api.quoteFinanceGefenBillingAccount(request);
      data.transactionBillingQuotes[requestKey]=quote;
      reserved=await api.reserveFinanceGefenBillingAccount({...request,idempotencyKey:data.transactionRequestIds[requestKey],revision:quote.revision});
    }else reserved = await api.reserveFinanceTransactionAccount({
      idempotencyKey: data.transactionRequestIds[requestKey],
      cutoffDate: preview.cutoff,
      institutionSymbol: account.institutionSymbol,
      customerName: account.customerName,
      customerEmail: (account.customerEmails || []).join(';'),
      lines: account.lines.map((line) => ({
        activity_row_id: line.activityRowId,
        funding_source_id: line.fundingSourceId,
        performance_month: line.period,
        billing_range_end: transactionMonth(scoped,mode)+'-01',
        expected_amount: line.issuableAmount,
        meeting_slots: line.unbilledSlots.map((slot) => slot.slot),
        issue_mode: mode
      }))
    });
    const dispatched = await api.dispatchFinanceTransactionAccount({ accountId: reserved.id });
    results.push({ reserved, dispatched });
    } catch (error) {
      if (reserved && api.cancelFinanceTransactionReservation && !['finance_pdf_upload_outcome_unknown','finance_pdf_connection_failed'].includes(error.message)) {
        try { await api.cancelFinanceTransactionReservation(reserved.id); delete data.transactionRequestIds[requestKey]; delete data.transactionBillingQuotes?.[requestKey]; }
        catch { /* an issued account or active worker must remain intact */ }
      }
      results.push({reserved,accountLabel: account.customerName || account.schoolName || account.institutionSymbol || 'חשבון עסקה',error:String(error?.message || 'ההפקה לא הושלמה')});
    }
  }
  return results;
}

export function transactionIssuanceResultMessage(results) {
  const issued=results.filter(r=>!r.error || r.dispatched?.documentPreserved).length;
  const ready=results.filter(r=>r.dispatched?.outlookStatus==='draft_ready').length;
  const missing=results.filter(r=>r.dispatched?.outlookStatus==='missing_recipient').length;
  const waiting=results.filter(r=>r.dispatched?.outlookStatus==='waiting_connection').length;
  const failed=results.filter(r=>r.error || ['failed','needs_review'].includes(r.dispatched?.outlookStatus)).length;
  const errors = results.filter(result => result.error).slice(0, 5)
    .map(result => `${result.accountLabel || 'חשבון עסקה'}: ${financeError(new Error(result.error))}`);
  return `נשמרו ${issued} חשבונות עסקה. נוצרו ${ready} טיוטות דוא״ל.${waiting ? ` ${waiting} טיוטות ממתינות לחיבור Microsoft של המפיק המקורי ויושלמו אוטומטית לאחר החיבור.` : ''}${missing ? ` חסרים נמענים ל-${missing} חשבונות.` : ''}${failed ? ` ${failed} פעולות לא הושלמו. ${errors.join(' | ') || 'יש לבדוק את הפרטים בהיסטוריה.'}` : ''}`;
}

export function handleTransactionSelection(data, rowId, checked) {
  data.transactionManualSelected = { ...(data.transactionManualSelected || {}), [text(rowId)]: checked === true };
}

export function handleTransactionGroupSelection(data, keys, checked) {
  const selection = { ...(data.transactionManualSelected || {}) };
  for (const key of new Set(keys)) selection[text(key)] = checked === true;
  data.transactionManualSelected = selection;
}

// Update checkbox state in-place. Re-rendering the entire screen on each click
// destroys <details> nodes, which collapses the user's expanded billing period.
export function syncTransactionSelectionUi(root, data) {
  if (!root) return;
  const selection = data.transactionManualSelected || {};
  root.querySelectorAll('[data-finance-transaction-select]').forEach((checkbox) => {
    checkbox.checked = selection[checkbox.dataset.financeTransactionSelect] === true;
  });
  root.querySelectorAll('[data-finance-transaction-group]').forEach((group) => {
    const all = group.querySelector('[data-finance-transaction-select-all]');
    if (!all) return;
    const entries = [...group.querySelectorAll('[data-finance-transaction-select]')];
    const checked = entries.filter((checkbox) => checkbox.checked).length;
    all.checked = entries.length > 0 && checked === entries.length;
    all.indeterminate = checked > 0 && checked < entries.length;
  });
  const main = root.querySelector('[data-finance-transaction-main-run]');
  if (main) {
    const mode = main.dataset.financeTransactionRun || TRANSACTION_MODE_MANUAL;
    const canIssue = transactionPreviewForVisit(data, mode).accounts.length > 0;
    main.disabled = !canIssue;
    main.style.display = canIssue ? '' : 'none';
    main.textContent = issueButtonLabel(mode, data);
  }
  const selectedBacklogMonths = new Set(transactionBacklog(data, TRANSACTION_MODE_MANUAL)
    .filter((row) => selection[transactionSelectionKey(row)] === true)
    .map((row) => row.period.slice(0,7)));
  root.querySelectorAll('[data-finance-transaction-run="manual"][data-finance-transaction-period]').forEach((button) => {
    button.disabled = !selectedBacklogMonths.has(button.dataset.financeTransactionPeriod);
  });
}

export function syncGefenBillingInput(root,data,input){
  const preview=transactionPreviewForVisit(data,'automatic');
  const lines=preview.accounts.flatMap(a=>a.lines);
  if(!updateGefenBillingValue(data,lines,input.dataset.gefenBillingKey,input.dataset.gefenBillingField,input.value))return;
  input.setCustomValidity('');
  const updated=transactionPreviewForVisit(data,'automatic');
  const group=gefenBillingGroups(lines).find(g=>g.key===input.dataset.gefenBillingKey);
  const amount=input.closest('[data-gefen-billing-row]')?.querySelector('[data-gefen-billing-amount]');
  if(amount)amount.textContent=formatAmount(gefenBillingAmount(gefenBillingValues(data,group)));
  const summary=root.querySelector('[data-gefen-billing-summary]');if(summary)summary.outerHTML=summaryCards(updated);
  root.querySelectorAll('[data-gefen-account-key]').forEach(node=>{const a=updated.accounts.find(a=>accountPreviewKey(a)===node.dataset.gefenAccountKey);if(a)node.textContent=`${new Set(a.lines.map(l=>l.activityRowId)).size} פעילויות · ${formatAmount(a.totalAmount)}`;});
  root.querySelector('.ds-fin-transaction-preview-pane')?.remove();
}

export const transactionAccountPreviewKey = accountPreviewKey;

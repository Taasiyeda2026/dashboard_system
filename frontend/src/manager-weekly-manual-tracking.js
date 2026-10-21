import { state } from './state.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { activitySeasonQueryValues } from './screens/shared/summer-activity.js';

export const MANUAL_METRICS = [
  ['activities', 'סה״כ פעילויות באחריותי'],
  ['schools', 'מספר בתי ספר'],
  ['unassigned', 'פעילויות ללא מדריך'],
  ['planned', 'קורסים צפויים להתחיל השבוע'],
  ['started', 'קורסים שהתחילו בפועל השבוע']
];
const READONLY_ROLES = new Set(['admin', 'operation_manager']);
const CLOSED = new Set(['בוטל', 'מבוטל', 'נמחק', 'סגור', 'cancelled', 'canceled', 'deleted', 'closed', 'inactive']);
const TRACKER_CLASS = 'mw-tracker';
export const REPORT_START = '2026-10-04';
export const REPORT_END = '2027-06-30';
const REPORT_LAST_WEEK = '2027-06-27';
const inReportPeriod = week => week >= REPORT_START && week <= REPORT_LAST_WEEK;
const clampReportWeek = week => week < REPORT_START ? REPORT_START : week > REPORT_LAST_WEEK ? REPORT_LAST_WEEK : week;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const val = (value) => String(value ?? '').trim();
const isoDate = (date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const dateFromIso = (iso) => new Date(String(iso).slice(0, 10) + 'T12:00:00');

export function weekStartIso(date) {
  const d = date instanceof Date ? new Date(date.getTime()) : dateFromIso(date);
  d.setDate(d.getDate() - d.getDay());
  return isoDate(d);
}
export function shiftWeek(iso, steps) {
  const d = dateFromIso(iso);
  d.setDate(d.getDate() + steps * 7);
  return isoDate(d);
}
function initialWeek(ym) {
  const current = new Date();
  if (ym === isoDate(current).slice(0, 7)) return weekStartIso(current);
  return weekStartIso(ym + '-01');
}
function labelWeek(start) {
  const end = dateFromIso(start);
  end.setDate(end.getDate() + 6);
  if (inReportPeriod(start) && isoDate(end) > REPORT_END) end.setTime(dateFromIso(REPORT_END).getTime());
  const short = (d) => [String(d.getDate()).padStart(2, '0'), String(d.getMonth() + 1).padStart(2, '0')].join('.');
  return short(dateFromIso(start)) + '–' + short(end);
}
function nullReport(week) {
  return { week_start: week, status: 'current', metrics: {}, openings: [], highlights: '', next_steps: '', blockers: '', instructor_notes: '', kit_notes: '' };
}
function validMetric(v) {
  return Number.isSafeInteger(Number(v)) && Number(v) >= 0;
}
export function validateWeeklyReport(report) {
  for(const [key,label] of MANUAL_METRICS) {
    if(!Object.prototype.hasOwnProperty.call(report.metrics||{},key) || !validMetric(report.metrics[key]))
      return 'יש למלא מספר תקין במדד: '+label;
  }
  return '';
}
let active = null;
const styles = [
  '.mw-tracker{direction:rtl;padding:20px 22px;margin-top:14px;border:1px solid #dce5ee;border-radius:16px;background:#fff;color:#253650;box-shadow:0 2px 9px #1f385309;font-size:13.5px}',
  '.mw-tracker *{box-sizing:border-box}.mw-tracker h2,.mw-tracker h3,.mw-tracker p{margin:0}',
  '.mw-header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}.mw-header h2{font-size:19px;font-weight:800}.mw-muted{color:#718096;font-size:12px}.mw-tag{display:inline-flex;padding:5px 10px;border:1px solid #b9dbe6;border-radius:8px;background:#f0f9fc;color:#17657d;font-size:12px;font-weight:700}',
  '',
  '.mw-toolbar{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:14px 0}.mw-left{display:flex;gap:7px;align-items:center;flex-wrap:wrap}',
  '.mw-btn{border:1px solid #cad8e5;background:#fff;border-radius:8px;padding:8px 11px;color:#28445d;font-weight:650;cursor:pointer;font-family:inherit;font-size:12px}.mw-btn:hover{background:#eef7fa}.mw-btn:disabled{opacity:.5;cursor:not-allowed}.mw-primary{background:#2496b3;color:#fff;border-color:#2496b3}.mw-primary:hover{background:#1c819d;color:#fff}',
  '.mw-table-scroll{overflow:visible;max-width:100%;border:1px solid #e0e7ef;border-radius:11px;margin:11px 0 8px}.mw-table{width:100%;min-width:0;table-layout:fixed;border-collapse:collapse;text-align:center}.mw-table th,.mw-table td{padding:10px 8px;border-bottom:1px solid #e8edf3;vertical-align:middle;text-align:center;overflow-wrap:anywhere}.mw-table th:first-child,.mw-table td:first-child{width:31%;text-align:right;background:#fff}.mw-table thead th{background:#f5f8fb;font-size:12px;color:#586b7d}.mw-table tr:last-child td,.mw-table tr:last-child th{border-bottom:0}.mw-table tbody th{font-weight:600;text-align:right}.mw-table thead th:first-child{background:#f5f8fb}.mw-table .mw-current{background:#dff3fa;color:#154f69;font-weight:750}.mw-table thead .mw-current{background:#c8e9f4;box-shadow:inset 0 3px 0 #1684aa}.mw-table .mw-focus{background:#f1f8fd}.mw-table thead .mw-focus{box-shadow:inset 0 3px 0 #8ab6d0}.mw-week-btn{display:flex;flex-direction:column;align-items:center;gap:3px;width:100%;border:0;background:transparent;color:inherit;cursor:pointer;font-weight:750;padding:3px;text-align:center}.mw-week-btn:hover .mw-week-range{text-decoration:underline}.mw-week-kind{font-size:10px;font-weight:800;color:#1c7894}.mw-week-range{font-size:12px}.mw-week-status{display:block;font-weight:400;color:#71899a;font-size:10px}.mw-week-navigation{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;margin:0 0 18px}.mw-week-picker{position:relative}.mw-week-picker>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid #cad8e5;border-radius:8px;color:#28445d;font-size:12px;font-weight:650;background:#fff}.mw-week-picker>summary::-webkit-details-marker{display:none}.mw-week-picker[open]>summary{background:#eef8fb;border-color:#9fc5d6}.mw-week-picker-options{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:10px;border:1px solid #d9e5ed;border-radius:9px;margin-top:5px;max-width:min(600px,calc(100vw - 80px));background:#fafdff}.mw-week-choice{font-variant-numeric:tabular-nums;padding:6px 9px;font-size:11px}.mw-week-choice.is-selected{background:#e5f3fa;border-color:#3395b1}.mw-collapse-extra{border-color:#a9d4e0}.mw-table .mw-out-of-period{background:#f7f9fa;color:#9baab4}.mw-week-placeholder{cursor:default}.mw-extra-panel{background:#f8fbfd;border:1px solid #d9e8ee;border-radius:10px;margin:10px 0 18px;padding:13px}.mw-extra-panel-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;color:#28475c}.mw-extra-panel-head span{font-size:12px;color:#627f8c}.mw-extra-panel-head .mw-btn{margin-inline-start:auto}.mw-extra-table{width:100%;border-collapse:collapse;table-layout:fixed}.mw-extra-table th,.mw-extra-table td{border-bottom:1px solid #e0ebf0;padding:7px 10px;text-align:right}.mw-extra-table thead th{background:#ecf5fa}',
  '.mw-section{border-top:1px solid #e5ebf1;padding-top:17px;margin-top:16px}.mw-section-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}.mw-section h3{font-size:15px;font-weight:750}',
  '.mw-fields{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.mw-field{display:flex;flex-direction:column;gap:5px;color:#506376;font-size:12px;font-weight:600}.mw-field input,.mw-field textarea,.mw-field select{border:1px solid #cad7e2;border-radius:8px;min-height:36px;padding:8px 10px;color:#1c3449;background:#fff;font-size:13px;font-family:inherit;width:100%;direction:rtl}.mw-fields .mw-field{min-width:0}.mw-fields .mw-field input{width:100%;min-width:0;box-sizing:border-box;align-self:flex-start}.mw-field textarea{min-height:72px;resize:vertical}.mw-field input:focus,.mw-field textarea:focus{outline:2px solid #b3e5f0}.mw-textareas{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.mw-opening{display:grid;grid-template-columns:1fr 1fr 1fr 132px 1fr auto;gap:7px;align-items:end;padding:9px;border:1px solid #e3ebf1;border-radius:9px;margin-top:8px;background:#fcfdff}.mw-opening .mw-field{min-width:0}.mw-opening-extra{grid-column:1/-1}',
  '.mw-foot{display:flex;align-items:center;gap:9px;justify-content:flex-end;flex-wrap:wrap;margin-top:15px}.mw-error{color:#b42318;background:#fff1f1;border:1px solid #f2d0ce;padding:10px;border-radius:9px;margin:10px 0}.mw-notice{color:#135d4e;background:#eafaf3;border:1px solid #c9ecdc;padding:10px;border-radius:9px;margin:10px 0}.mw-verify{margin-top:12px;background:#f5fafc;border:1px solid #dceaf0;border-radius:10px;padding:11px}.mw-verify ul{margin:8px 20px 0 0;padding:0}.mw-empty{padding:24px;text-align:center;color:#64748b}.mw-program{border:1px solid #e3ebf1;border-radius:10px;margin:10px 0;padding:12px;background:#fbfdff}.mw-program-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:9px}.mw-sr-only{position:absolute;left:-10000px}',
  '.mw-report-entry [data-mw-report-fields][hidden]{display:none!important}.mw-entry-status{margin-inline-start:auto}.mw-entry-chevron{font-size:16px}.mw-task-scroll{overflow:auto;max-width:100%;border:1px solid #e2ebf0;border-radius:10px;margin:12px 0}.mw-task-table{width:100%;min-width:1150px;border-collapse:collapse;text-align:right}.mw-task-table th,.mw-task-table td{padding:8px;border-bottom:1px solid #e5edf1}.mw-task-table th{background:#f4f8fb;white-space:nowrap;font-size:12px}.mw-task-table td input,.mw-task-table td select{width:100%;border:1px solid #cbdce5;border-radius:7px;padding:7px;min-height:34px;font:inherit;font-size:12px;background:#fff;color:#23384b;box-sizing:border-box}.mw-task-table td input:disabled,.mw-task-table td select:disabled{background:#f5f7f9}.mw-task-form{display:grid;grid-template-columns:1.4fr 1fr .9fr .9fr .8fr;gap:8px;align-items:end;margin-top:11px}.mw-task-form .mw-field{margin:0}.mw-task-notes{margin-top:8px}.mw-task-status{font-size:11px;color:#62778a}.mw-snapshot{border:1px solid #e1e9f0;background:#f8fbfd;padding:12px;border-radius:10px;margin-top:12px}.mw-snapshot ul{margin:7px 20px 0 0;padding:0}.mw-snapshot li{line-height:1.6}.mw-task-empty{padding:14px;color:#62768a;text-align:center}',
  '@media(max-width:950px){.mw-fields{grid-template-columns:repeat(2,minmax(0,1fr))}.mw-opening{grid-template-columns:repeat(2,minmax(0,1fr))}.mw-opening-extra{grid-column:auto}.mw-task-form{grid-template-columns:repeat(2,minmax(0,1fr))}}',
  '@media(max-width:610px){.mw-tracker{padding:13px 11px}.mw-fields,.mw-textareas,.mw-program-grid,.mw-opening{grid-template-columns:1fr}.mw-header h2{font-size:17px}.mw-section{margin-top:12px}.mw-opening-extra{grid-column:auto}.mw-table th,.mw-table td{padding:8px 4px;font-size:11px}.mw-week-kind,.mw-week-status{font-size:9px}.mw-week-range{font-size:10px}.mw-week-picker-options{max-width:calc(100vw - 55px)}}'
].join('');
function ensureStyle() {
  if (document.getElementById('manager-weekly-manual-style')) return;
  const el = document.createElement('style');
  el.id = 'manager-weekly-manual-style';
  el.textContent = styles;
  document.head.appendChild(el);
}
function contextKey(ctx) { return [ctx.managerName, ctx.year, ctx.ym].join('|'); }
function isCurrent(ctx) { return active === ctx && ctx.host.isConnected; }
function setNotice(ctx, message, error = false) {
  ctx.notice = message ? { message, error } : null;
  const holder = ctx.host.querySelector('[data-mw-notice]');
  if (holder) holder.innerHTML = message ? '<div class="' + (error ? 'mw-error' : 'mw-notice') + '" role="status">' + esc(message) + '</div>' : '';
}
function safeOpening(row) {
  return {
    authority: val(row.authority), school: val(row.school), program: val(row.program),
    start_date: val(row.start_date), instructor: val(row.instructor),
    training: val(row.training), kits: val(row.kits), materials: val(row.materials), issue: val(row.issue)
  };
}
function currentReport(ctx) {
  return (ctx.editingReport?.week_start===ctx.week?ctx.editingReport:null) ||
    ctx.reports.find(r=>r.week_start===ctx.week) || nullReport(ctx.week);
}
function inputField(label, key, value, opts = {}) {
  return '<label class="mw-field"><span>' + esc(label) + '</span>' +
    (opts.textarea
      ? '<textarea data-mw-input="' + esc(key) + '" maxlength="3000" ' + (opts.disabled ? 'disabled' : '') + '>' + esc(value) + '</textarea>'
      : '<input data-mw-input="' + esc(key) + '" type="' + (opts.type || 'text') + '" ' +
          (opts.type === 'number' ? 'min="0" step="1" ' : '') + 'value="' + esc(value) + '" ' +
          (opts.disabled ? 'disabled' : '') + ' maxlength="300"/>') +
    '</label>';
}
function readForm(ctx) {
  const previous=currentReport(ctx);
  const metrics={...(previous.metrics||{})};
  for(const [key] of MANUAL_METRICS) {
    const value=ctx.host.querySelector('[data-mw-metric="'+key+'"]')?.value??'';
    if(value!=='')metrics[key]=Number(value);
    else delete metrics[key];
  }
  // Preserve legacy details and notes without asking managers to re-enter them.
  return {...previous,metrics};
}
/** For תשפ״ז, only weeks starting within 04.10.2026—30.06.2027 can be selected. */
function timelineCurrentWeek(ctx) {
  return clampReportWeek(weekStartIso(ctx.today || new Date()));
}
function timelineWeeks() {
  const weeks=[];
  for(let week=REPORT_START;week<=REPORT_LAST_WEEK;week=shiftWeek(week,1))weeks.push(week);
  return weeks;
}
/** RTL column order: previous (right), current (centre), next (left), ALWAYS 3. */
function visibleWeeks(ctx) {
  const current=timelineCurrentWeek(ctx);
  return [shiftWeek(current,-1),current,shiftWeek(current,1)];
}
function extraWeekMarkup(ctx) {
  const base=visibleWeeks(ctx);
  const week=ctx.expandedWeek;
  if(!week || base.includes(week) || !inReportPeriod(week))return '';
  const report=ctx.reports.find(r=>r.week_start===week);
  const status=report?.status==='submitted'?'דווח להנהלה':report?'נתונים שמורים':'לא מולא';
  return '<section class="mw-extra-panel" aria-label="נתונים לשבוע נוסף">'+
    '<div class="mw-extra-panel-head"><strong>שבוע נוסף: '+labelWeek(week)+'</strong>'+
    '<span>'+status+'</span><button type="button" class="mw-btn" data-mw-collapse>סגור שבוע נוסף</button></div>'+
    '<table class="mw-extra-table"><thead><tr><th scope="col">מדד</th><th scope="col">ערך</th></tr></thead><tbody>'+
    MANUAL_METRICS.map(([key,label])=>'<tr><th scope="row">'+esc(label)+'</th><td>'+
      (report?.metrics?.[key]==null?'—':esc(report.metrics[key]))+'</td></tr>').join('')+
    '</tbody></table></section>';
}
function weekSelector(ctx) {
  const [previous,current,next]=visibleWeeks(ctx),all=timelineWeeks();
  const group=(title,weeks,kind)=>weeks.length?
    '<details class="mw-week-picker" data-mw-picker="'+kind+'"><summary>'+title+' <span aria-hidden="true">▾</span></summary>'+
    '<div class="mw-week-picker-options" role="group" aria-label="'+title+'">'+weeks.map(week=>
      '<button type="button" class="mw-btn mw-week-choice'+(week===ctx.expandedWeek?' is-selected':'')+
      '" data-mw-week="'+esc(week)+'" aria-pressed="'+(week===ctx.expandedWeek)+'">'+labelWeek(week)+
      (ctx.reports.some(r=>r.week_start===week)?' •':'')+'</button>').join('')+'</div></details>':'';
  return '<div class="mw-week-navigation" aria-label="פתיחת שבועות נוספים">'+
    group('שבועות קודמים',all.filter(week=>week<previous).reverse(),'past')+
    group('שבועות הבאים',all.filter(week=>week>next),'future')+
    '</div>'+extraWeekMarkup(ctx);
}
function tableMarkup(ctx) {
  const weeks=visibleWeeks(ctx),current=timelineCurrentWeek(ctx);
  const labels=['השבוע שחלף','השבוע הנוכחי','השבוע הבא'];
  const cls=(week)=>week===current?'mw-current':'';
  const headers=weeks.map((week,i)=>{
    const valid=inReportPeriod(week);
    const report=valid?ctx.reports.find(r=>r.week_start===week):null;
    const status=!valid?'מחוץ לתקופת המעקב':
      report?.status==='submitted'?'דווח להנהלה':report?'נשמר':'לא מולא';
    const label=valid?labelWeek(week):'—';
    return '<th scope="col" class="'+cls(week)+(valid?'':' mw-out-of-period')+'">'+
      (valid?'<button type="button" class="mw-week-btn" data-mw-week="'+esc(week)+'" '+
        (week===ctx.week?'aria-current="date"':'')+'>':
        '<div class="mw-week-btn mw-week-placeholder">')+
      '<span class="mw-week-kind">'+labels[i]+'</span>'+
      '<span class="mw-week-range">'+label+'</span><span class="mw-week-status">'+status+'</span>'+
      (valid?'</button>':'</div>')+'</th>';
  }).join('');
  const rows=MANUAL_METRICS.map(([metric,title])=>'<tr><th scope="row">'+esc(title)+'</th>'+
    weeks.map(week=>{
      const report=inReportPeriod(week)?ctx.reports.find(r=>r.week_start===week):null;
      const number=report?.metrics?.[metric];
      return '<td class="'+cls(week)+'" style="font-variant-numeric:tabular-nums">'+
        (number==null?'—':esc(number))+'</td>';
    }).join('')+'</tr>').join('');
  return '<div class="mw-table-scroll"><table class="mw-table">'+
    '<thead><tr><th scope="col">מדדים</th>'+headers+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+
    weekSelector(ctx);
}
function formMarkup(ctx) {
  const report=currentReport(ctx);
  const locked=report.status==='submitted'||!ctx.canEdit;
  const exists=!!ctx.reports.find(r=>r.week_start===ctx.week);
  const status=report.status==='submitted'?'דווח להנהלה '+new Date(report.submitted_at).toLocaleString('he-IL'):
    exists?'נתונים שמורים':'טרם הוזנו נתונים';
  const metrics='<div class="mw-fields">'+MANUAL_METRICS.map(([key,title])=>
    '<label class="mw-field"><span>'+esc(title)+'</span><input type="number" min="0" step="1" data-mw-metric="'+
    esc(key)+'" value="'+esc(report.metrics?.[key]??'')+'" '+(locked?'disabled':'')+'/></label>').join('')+'</div>';
  const buttons=locked?'<span class="mw-muted">הדיווח השבועי נשמר להנהלה.</span>':
    '<button type="button" class="mw-btn" data-mw-save>שמירת נתונים</button>'+
    '<button type="button" class="mw-btn mw-primary" data-mw-submit>הגשת הדיווח להנהלה</button>';
  const expanded=!!ctx.entryExpanded;
  const header='<div class="mw-section-head"><h3>מילוי המדדים – '+esc(labelWeek(ctx.week))+'</h3>'+
    '<span class="mw-tag mw-entry-status" data-mw-saving-state role="status">'+esc(status)+'</span>'+
    '<button type="button" class="mw-btn mw-entry-toggle" data-mw-toggle aria-expanded="'+expanded+
    '" aria-controls="mw-report-fields">'+(expanded?'שמור וסגור':locked?'הצגת המדדים':'פתח מילוי מדדים')+
    '<span class="mw-entry-chevron" aria-hidden="true">'+(expanded?'▴':'▾')+'</span></button></div>';
  return '<section class="mw-section mw-report-entry" data-mw-report-entry>'+header+
    '<div id="mw-report-fields" data-mw-report-fields'+(expanded?'':' hidden')+'>'+
    metrics+'<div class="mw-foot">'+buttons+'</div></div>'+
    snapshotMarkup(report)+'<div data-mw-verification></div></section>';
}
const TASK_CATEGORIES = [
  ['unassigned','פעילות שלא שובצה'],
  ['instructor_shortage','חוסר במדריכים'],
  ['instructor_cancellation','ביטול מדריך'],
  ['assignment','בעיה בשיבוץ'],
  ['school','בעיה בתיאום'],
  ['kit','חוסר בערכות'],
  ['training','חוסר בהכשרות'],
  ['materials','חוסר בחומרי הדרכה'],
  ['other','אחר']
];
const TASK_STATUSES = [['open','פתוח'],['closed','סגור']];
const issueIsClosed = status => status==='closed'||status==='done';
function optionsHtml(options, chosen) {
  return options.map(([value,label])=>'<option value="'+esc(value)+'"'+(value===chosen?' selected':'')+'>'+esc(label)+'</option>').join('');
}
function taskField(task,key,opts={}) {
  return '<input data-mw-task-field="'+key+'" type="'+(opts.type||'text')+'" value="'+esc(task[key] ?? '')+'"'+
    (opts.disabled?' disabled':'')+' maxlength="'+(opts.max||250)+'" aria-label="'+esc(opts.label||key)+'"/>';
}
function taskSummary(tasks) {
  const pending=tasks.filter(t=>!issueIsClosed(t.status));
  const now=isoDate(new Date());
  const overdue=pending.filter(t=>t.due_date && t.due_date < now);
  return {pending:pending.length,done:tasks.length-pending.length,overdue:overdue.length};
}
function taskMarkup(ctx) {
  const entries=[...ctx.tasks].sort((a,b)=>{
    const aDone=issueIsClosed(a.status),bDone=issueIsClosed(b.status);
    if(aDone!==bDone)return aDone?1:-1;
    return String(a.due_date||'9999-12-31').localeCompare(String(b.due_date||'9999-12-31'));
  });
  const locked=!ctx.canEdit;
  const header='';
  const tableRows=entries.map((t)=>{
    const id=esc(t.id);
    const select=(field,options,value)=>'<select data-mw-task-field="'+field+'" '+(locked?'disabled':'')+' aria-label="'+esc(field)+'">'+optionsHtml(options,value)+'</select>';
    return '<tr data-mw-task-row="'+id+'"><td>'+taskField(t,'subject',{disabled:locked,label:'תיאור הבעיה'})+'</td>'+
      '<td>'+taskField(t,'activity_label',{disabled:locked,label:'בית ספר / פעילות'})+'</td>'+
      '<td>'+select('category',TASK_CATEGORIES,t.category)+'</td>'+
      '<td>'+taskField(t,'owner_label',{disabled:locked,label:'אחראי'})+'</td>'+
      '<td>'+taskField(t,'due_date',{disabled:locked,type:'date',label:'תאריך יעד'})+'</td>'+
      '<td>'+select('status',TASK_STATUSES,t.status)+'</td>'+
      '<td>'+taskField(t,'notes',{disabled:locked,label:'הערות / מעקב'})+'</td>'+
      '<td>'+(locked?'<span class="mw-task-status">צפייה</span>':
        '<button type="button" class="mw-btn" data-mw-task-save="'+id+'">שמירת עדכון</button>')+'</td></tr>';
  }).join('');
  const table=entries.length?'<div class="mw-task-scroll"><table class="mw-task-table"><thead><tr><th>תיאור הבעיה</th><th>פעילות / בית ספר</th><th>סוג הבעיה</th><th>אחראי</th><th>תאריך יעד</th><th>סטטוס</th><th>הערות / מעקב</th><th>פעולה</th></tr></thead><tbody>'+tableRows+'</tbody></table></div>':
    '<div class="mw-task-empty">לא דווחו עדיין בעיות למעקב.</div>';
  const add=locked?'':('<div class="mw-section"><h3>הוספת בעיה למעקב</h3><div class="mw-task-form">'+
    '<label class="mw-field"><span>תיאור הבעיה *</span><input data-mw-task-new="subject" maxlength="250" placeholder="לדוגמה: אין מדריך משובץ לקורס"/></label>'+
    '<label class="mw-field"><span>בית ספר / קורס</span><input data-mw-task-new="activity_label" maxlength="250"/></label>'+
    '<label class="mw-field"><span>סוג הבעיה</span><select data-mw-task-new="category">'+optionsHtml(TASK_CATEGORIES,'unassigned')+'</select></label>'+
    '<label class="mw-field"><span>אחראי</span><input data-mw-task-new="owner_label" maxlength="120"/></label>'+
    '<label class="mw-field"><span>תאריך יעד</span><input data-mw-task-new="due_date" type="date"/></label>'+
    '<label class="mw-field"><span>סטטוס</span><select data-mw-task-new="status">'+optionsHtml(TASK_STATUSES,'open')+'</select></label></div>'+
    '<label class="mw-field mw-task-notes"><span>הערות / מעקב</span><input data-mw-task-new="notes" maxlength="1200" placeholder="מה נעשה ומה עוד נדרש?"/></label>'+
    '<div class="mw-foot"><button type="button" class="mw-btn mw-primary" data-mw-task-add>שמירת בעיה</button></div></div>');
  return header+table+add+'<div data-mw-task-notice role="status"></div>';
}
function taskNotice(ctx,msg,error=false) {
  const node=ctx.host.querySelector('[data-mw-task-notice]');
  if(node)node.innerHTML=msg?'<div class="'+(error?'mw-error':'mw-notice')+'">'+esc(msg)+'</div>':'';
}
function refreshTaskSection(ctx) {
  const node=ctx.host.querySelector('[data-mw-tasks-root]');
  if(!node)return;
  node.innerHTML=taskMarkup(ctx);
  node.querySelector('[data-mw-task-add]')?.addEventListener('click',()=>addTask(ctx));
  node.querySelectorAll('[data-mw-task-save]').forEach(b=>b.addEventListener('click',()=>saveTask(ctx,b.dataset.mwTaskSave)));
}
async function addTask(ctx) {
  if(!ctx.canEdit || ctx.taskBusy || !isCurrent(ctx))return;
  const root=ctx.host;
  const read=key=>val(root.querySelector('[data-mw-task-new="'+key+'"]')?.value);
  const subject=read('subject');
  if(!subject)return taskNotice(ctx,'יש למלא את תיאור הבעיה.',true);
  ctx.taskBusy=true;
  const addBtn=root.querySelector('[data-mw-task-add]');
  if(addBtn)addBtn.disabled=true;
  try {
    const payload={
      manager_user_id:ctx.managerId,school_year:ctx.year,subject,
      activity_label:read('activity_label'),category:read('category')||'other',
      owner_label:read('owner_label'),due_date:read('due_date')||null,notes:read('notes'),status:read('status')||'open'
    };
    const {data,error}=await supabase.from('manager_ongoing_tasks').insert(payload).select('*').single();
    if(error)throw error;
    if(!isCurrent(ctx))return;
    ctx.tasks.push(data);
    refreshTaskSection(ctx);
    taskNotice(ctx,'הבעיה נשמרה במעקב.');
  } catch(error) {taskNotice(ctx,'לא ניתן לשמור בעיה: '+error.message,true);}
  finally {ctx.taskBusy=false;if(addBtn?.isConnected)addBtn.disabled=false;}
}
async function saveTask(ctx,id) {
  if(!ctx.canEdit || ctx.taskBusy || !isCurrent(ctx))return;
  const task=ctx.tasks.find(t=>t.id===id);
  const row=[...ctx.host.querySelectorAll('[data-mw-task-row]')].find(r=>r.dataset.mwTaskRow===id);
  if(!row||!task)return;
  const read=key=>val(row.querySelector('[data-mw-task-field="'+key+'"]')?.value);
  if(!read('subject'))return taskNotice(ctx,'תיאור הבעיה הוא שדה חובה.',true);
  ctx.taskBusy=true;
  const button=row.querySelector('[data-mw-task-save]');
  if(button)button.disabled=true;
  try {
    const payload={
      subject:read('subject'),activity_label:read('activity_label'),
      category:read('category'),owner_label:read('owner_label'),
      due_date:read('due_date')||null,status:read('status'),notes:read('notes')
    };
    const {data,error}=await supabase.from('manager_ongoing_tasks')
      .update(payload).eq('id',id).eq('manager_user_id',ctx.managerId).select('*').single();
    if(error)throw error;
    if(!isCurrent(ctx))return;
    ctx.tasks=ctx.tasks.map(t=>t.id===id?data:t);
    refreshTaskSection(ctx);
    taskNotice(ctx,'עדכון הבעיה נשמר.');
  } catch(error) {taskNotice(ctx,'עדכון הבעיה נכשל: '+error.message,true);}
  finally {ctx.taskBusy=false;if(button?.isConnected)button.disabled=false;}
}
function frozenTaskSnapshot(ctx) {
  const currentWeek=ctx.week;
  const recent=ctx.tasks.filter(t=>!issueIsClosed(t.status) ||
    (t.updated_at && t.updated_at.slice(0,10)>=currentWeek));
  return recent.map(t=>({
    id:t.id,subject:t.subject,activity_label:t.activity_label,category:t.category,
    owner_label:t.owner_label,due_date:t.due_date,status:t.status,notes:t.notes,updated_at:t.updated_at
  }));
}
function snapshotMarkup(report) {
  if(report.status!=='submitted')return '';
  const tasks=Array.isArray(report.tasks_snapshot)?report.tasks_snapshot:[];
  const open=tasks.filter(t=>!issueIsClosed(t.status));
  return '<div class="mw-snapshot"><strong>תמונת מצב להנהלה – במועד ההגשה</strong>'+
    '<p class="mw-muted">תמונת מצב היסטורית של הבעיות בעת ההגשה; עדכונים מאוחרים אינם משנים אותה.</p>'+
    '<p>בעיות בדיווח: '+tasks.length+' · פתוחות: '+open.length+' · סגורות: '+(tasks.length-open.length)+'</p>'+
    (open.length?'<ul>'+open.slice(0,30).map(t=>'<li>'+esc(t.subject)+
      (t.owner_label?' · אחראי: '+esc(t.owner_label):'')+
      (t.due_date?' · יעד: '+esc(t.due_date):'')+'</li>').join('')+'</ul>':'')+
    (open.length>30?'<p class="mw-muted">מוצגות 30 הבעיות הפתוחות הראשונות.</p>':'')+'</div>';
}

function bind(ctx) {
  const root = ctx.host;
  root.querySelector('[data-mw-prev]')?.addEventListener('click', () => changeWeek(ctx, shiftWeek(ctx.week, -1)));
  root.querySelector('[data-mw-next]')?.addEventListener('click', () => changeWeek(ctx, shiftWeek(ctx.week, 1)));
  root.querySelectorAll('[data-mw-week]').forEach(b=>b.addEventListener('click',()=>{void changeWeek(ctx,b.dataset.mwWeek);}));
  root.querySelector('[data-mw-collapse]')?.addEventListener('click',()=>{void changeWeek(ctx,timelineCurrentWeek(ctx));});
  root.querySelector('[data-mw-today]')?.addEventListener('click',()=>{void changeWeek(ctx,timelineCurrentWeek(ctx));});
  root.querySelector('[data-mw-save]')?.addEventListener('click',()=>{void saveWeekly(ctx,false);});
  root.querySelector('[data-mw-submit]')?.addEventListener('click',()=>{void saveWeekly(ctx,true);});
  root.querySelector('[data-mw-toggle]')?.addEventListener('click',()=>{void toggleEntry(ctx);});
  root.querySelector('[data-mw-check]')?.addEventListener('click', () => verifySubmitted(ctx));
  root.querySelectorAll('[data-mw-report-fields] input, [data-mw-report-fields] textarea, [data-mw-report-fields] select').forEach(input=>{
    const changed=()=>{
      if(!ctx.canEdit || currentReport(ctx).status==='submitted')return;
      ctx.dirty=true;ctx.changeSeq++;
      const badge=ctx.host.querySelector('[data-mw-saving-state]');
      if(badge)badge.textContent='שומר שינויים…';
      scheduleAutoSave(ctx);
    };
    input.addEventListener('input',changed);
    input.addEventListener('change',changed);
  });
}
function cancelAutoSave(ctx) {
  if(ctx.autoSaveTimer)clearTimeout(ctx.autoSaveTimer);
  ctx.autoSaveTimer=null;
}
function updateWeeklySummary(ctx) {
  const node=ctx.host.querySelector('[data-mw-weekly-table]');
  if(!node)return;
  node.innerHTML=tableMarkup(ctx);
  node.querySelectorAll('[data-mw-week]').forEach(button=>button.addEventListener('click',()=>{void changeWeek(ctx,button.dataset.mwWeek);}));
  node.querySelector('[data-mw-collapse]')?.addEventListener('click',()=>{void changeWeek(ctx,timelineCurrentWeek(ctx));});
}
function scheduleAutoSave(ctx) {
  cancelAutoSave(ctx);
  if(!ctx.entryExpanded || !ctx.dirty || !ctx.canEdit)return;
  ctx.autoSaveTimer=setTimeout(()=>{
    ctx.autoSaveTimer=null;
    void saveWeekly(ctx,false,{silent:true});
  },1100);
}
async function toggleEntry(ctx) {
  if(!isCurrent(ctx))return false;
  if(!ctx.entryExpanded){ctx.entryExpanded=true;render(ctx);return true;}
  cancelAutoSave(ctx);
  if(ctx.saveInFlight) {
    const prior=await ctx.saveInFlight;
    if(!prior)return false;
  }
  if(ctx.canEdit && ctx.dirty && currentReport(ctx).status!=='submitted') {
    const saved=await saveWeekly(ctx,false,{silent:true});
    if(!saved)return false;
  }
  if(!isCurrent(ctx))return false;
  ctx.entryExpanded=false;render(ctx);
  setNotice(ctx,'הנתונים נשמרו. אפשר לפתוח שוב את הטופס בכל עת.');
  return true;
}
async function changeWeek(ctx,week) {
  if(!isCurrent(ctx) || ctx.loading || !inReportPeriod(week))return false;
  cancelAutoSave(ctx);
  if(ctx.saveInFlight) {
    const prior=await ctx.saveInFlight;
    if(!prior)return false;
  }
  if(ctx.entryExpanded && ctx.canEdit && ctx.dirty && currentReport(ctx).status!=='submitted') {
    const saved=await saveWeekly(ctx,false,{silent:true});
    if(!saved)return false;
  }
  if(!isCurrent(ctx))return false;
  ctx.dirty=false;ctx.editingReport=null;ctx.notice=null;ctx.entryExpanded=false;ctx.week=week;
  const fixed=visibleWeeks(ctx);
  ctx.expandedWeek=fixed.includes(week)?null:week;
  render(ctx);return true;
}

function render(ctx) {
  if (!isCurrent(ctx)) return;
  const roleLabel = ctx.canEdit ? 'הזנה עצמאית למנהל הפעילות' : 'צפייה בדיווחי מנהל הפעילות';
  ctx.host.innerHTML = '<div class="' + TRACKER_CLASS + '">' +
    '<div class="mw-header"><div><h2>מעקב שבועי – פתיחות ומוכנות</h2><p class="mw-muted">' + esc(ctx.managerName) + ' · שנת פעילות ' + esc(ctx.year) + '</p></div><span class="mw-tag">' + esc(roleLabel) + '</span></div>' +
    '<div class="mw-toolbar"><div class="mw-left"><button class="mw-btn" type="button" data-mw-prev '+
    (ctx.week===REPORT_START?'disabled':'')+'>‹ שבוע קודם</button><strong>' + labelWeek(ctx.week) +
    '</strong><button class="mw-btn" type="button" data-mw-next '+(ctx.week===REPORT_LAST_WEEK?'disabled':'')+
    '>שבוע הבא ›</button><button class="mw-btn" type="button" data-mw-today>חזרה לשבוע הנוכחי</button></div></div>' +
    '<div class="mw-section-head"><h3>1. מדדים שבועיים</h3></div><div data-mw-weekly-table>' + tableMarkup(ctx) + '</div>' + formMarkup(ctx) +
    '<div class="mw-section-head"><h3>2. בעיות ומעקב</h3></div><section class="mw-section" data-mw-tasks-root></section><div data-mw-notice></div></div>';
  bind(ctx);
  refreshTaskSection(ctx);
  if (currentReport(ctx).status === 'submitted') {
    const check = ctx.host.querySelector('[data-mw-verification]');
    if (check) check.innerHTML = '<button type="button" class="mw-btn" data-mw-check>בדיקת התאמה לנתוני המקור (לאחר הגשה)</button>';
    ctx.host.querySelector('[data-mw-check]')?.addEventListener('click', () => verifySubmitted(ctx));
  }
  if (ctx.notice) setNotice(ctx, ctx.notice.message, ctx.notice.error);
}
async function getDirectory() {
  const { data, error } = await supabase.rpc('manager_weekly_manager_directory');
  if (error) throw new Error(error.message || 'שגיאה בטעינת רשימת המנהלים');
  return Array.isArray(data) ? data : [];
}
async function load(ctx) {
  try {
    await waitForSupabaseAuthSession({ timeoutMs: 7000 });
    const directory = await getDirectory();
    if (!isCurrent(ctx)) return;
    const requestedName = val(ctx.managerName).replace(/[״"'׳']/g, '');
    const own = val(state?.user?.user_id);
    const found = directory.find((p) => val(p.manager_name).replace(/[״"'׳']/g, '') === requestedName) ||
      (state?.user?.role === 'activities_manager' ? directory.find((p) => val(p.manager_user_id) === own) : null);
    if (!found) throw new Error('לא נמצא שיוך מורשה למנהל שנבחר. יש לבדוק את שיוך המשתמש.');
    ctx.managerId = found.manager_user_id;
    ctx.managerName = found.manager_name;
    ctx.canEdit = state?.user?.role === 'activities_manager' && val(state?.user?.user_id) === val(found.manager_user_id);
    const [r, t] = await Promise.all([
      supabase.from('manager_weekly_reports').select('*').eq('manager_user_id', ctx.managerId).eq('school_year', ctx.year).order('week_start'),
      supabase.from('manager_ongoing_tasks').select('*').eq('manager_user_id',ctx.managerId).eq('school_year',ctx.year).order('updated_at',{ascending:false}).limit(500)
    ]);
    if (!isCurrent(ctx)) return;
    if (r.error || t.error) throw new Error(r.error?.message || t.error?.message);
    ctx.reports = (r.data || []).map(row=>({...row,status:row.status==='draft'?'current':row.status}));
    ctx.savedReports = JSON.parse(JSON.stringify(ctx.reports));
    ctx.tasks = t.data || [];
    ctx.loading = false;
    render(ctx);
  } catch (error) {
    if (!isCurrent(ctx)) return;
    ctx.host.innerHTML = '<div class="mw-tracker"><div class="mw-error">טעינת המעקב נכשלה: ' + esc(error.message) + '</div><button class="mw-btn" type="button" data-mw-retry>ניסיון חוזר</button></div>';
    ctx.host.querySelector('[data-mw-retry]')?.addEventListener('click', () => load(ctx));
  }
}
/** Every saved value is a final manager-reviewed figure; weekly submission is separate. */
async function saveWeekly(ctx,submit=false,{silent=false}={}) {
  if(!isCurrent(ctx) || !ctx.canEdit || !ctx.entryExpanded)return false;
  cancelAutoSave(ctx);
  // Serialize writes: never let an earlier autosave overwrite a later edit.
  if(ctx.saveInFlight) {
    const prior=await ctx.saveInFlight;
    if(!prior || !isCurrent(ctx))return false;
  }
  if(currentReport(ctx).status==='submitted')return false;
  const report=readForm(ctx);
  if(submit) {
    const invalid=validateWeeklyReport(report);
    if(invalid){setNotice(ctx,invalid,true);return false;}
  }
  for(const [key] of MANUAL_METRICS) {
    if(report.metrics[key]!=null && !validMetric(report.metrics[key])) {
      setNotice(ctx,'יש להזין מספרים שלמים שאינם שליליים.',true);
      return false;
    }
  }
  const generation=ctx.changeSeq;
  const promise=(async()=>{
    ctx.busy=true;
    ctx.host.querySelectorAll('[data-mw-save],[data-mw-submit]').forEach(button=>{button.disabled=true;});
    try {
      const payload={
        manager_user_id:ctx.managerId,school_year:ctx.year,week_start:ctx.week,
        metrics:report.metrics,openings:report.openings,
        highlights:report.highlights,next_steps:report.next_steps,blockers:report.blockers,
        instructor_notes:report.instructor_notes,kit_notes:report.kit_notes,
        status:submit?'submitted':'current',
        submitted_at:submit?new Date().toISOString():null,
        tasks_snapshot:submit?frozenTaskSnapshot(ctx):[]
      };
      const {data,error}=await supabase.from('manager_weekly_reports')
        .upsert(payload,{onConflict:'manager_user_id,school_year,week_start'}).select('*').single();
      if(error)throw error;
      if(!isCurrent(ctx))return false;
      const i=ctx.reports.findIndex(r=>r.week_start===ctx.week);
      if(i<0)ctx.reports.push(data);
      else ctx.reports[i]=data;
      if(ctx.changeSeq===generation){ctx.dirty=false;ctx.editingReport=null;}
      ctx.savedReports=JSON.parse(JSON.stringify(ctx.reports));
      if(submit) {
        ctx.entryExpanded=false;
        render(ctx);
        setNotice(ctx,'הדיווח השבועי הוגש ונשמר כתמונת מצב נעולה להנהלה.');
      } else {
        updateWeeklySummary(ctx);
        const badge=ctx.host.querySelector('[data-mw-saving-state]');
        if(badge && !ctx.dirty)badge.textContent='נתונים שמורים';
        if(!silent)setNotice(ctx,'הנתונים נשמרו בהצלחה.');
      }
      return true;
    } catch(error) {
      if(isCurrent(ctx))setNotice(ctx,'השמירה נכשלה: '+(error?.message||error)+'. האזור יישאר פתוח לשמירה חוזרת.',true);
      return false;
    } finally {
      ctx.busy=false;
      ctx.host.querySelectorAll('[data-mw-save],[data-mw-submit]').forEach(button=>{button.disabled=false;});
    }
  })();
  ctx.saveInFlight=promise;
  try {return await promise;}
  finally {
    if(ctx.saveInFlight===promise)ctx.saveInFlight=null;
    if(ctx.dirty && !submit && isCurrent(ctx) && ctx.entryExpanded)scheduleAutoSave(ctx);
  }
}


async function verifySubmitted(ctx) {
  if (!isCurrent(ctx) || currentReport(ctx).status !== 'submitted') return;
  const node = ctx.host.querySelector('[data-mw-verification]');
  if (!node) return;
  node.innerHTML = '<div class="mw-verify">בודק נתוני מקור…</div>';
  const period = ctx.year === '2027' ? 'school_2027' : 'school_2026';
  const { data, error } = await supabase.from('activities')
    .select('row_id,activity_manager,school,school_id,date_1,emp_id,status')
    .in('activity_season', activitySeasonQueryValues(period))
    .eq('activity_manager', ctx.managerName);
  if (!isCurrent(ctx) || !ctx.host.contains(node)) return;
  if (error) { node.innerHTML = '<div class="mw-error">בדיקת המקור לא זמינה: ' + esc(error.message) + '</div>'; return; }
  const rows = (data || []).filter((a) => !CLOSED.has(val(a.status).toLowerCase()));
  const unique = [...new Map(rows.map((a) => [a.row_id, a])).values()];
  const schoolKeys = new Set(unique.map((a) => a.school_id ? 'id:' + a.school_id : (val(a.school) ? 'name:' + val(a.school) : '')).filter(Boolean));
  const counts = {
    activities: unique.length,
    schools: schoolKeys.size,
    unassigned: unique.filter((a) => !a.emp_id).length,
    planned: unique.filter((a) => a.date_1 && weekStartIso(a.date_1) === ctx.week).length
  };
  const entry = currentReport(ctx);
  const details = Object.entries(counts).map(([key, n]) => {
    const label = MANUAL_METRICS.find((m) => m[0] === key)?.[1] || key;
    const entered = entry.metrics?.[key];
    return '<li>' + esc(label) + ': דיווח ' + esc(entered ?? 'חסר') + ' | מערכת ' + n + (Number(entered) === n ? ' ✓' : ' — לבדיקה') + '</li>';
  });
  node.innerHTML = '<div class="mw-verify"><strong>השוואה לנתוני הפעילויות אחרי הגשה</strong><p class="mw-muted">השוואת מקור נוכחי בלבד; אינה מתקנת את דיווח המנהל ולא מאמתת ביצוע מפגש ראשון.</p><ul>' + details.join('') + '</ul></div>';
}

/** Called only when the manager Gantt tab is active, never during initial board render. */
export function mountManagerWeeklyManual(host, context) {
  ensureStyle();
  const key = contextKey(context);
  if (active && active.host === host && active.key === key) return;
  const ctx = {
    ...context, key, host, week: clampReportWeek(initialWeek(context.ym)), reports: [],
    managerId: '', canEdit: false, loading: true, busy: false, taskBusy:false, dirty: false, notice: null, tasks: [],
    entryExpanded:false,autoSaveTimer:null,saveInFlight:null,changeSeq:0,editingReport:null,expandedWeek:null
  };
  active = ctx;
  host.innerHTML = '<div class="mw-tracker"><div class="mw-empty">טוען סביבת מעקב שבועי…</div></div>';
  void load(ctx);
}

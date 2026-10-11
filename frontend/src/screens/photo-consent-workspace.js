import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import { photoConsentDocumentsBySchool, photoConsentSchoolKey } from './shared/photo-consent-school.js';

const PAGE_SIZE = 25;
const ACCEPTED = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const MAX_BYTES = 6 * 1024 * 1024;
const SP_FOLDER_URL = 'https://think365orgil.sharepoint.com/sites/taasiyeda2027/Shared%20Documents/Forms/view.aspx?id=%2Fsites%2Ftaasiyeda2027%2FShared%20Documents%2F%D7%A0%D7%99%D7%94%D7%95%D7%9C%2F%D7%90%D7%99%D7%A9%D7%95%D7%A8%20%D7%A6%D7%99%D7%9C%D7%95%D7%9D%2F%D7%90%D7%99%D7%A9%D7%95%D7%A8%D7%99%20%D7%A6%D7%99%D7%9C%D7%95%D7%9D%20%D7%97%D7%AA%D7%95%D7%9E%D7%99%D7%9D';
const clean = (value) => String(value ?? '').trim();
const safe = (value) => escapeHtml(clean(value));
const yearSeason = (state) => (state?.activityPeriodTab === 'regular' ? ['regular', 'summer_2026'] : ['school_2027']);
const dateHe = (value) => {
  const d = new Date(clean(value).slice(0, 10) + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('he-IL');
};
const css = '<style id="photo-consent-style">' +
  '.pc-workspace{--pc-teal:#087b91;--pc-border:#e5edf1;--pc-ink:#263545;--pc-soft:#f6fafb;max-width:1380px;padding:12px 8px 26px;margin:0 auto;direction:rtl;color:var(--ds-text,var(--pc-ink));font:inherit}' +
  '.pc-workspace *{box-sizing:border-box}.pc-workspace button,.pc-workspace input,.pc-workspace select{font:inherit}.pc-title{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 14px}' +
  '.pc-title h2{font-size:21px;font-weight:750;line-height:1.3;margin:0}.pc-muted{font-size:12px;color:#718295;margin:0;line-height:1.5}.pc-title-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}' +
  '.pc-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 16px}' +
  '.pc-kpi{min-width:0;display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--ds-card-bg,#fff);border:1px solid var(--pc-border);border-radius:13px;padding:13px 15px;box-shadow:0 2px 9px #12304705}' +
  '.pc-kpi span{font-size:12px;font-weight:550;color:#607486;line-height:1.5}.pc-kpi strong{font-size:25px;font-weight:750;color:var(--pc-ink);font-variant-numeric:tabular-nums;white-space:nowrap}.pc-kpi--positive strong{color:#088678}.pc-kpi--missing strong{color:#9d6b2c}' +
  '.pc-surface{border:1px solid var(--pc-border);border-radius:14px;background:var(--ds-card-bg,#fff);padding:13px;box-shadow:0 2px 10px #12304705}' +
  '.pc-action{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:33px;border:1px solid #d6e3e8;border-radius:9px;background:#fff;color:#176e80;cursor:pointer;padding:6px 11px;text-decoration:none;font-size:12px;font-weight:650;white-space:nowrap;transition:background .15s,border-color .15s}' +
  '.pc-action:hover{background:#eff9fa;border-color:#8fbfcb}.pc-action:focus-visible,.pc-school-button:focus-visible,.pc-filter-toggle:focus-visible{outline:2px solid #158a9e;outline-offset:2px}.pc-action:disabled{opacity:.55;cursor:not-allowed}.pc-action--primary{background:var(--pc-teal);border-color:var(--pc-teal);color:#fff}.pc-action--primary:hover{background:#08687b;color:#fff}.pc-action--danger{color:#a43945}.pc-actions{display:flex;justify-content:center;align-items:center;gap:5px;flex-wrap:wrap}' +
  '.pc-filter-shell{border:1px solid #e7eef2;background:#fbfdfe;border-radius:10px;margin-bottom:12px;overflow:hidden}.pc-filter-toggle{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;padding:10px 12px;background:transparent;border:0;color:#354e5c;cursor:pointer;text-align:right;font-size:13px;font-weight:700}' +
  '.pc-filter-title{display:flex;align-items:center;gap:9px}.pc-filter-icon{width:17px;height:17px;display:inline-grid;place-items:center;color:var(--pc-teal)}.pc-filter-arrow{font-size:12px;color:#638090;transition:transform .15s}.pc-filter-toggle[aria-expanded="true"] .pc-filter-arrow{transform:rotate(180deg)}' +
  '.pc-filter-body{border-top:1px solid var(--pc-border);padding:12px}.pc-filter-body[hidden]{display:none}.pc-toolbar{display:grid;grid-template-columns:minmax(240px,2fr) repeat(2,minmax(135px,1fr)) auto;align-items:end;gap:9px}' +
  '.pc-toolbar label{display:grid;gap:5px;min-width:0;font-size:12px;color:#536a78;font-weight:600}.pc-workspace input[type="search"],.pc-workspace select{height:36px;width:100%;min-width:0;border:1px solid #d6e3e8;border-radius:9px;background:var(--ds-card-bg,#fff);padding:6px 10px;color:var(--pc-ink);font-size:12px}' +
  '.pc-filter-count{font-size:11px;color:#087b91;background:#e9f7fa;border-radius:999px;padding:3px 9px;font-weight:650}.pc-results-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0 11px;flex-wrap:wrap}' +
  '.pc-results-header strong{font-size:13px;font-weight:700}.pc-results-header .pc-muted{font-size:12px}.pc-table-wrap{overflow-x:auto;width:100%}.pc-table{border-collapse:collapse;width:100%;min-width:780px;font-size:12px;table-layout:auto;text-align:right}' +
  '.pc-table thead th{background:#f3f8fa;color:#526a79;font-weight:700;font-size:12px;text-align:center;padding:10px 8px;border-bottom:1px solid #dce8ed;white-space:nowrap}.pc-table td{padding:10px 8px;border-bottom:1px solid #eef2f4;vertical-align:middle}.pc-table tr:last-child>td{border-bottom:0}.pc-table tbody tr.pc-activity-row:hover{background:#fbfdfe}.pc-center{text-align:center}' +
  '.pc-table td.pc-school-cell{min-width:140px;max-width:265px}.pc-school-label{font-size:12px;font-weight:700;color:var(--pc-ink);line-height:1.5}.pc-school-button{color:#087b91;background:transparent;border:0;padding:1px 0;font-size:12px;font-weight:750;cursor:pointer;text-align:right;text-decoration:underline;text-underline-offset:3px;line-height:1.6;overflow-wrap:anywhere}.pc-school-button:hover{color:#075568}' +
  '.pc-status{font-size:12px;color:#8593a0;white-space:nowrap}.pc-status--yes{color:#117b72;font-weight:700}.pc-expanded-cell{padding:9px 15px 13px!important;background:#fbfdfe}' +
  '.pc-file-list{display:grid;gap:0;border:1px solid #e3ebef;border-radius:10px;background:#fff;overflow:hidden}.pc-file-list-title{font-size:12px;font-weight:750;padding:11px 13px;background:#f1f8fa;color:#365b69}' +
  '.pc-file-row{display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap;padding:11px 13px;border-top:1px solid #eef2f4}.pc-file-name{min-width:0;flex:1;overflow-wrap:anywhere;font-size:12px}.pc-file-name strong{display:block;color:#334155;margin-bottom:3px}.pc-file-row .pc-actions{justify-content:flex-start}' +
  '.pc-mobile-list{display:none}.pc-pages{display:flex;gap:10px;align-items:center;justify-content:center;margin-top:12px}.pc-empty{padding:28px 12px;text-align:center;color:#6b8292;font-size:13px}' +
  '.pc-notice{font-size:12px;margin:0 0 12px;padding:10px 12px;border-radius:9px;background:#eff8fc;border:1px solid #cae6f0}.pc-notice--error{background:#fff2f2;border-color:#f0c8c8;color:#9b1c1c}' +
  '.pc-preview-backdrop{position:fixed;inset:0;background:#0a1520ac;z-index:99999;display:grid;place-items:center;padding:16px}.pc-preview{background:white;border-radius:14px;width:min(94vw,950px);height:min(92dvh,950px);padding:12px;display:flex;flex-direction:column;gap:10px;color:#273746}' +
  '.pc-preview header{display:flex;justify-content:space-between;align-items:center;gap:10px;min-width:0}.pc-preview header strong{min-width:0;overflow-wrap:anywhere}.pc-preview iframe,.pc-preview img{flex:1;min-height:0;width:100%;object-fit:contain;border:0}' +
  '@media(max-width:970px){.pc-kpi{padding:11px}.pc-kpi strong{font-size:22px}.pc-toolbar{grid-template-columns:minmax(180px,2fr) repeat(2,minmax(115px,1fr)) auto}}' +
  '@media(max-width:820px){.pc-workspace{padding:10px 2px 24px}.pc-title{margin-bottom:13px}.pc-title h2{font-size:19px}.pc-summary{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:12px}.pc-kpi{border-radius:11px;padding:10px 12px;gap:8px}.pc-kpi strong{font-size:22px}.pc-kpi span{font-size:11px}.pc-surface{padding:10px;border-radius:12px}.pc-toolbar{grid-template-columns:1fr 1fr}.pc-toolbar label:first-child{grid-column:1/-1}.pc-toolbar [data-pc-clear]{grid-column:1/-1;justify-self:start}.pc-table-wrap{display:none}.pc-mobile-list{display:grid;gap:9px}.pc-mobile-card{border:1px solid #e3ecef;border-radius:12px;padding:12px;background:var(--ds-card-bg,#fff)}.pc-mobile-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.pc-mobile-title{font-size:13px;font-weight:720;color:var(--pc-ink);line-height:1.45;margin:6px 0 10px}.pc-mobile-meta{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:11px}.pc-mobile-meta-item{min-width:0}.pc-mobile-meta-item small{display:block;color:#7b8d99;font-size:11px;margin-bottom:3px}.pc-mobile-meta-item span{display:block;font-size:12px;color:#3a5360;overflow-wrap:anywhere}.pc-mobile-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding-top:10px;border-top:1px solid #eef2f4}.pc-mobile-footer .pc-actions{justify-content:flex-start}.pc-mobile-documents{margin-top:10px}.pc-file-row{padding:10px;align-items:stretch}.pc-file-row .pc-actions{justify-content:flex-start}.pc-results-header{margin-top:3px}.pc-preview-backdrop{padding:6px}.pc-preview{width:100%;height:96dvh;border-radius:12px}}' +
  '@media(max-width:390px){.pc-title-actions{width:100%}.pc-title-actions .pc-action{flex:1}.pc-kpi{align-items:flex-start;flex-direction:column;gap:1px}.pc-kpi strong{font-size:23px}.pc-toolbar{grid-template-columns:1fr}.pc-toolbar label:first-child{grid-column:auto}}' +
  '</style>';

async function allActivities(seasons) {
  const records = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('activities')
      .select('id,row_id,authority,school,activity_name,instructor_name,start_date,activity_season,status')
      .in('activity_season', seasons)
      .not('start_date', 'is', null)
      .order('start_date', { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    records.push(...(data || []));
    if ((data || []).length < 500) break;
  }
  return records.filter((row) => !['נמחק', 'deleted'].includes(clean(row.status).toLowerCase()));
}

async function allFiles() {
  const records = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('activity_photo_consent_files')
      .select('id,activity_id,file_name,mime_type,size_bytes,uploaded_by,uploaded_at,sp_web_url')
      .order('uploaded_at', { ascending: false })
      .range(offset, offset + 499);
    if (error) throw error;
    records.push(...(data || []));
    if ((data || []).length < 500) break;
  }
  return records;
}

function asMap(files) {
  const map = new Map();
  files.forEach((f) => {
    const id = Number(f.activity_id);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(f);
  });
  return map;
}
async function invoke(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('photo-consent-sharepoint', { body: { action, ...payload } });
  if (error || data?.error) throw new Error(data?.message || error?.message || 'פעולה מול SharePoint נכשלה.');
  return data;
}
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('לא ניתן לקרוא את הקובץ.'));
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}
function blobFromBase64(content, mime) {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function mountPhotoConsentWorkspace(root, state = {}) {
  if (!root || root.dataset.pcMounted === '1') return;
  root.dataset.pcMounted = '1';
  if (![true, 'true', 'yes', '1', 1].includes(state?.user?.permissions?.manage_photo_consents)) {
    root.innerHTML = '<div class="pc-empty">אין הרשאה לצפות באישורי צילום.</div>';
    return;
  }
  const context = { activities: [], files: [], search: '', status: 'all', authority: 'all', filtersOpen: false, page: 0, busy: false, notice: '', error: false, openId: 0, selectedActivity: 0, replaceId: '', previewUrl: '' };
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'; input.multiple = true; input.hidden = true;
  document.body.appendChild(input);
  const lookup = () => new Map(context.activities.map((a) => [Number(a.id), a]));
  const report = (message, error = false) => { context.notice = message; context.error = error; render(); };
  const byActivity = () => asMap(context.files);
  function filtered() {
    const map = byActivity(), needle = context.search.toLowerCase();
    return context.activities.filter((a) => {
      const count = (map.get(Number(a.id)) || []).length;
      return (context.status === 'all' || (context.status === 'present' ? count > 0 : count === 0))
        && (context.authority === 'all' || clean(a.authority) === context.authority)
        && (!needle || [a.school, a.authority, a.activity_name, a.row_id, a.instructor_name].some((v) => clean(v).toLowerCase().includes(needle)));
    });
  }
  function fileRows(documents, school) {
    return '<div class="pc-file-list" aria-label="אישורי צילום לבית הספר">' +
      '<div class="pc-file-list-title">אישורי צילום · ' + safe(school) + ' (' + documents.length + ')</div>' +
      documents.map((f) =>
        '<div class="pc-file-row"><div class="pc-file-name"><strong>' + safe(f.file_name) + '</strong>' +
        '<div class="pc-muted">' + safe(f.ownerActivity?.activity_name || 'פעילות') +
        ' · ' + safe(dateHe(f.ownerActivity?.start_date)) +
        (f.uploaded_by ? ' · הועלה על ידי ' + safe(f.uploaded_by) : '') +
        '</div></div>' +
        '<div class="pc-actions">' +
        '<button type="button" class="pc-action" data-pc-view="' + safe(f.id) + '">צפייה</button>' +
        '<button type="button" class="pc-action" data-pc-download="' + safe(f.id) + '">הורדה</button>' +
        '<button type="button" class="pc-action" data-pc-replace="' + safe(f.id) + '" data-activity="' + Number(f.activity_id) + '">החלפה</button>' +
        '<button type="button" class="pc-action pc-action--danger" data-pc-delete="' + safe(f.id) + '">מחיקה</button>' +
        '</div></div>'
      ).join('') + '</div>';
  }

  function schoolControl(activity, documents, open) {
    const school = safe(activity.school || 'לא משויך');
    if (!documents.length) return '<span class="pc-school-label">' + school + '</span>';
    return '<button type="button" class="pc-school-button" data-pc-toggle="' + Number(activity.id) +
      '" aria-label="הצגת ' + documents.length + ' אישורי צילום של ' + school +
      '" aria-expanded="' + (open ? 'true' : 'false') + '" title="לחצו לצפייה באישורי בית הספר">' +
      school + ' <span aria-hidden="true">↗</span></button>';
  }

  function render() {
    const schoolDocs = photoConsentDocumentsBySchool(context.activities, context.files);
    const documentsFor = (activity) => schoolDocs.get(photoConsentSchoolKey(activity)) || [];
    const total = context.activities.length;
    const uploaded = context.activities.filter((a) => documentsFor(a).length > 0).length;
    const visibleIds = new Set(context.activities.map((a) => Number(a.id)));
    const documentCount = context.files.filter((f) => visibleIds.has(Number(f.activity_id))).length;
    const found = filtered();
    const pageCount = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
    context.page = Math.min(context.page, pageCount - 1);
    const visible = found.slice(context.page * PAGE_SIZE, (context.page + 1) * PAGE_SIZE);
    const authorities = Array.from(new Set(context.activities.map((a) => clean(a.authority)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'he'));
    const activeFilterCount = Number(Boolean(context.search.trim())) +
      Number(context.status !== 'all') + Number(context.authority !== 'all');
    const notice = context.notice
      ? '<p role="status" class="pc-notice' + (context.error ? ' pc-notice--error' : '') + '">' + safe(context.notice) + '</p>'
      : '';
    const rows = visible.map((a) => {
      const documents = documentsFor(a);
      const opened = context.openId === Number(a.id) && documents.length > 0;
      const control = schoolControl(a, documents, opened);
      const docsStatus = documents.length
        ? '<span class="pc-status pc-status--yes">' + documents.length + ' ' + (documents.length === 1 ? 'קובץ' : 'קבצים') + '</span>'
        : '<span class="pc-status">טרם הועלה</span>';
      const buttons = '<div class="pc-actions">' +
        '<button type="button" class="pc-action pc-action--primary" data-pc-upload="' + Number(a.id) + '"' +
        (context.busy ? ' disabled' : '') + '>העלאה</button>' +
        (documents.length ? '<button type="button" class="pc-action" data-pc-toggle="' + Number(a.id) +
          '" aria-expanded="' + (opened ? 'true' : 'false') + '">' + (opened ? 'סגירה' : 'אישורים') + '</button>' : '') +
        '</div>';
      return {
        desktop: '<tr class="pc-activity-row"><td class="pc-school-cell">' + control + '</td>' +
          '<td>' + safe(a.authority || '—') + '</td><td>' + safe(a.activity_name || '—') + '</td>' +
          '<td class="pc-center">' + safe(dateHe(a.start_date)) + '</td>' +
          '<td>' + safe(a.instructor_name || '—') + '</td>' +
          '<td class="pc-center">' + docsStatus + '</td><td>' + buttons + '</td></tr>' +
          (opened ? '<tr class="pc-expanded-row"><td class="pc-expanded-cell" colspan="7">' +
            fileRows(documents, a.school) + '</td></tr>' : ''),
        mobile: '<article class="pc-mobile-card">' +
          '<div class="pc-mobile-top"><div>' +
          '<div class="pc-muted">בית ספר</div>' + control + '</div>' + docsStatus + '</div>' +
          '<div class="pc-mobile-title">' + safe(a.activity_name || 'פעילות') + '</div>' +
          '<div class="pc-mobile-meta">' +
          '<div class="pc-mobile-meta-item"><small>רשות</small><span>' + safe(a.authority || '—') + '</span></div>' +
          '<div class="pc-mobile-meta-item"><small>תאריך התחלה</small><span>' + safe(dateHe(a.start_date)) + '</span></div>' +
          '<div class="pc-mobile-meta-item"><small>מדריך</small><span>' + safe(a.instructor_name || '—') + '</span></div>' +
          '</div><div class="pc-mobile-footer">' + buttons + '</div>' +
          (opened ? '<div class="pc-mobile-documents">' + fileRows(documents, a.school) + '</div>' : '') +
          '</article>'
      };
    });
    root.innerHTML = css +
      '<section class="pc-workspace" dir="rtl">' +
      '<header class="pc-title"><h2>אישורי צילום</h2>' +
      '<div class="pc-title-actions">' +
      '<button class="pc-action" type="button" data-pc-refresh ' + (context.busy ? 'disabled' : '') + '>↻ רענון</button>' +
      '<a class="pc-action" href="' + SP_FOLDER_URL + '" target="_blank" rel="noopener noreferrer">תיקיית SharePoint ↗</a>' +
      '</div></header>' +
      '<div class="pc-summary">' +
      [['פעילויות עם תאריך התחלה', total, ''], ['פעילויות עם אישורים', uploaded, 'pc-kpi--positive'],
        ['פעילויות ללא אישור', total - uploaded, 'pc-kpi--missing'], ['קבצים שהועלו', documentCount, '']].map((k) =>
        '<div class="pc-kpi ' + k[2] + '"><span>' + safe(k[0]) + '</span><strong>' + Number(k[1]) + '</strong></div>'
      ).join('') + '</div>' +
      '<section class="pc-surface" aria-label="רשימת אישורי צילום">' + notice +
      '<div class="pc-filter-shell">' +
      '<button type="button" class="pc-filter-toggle" data-pc-filter-toggle aria-expanded="' +
      (context.filtersOpen ? 'true' : 'false') + '" aria-controls="pc-filter-fields">' +
      '<span class="pc-filter-title"><span class="pc-filter-icon" aria-hidden="true">☷</span> סינון וחיפוש' +
      (activeFilterCount ? '<span class="pc-filter-count">' + activeFilterCount + ' פעילים</span>' : '') +
      '</span><span class="pc-filter-arrow" aria-hidden="true">⌄</span></button>' +
      '<div class="pc-filter-body" id="pc-filter-fields"' + (context.filtersOpen ? '' : ' hidden') + '>' +
      '<div class="pc-toolbar">' +
      '<label>חיפוש פעילות<input data-pc-search type="search" placeholder="בית ספר, רשות, תוכנית או מדריך" value="' + safe(context.search) + '"></label>' +
      '<label>רשות<select data-pc-authority><option value="all">כל הרשויות</option>' +
      authorities.map((a) => '<option value="' + safe(a) + '"' + (context.authority === a ? ' selected' : '') + '>' + safe(a) + '</option>').join('') +
      '</select></label>' +
      '<label>אישורים<select data-pc-status><option value="all">כל הפעילויות</option>' +
      '<option value="present"' + (context.status === 'present' ? ' selected' : '') + '>עם אישור</option>' +
      '<option value="missing"' + (context.status === 'missing' ? ' selected' : '') + '>ללא אישור</option></select></label>' +
      '<button type="button" class="pc-action" data-pc-clear' + (activeFilterCount ? '' : ' disabled') + '>ניקוי סינון</button>' +
      '</div></div></div>' +
      '<div class="pc-results-header"><strong>רשימת פעילויות</strong><span class="pc-muted">מציג ' +
      found.length + ' מתוך ' + total + ' פעילויות</span></div>' +
      '<div class="pc-table-wrap"><table class="pc-table">' +
      '<thead><tr><th>בית ספר</th><th>רשות</th><th>תוכנית / פעילות</th><th>תאריך התחלה</th><th>מדריך</th><th>אישורים</th><th>פעולות</th></tr></thead>' +
      '<tbody>' + (rows.length ? rows.map((row) => row.desktop).join('') :
        '<tr><td colspan="7" class="pc-empty">אין פעילויות המתאימות לסינון</td></tr>') + '</tbody></table></div>' +
      '<div class="pc-mobile-list">' + (rows.length ? rows.map((row) => row.mobile).join('') :
        '<div class="pc-empty">אין פעילויות המתאימות לסינון</div>') + '</div>' +
      '<nav class="pc-pages" aria-label="דפדוף בפעילויות">' +
      '<button type="button" class="pc-action" data-pc-prev ' + (context.page === 0 ? 'disabled' : '') + '>הקודם</button>' +
      '<span class="pc-muted">עמוד ' + (context.page + 1) + ' מתוך ' + pageCount + '</span>' +
      '<button type="button" class="pc-action" data-pc-next ' + (context.page >= pageCount - 1 ? 'disabled' : '') + '>הבא</button>' +
      '</nav></section></section>';
  }
  async function refresh() {
    context.busy = true; report('טוען פעילויות ומסמכים…');
    try {
      const [activities, files] = await Promise.all([allActivities(yearSeason(state)), allFiles()]);
      context.activities = activities;
      context.files = files;
      context.notice = '';
      context.error = false;
    } catch (error) {
      context.notice = error?.message || 'לא ניתן לטעון את הנתונים.';
      context.error = true;
    } finally { context.busy = false; render(); }
  }
  async function uploadFiles(files) {
    if (!files.length) return;
    const activity = lookup().get(context.selectedActivity);
    if (!activity) return report('הפעילות שנבחרה אינה זמינה.', true);
    const oldId = context.replaceId;
    const selection = oldId ? files.slice(0, 1) : files;
    let succeeded = 0;
    context.busy = true;
    context.notice = '';
    context.error = false;
    render();
    for (const file of selection) {
      try {
        if (!ACCEPTED.has(file.type) || !file.size || file.size > MAX_BYTES) throw new Error('אפשר להעלות PDF, JPG או PNG עד 6MB לקובץ.');
        const base64 = await readAsBase64(file);
        await invoke('upload', { activity_id: Number(activity.id), file_name: file.name, base64 });
        succeeded++;
      } catch (error) {
        context.notice = 'העלאה נכשלה עבור ' + file.name + ': ' + (error.message || 'שגיאה לא צפויה');
        context.error = true;
        break;
      }
    }
    if (oldId && succeeded === 1) {
      try { await invoke('delete', { file_id: oldId }); }
      catch (error) {
        context.notice = 'המסמך החדש נשמר, אך מחיקת הקודם נכשלה: ' + error.message;
        context.error = true;
      }
    }
    context.busy = false;
    const message = context.notice;
    const isError = context.error;
    await refresh();
    context.openId = Number(activity.id);
    report(message || (succeeded + ' קבצים נשמרו ב־SharePoint.'), isError);
  }
  function closePreview() {
    document.querySelector('[data-pc-preview-overlay]')?.remove();
    if (context.previewUrl) URL.revokeObjectURL(context.previewUrl);
    context.previewUrl = '';
  }
  async function openDocument(fileId, download = false) {
    try {
      const info = await invoke('download', { file_id: fileId });
      const blob = blobFromBase64(info.base64, info.mime_type);
      const url = URL.createObjectURL(blob);
      if (download) {
        const a = document.createElement('a');
        a.href = url; a.download = info.file_name || 'אישור צילום'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        return;
      }
      closePreview();
      context.previewUrl = url;
      const overlay = document.createElement('div');
      overlay.className = 'pc-preview-backdrop';
      overlay.dataset.pcPreviewOverlay = '1';
      overlay.innerHTML = '<div class="pc-preview" dir="rtl" role="dialog" aria-modal="true">' +
        '<header><strong>' + safe(info.file_name) + '</strong><button type="button" class="pc-action" data-pc-preview-close>סגירה</button></header>' +
        (info.mime_type === 'application/pdf'
          ? '<iframe title="תצוגה מקדימה של אישור צילום" src="' + url + '"></iframe>'
          : '<img alt="תצוגה מקדימה של אישור צילום" src="' + url + '">') + '</div>';
      overlay.addEventListener('click', (ev) => { if (ev.target === overlay || ev.target.closest('[data-pc-preview-close]')) closePreview(); });
      document.body.appendChild(overlay);
    } catch (error) { report(error?.message || 'טעינת המסמך נכשלה.', true); }
  }
  root.addEventListener('input', (ev) => {
    if (ev.target.matches('[data-pc-search]')) {
      context.search = ev.target.value;
      context.page = 0;
      // Preserve focus/caret while filtering.
      const caret = ev.target.selectionStart;
      render();
      const field = root.querySelector('[data-pc-search]');
      field?.focus();
      field?.setSelectionRange(caret, caret);
    }
  });
  root.addEventListener('change', (ev) => {
    if (ev.target.matches('[data-pc-status]')) { context.status = ev.target.value; context.page = 0; render(); }
    if (ev.target.matches('[data-pc-authority]')) { context.authority = ev.target.value; context.page = 0; render(); }
  });
  root.addEventListener('click', async (ev) => {
    const button = ev.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-pc-filter-toggle')) {
      context.filtersOpen = !context.filtersOpen;
      render();
      root.querySelector('[data-pc-filter-toggle]')?.focus();
      return;
    }
    if (button.hasAttribute('data-pc-clear')) {
      context.search = '';
      context.status = 'all';
      context.authority = 'all';
      context.page = 0;
      context.openId = 0;
      render();
      return;
    }
    if (context.busy) return;
    if (button.hasAttribute('data-pc-refresh')) return refresh();
    if (button.hasAttribute('data-pc-prev')) { context.page = Math.max(0, context.page - 1); return render(); }
    if (button.hasAttribute('data-pc-next')) { context.page += 1; return render(); }
    if (button.hasAttribute('data-pc-toggle')) { const id = Number(button.dataset.pcToggle); context.openId = context.openId === id ? 0 : id; return render(); }
    if (button.hasAttribute('data-pc-upload') || button.hasAttribute('data-pc-replace')) {
      context.selectedActivity = Number(button.dataset.pcUpload || button.dataset.activity);
      context.replaceId = button.dataset.pcReplace || '';
      input.multiple = !context.replaceId; input.value = ''; input.click(); return;
    }
    if (button.hasAttribute('data-pc-view')) return openDocument(button.dataset.pcView, false);
    if (button.hasAttribute('data-pc-download')) return openDocument(button.dataset.pcDownload, true);
    if (button.hasAttribute('data-pc-delete')) {
      if (!window.confirm('למחוק את אישור הצילום גם מ־SharePoint?')) return;
      context.busy = true; render();
      try { await invoke('delete', { file_id: button.dataset.pcDelete }); await refresh(); report('הקובץ נמחק מ־SharePoint ומהמערכת.'); }
      catch (error) { report(error?.message || 'מחיקת הקובץ נכשלה.', true); }
      finally { context.busy = false; render(); }
    }
  });
  input.addEventListener('change', () => uploadFiles(Array.from(input.files || [])));
  const observer = new MutationObserver(() => {
    if (!root.isConnected) { observer.disconnect(); input.remove(); closePreview(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  render();
  refresh();
}

import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import { photoConsentSchoolManagementGroups } from './shared/photo-consent-school.js';
import { photoConsentInvoke, uploadPhotoConsentFiles } from './shared/photo-consent-client.js';

const PAGE_SIZE = 25;
const SP_FOLDER_URL = 'https://think365orgil.sharepoint.com/sites/taasiyeda2027/Shared%20Documents/Forms/view.aspx?id=%2Fsites%2Ftaasiyeda2027%2FShared%20Documents%2F%D7%A0%D7%99%D7%94%D7%95%D7%9C%2F%D7%90%D7%99%D7%A9%D7%95%D7%A8%20%D7%A6%D7%99%D7%9C%D7%95%D7%9D%2F%D7%90%D7%99%D7%A9%D7%95%D7%A8%D7%99%20%D7%A6%D7%99%D7%9C%D7%95%D7%9D%20%D7%97%D7%AA%D7%95%D7%9E%D7%99%D7%9D';
const clean = (value) => String(value ?? '').trim();
const safe = (value) => escapeHtml(clean(value));
const yearSeason = (state) => (state?.activityPeriodTab === 'regular' ? ['regular', 'summer_2026'] : ['school_2027']);
const dateHe = (value) => {
  if (!value) return '—';
  const d = new Date(clean(value).slice(0, 10) + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('he-IL');
};
const css = '<style id="photo-consent-style">' +
  '.pc-workspace{--pc-teal:#087b91;--pc-border:#e5edf1;--pc-ink:#263545;max-width:1380px;padding:12px 8px 28px;margin:0 auto;direction:rtl;color:var(--ds-text,var(--pc-ink));font:inherit}' +
  '.pc-workspace *{box-sizing:border-box}.pc-workspace button,.pc-workspace input,.pc-workspace select{font:inherit}' +
  '.pc-title{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:13px}.pc-title h2{font-size:21px;font-weight:750;margin:0}.pc-title-actions,.pc-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.pc-actions{justify-content:flex-start}' +
  '.pc-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:15px}.pc-kpi{background:var(--ds-card-bg,#fff);border:1px solid var(--pc-border);border-radius:12px;padding:12px 14px;display:flex;justify-content:space-between;gap:10px;align-items:center}.pc-kpi span{font-size:12px;color:#617585}.pc-kpi strong{font-size:23px;color:#116e7e;font-variant-numeric:tabular-nums}' +
  '.pc-surface{border:1px solid var(--pc-border);border-radius:14px;background:var(--ds-card-bg,#fff);padding:13px;box-shadow:0 2px 10px #12304706}.pc-muted{font-size:12px;color:#738593;margin:0;line-height:1.5}' +
  '.pc-action{display:inline-flex;justify-content:center;align-items:center;min-height:34px;gap:5px;background:var(--ds-card-bg,#fff);border:1px solid #d5e4e9;border-radius:9px;padding:6px 11px;font-size:12px;font-weight:650;color:#176e80;text-decoration:none;cursor:pointer;white-space:nowrap}.pc-action:hover{background:#edf8fa}.pc-action:disabled{opacity:.5;cursor:not-allowed}.pc-action--danger{color:#ac3740}' +
  '.pc-school-button{border:0;background:transparent;color:#087b91;font-size:13px;font-weight:750;text-decoration:underline;text-underline-offset:3px;cursor:pointer;text-align:right;overflow-wrap:anywhere;padding:0}.pc-school-button:hover{color:#065b70}.pc-school-button:focus-visible,.pc-action:focus-visible,.pc-filter-toggle:focus-visible{outline:2px solid #0c8196;outline-offset:2px}' +
  '.pc-filter-shell{border:1px solid #e5edf1;background:#fbfdfe;border-radius:10px;margin:0 0 12px;overflow:hidden}.pc-filter-toggle{width:100%;padding:11px 12px;text-align:right;display:flex;justify-content:space-between;align-items:center;gap:10px;border:0;background:transparent;font-size:13px;font-weight:700;cursor:pointer;color:#3c5565}.pc-filter-body{padding:11px;border-top:1px solid var(--pc-border)}.pc-filter-body[hidden]{display:none}.pc-filter-count{font-size:11px;border-radius:999px;background:#e9f7fa;color:#087b91;padding:3px 9px;margin-inline-start:7px}.pc-toolbar{display:grid;grid-template-columns:minmax(220px,2fr) minmax(150px,1fr) auto;gap:10px;align-items:end}.pc-toolbar label{font-size:12px;font-weight:650;color:#607486;display:grid;gap:5px}.pc-workspace input[type=search],.pc-workspace select{width:100%;min-width:0;height:37px;padding:6px 10px;border-radius:9px;border:1px solid #d4e1e8;background:#fff;color:#273746;font-size:12px}' +
  '.pc-results-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin:7px 0 12px}.pc-results-header strong{font-size:13px;color:#374e61}.pc-table-wrap{overflow-x:auto}.pc-table{width:100%;border-collapse:collapse;min-width:860px;font-size:12px;text-align:right}.pc-table th{background:#f2f8fa;color:#50697b;font-weight:700;padding:11px 9px;text-align:right;border-bottom:1px solid #d9e6eb}.pc-table th.pc-date-th,.pc-table td.pc-date{text-align:center}.pc-table td{padding:12px 9px;vertical-align:middle;border-bottom:1px solid #edf1f4}.pc-table tbody tr:hover{background:#fbfdfe}.pc-table .pc-expanded-row td{padding:9px 11px;background:#fbfdfe}.pc-table td:first-child{font-weight:700}' +
  '.pc-operational-name{max-width:195px;overflow-wrap:anywhere;line-height:1.5}.pc-multi-date{display:block;color:#728594;font-size:10px;margin-top:3px;line-height:1.4}.pc-file-list{display:grid;gap:0;background:#fff;border:1px solid #e3ebef;border-radius:11px;overflow:hidden}.pc-file-list-title{background:#f0f7f9;color:#365a6c;font-weight:750;font-size:12px;padding:10px 13px}.pc-file-row{padding:11px 13px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid #edf2f4}.pc-file-name{flex:1;min-width:0;overflow-wrap:anywhere}.pc-file-name strong{font-size:12px;color:#344a5b;display:block;margin-bottom:3px}.pc-file-row .pc-actions{justify-content:flex-start}' +
  '.pc-mobile-meta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 12px;margin:10px 0}.pc-mobile-meta-grid>div{min-width:0}.pc-mobile-meta-grid small{display:block;font-size:11px;color:#718495;margin-bottom:2px}.pc-mobile-meta-grid span{font-size:12px;color:#435968;overflow-wrap:anywhere}.pc-mobile-list{display:none}.pc-mobile-card{border:1px solid #e3ebef;background:var(--ds-card-bg,#fff);border-radius:12px;padding:12px}.pc-mobile-top{display:flex;justify-content:space-between;align-items:flex-start;gap:9px}.pc-mobile-meta{font-size:12px;color:#597385;margin:9px 0;line-height:1.6}.pc-mobile-documents{margin-top:11px}.pc-pages{display:flex;justify-content:center;align-items:center;gap:10px;margin-top:13px}.pc-empty{padding:25px 12px;text-align:center;font-size:13px;color:#687e8c}.pc-notice{padding:10px 12px;border-radius:9px;border:1px solid #c7e6ed;background:#eff9fc;font-size:12px;margin-bottom:12px}.pc-notice--error{color:#992c37;border-color:#edc8cb;background:#fff3f4}' +
  '.pc-preview-backdrop{position:fixed;inset:0;z-index:99999;background:#091b26b0;display:grid;place-items:center;padding:14px}.pc-preview{background:#fff;color:#344554;border-radius:13px;width:min(95vw,960px);height:min(93dvh,950px);padding:12px;display:flex;flex-direction:column;gap:10px}.pc-preview header{display:flex;align-items:center;justify-content:space-between;gap:10px}.pc-preview header strong{overflow-wrap:anywhere;min-width:0}.pc-preview img,.pc-preview iframe{flex:1;width:100%;min-height:0;object-fit:contain;border:0}' +
  '@media(max-width:820px){.pc-workspace{padding:10px 3px 25px}.pc-title h2{font-size:19px}.pc-summary{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.pc-kpi{padding:10px 12px;gap:8px}.pc-kpi strong{font-size:21px}.pc-surface{padding:10px}.pc-toolbar{grid-template-columns:1fr 1fr}.pc-toolbar label:first-child{grid-column:1/-1}.pc-toolbar button{justify-self:start}.pc-table-wrap{display:none}.pc-mobile-list{display:grid;gap:9px}.pc-file-row{padding:10px;align-items:stretch}.pc-file-row .pc-actions{justify-content:flex-start}.pc-preview-backdrop{padding:6px}.pc-preview{height:96dvh;width:100%}}' +
  '@media(max-width:390px){.pc-summary{grid-template-columns:1fr 1fr}.pc-kpi{flex-direction:column;align-items:flex-start}.pc-toolbar{grid-template-columns:1fr}.pc-toolbar label:first-child{grid-column:auto}.pc-title-actions{width:100%}.pc-title-actions .pc-action{flex:1}}' +
  '</style>';

async function allActivities(seasons) {
  const records = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('activities')
      .select('id,row_id,authority,school,activity_name,activity_manager,instructor_name,start_date,activity_season,status')
      .in('activity_season', seasons)
      .not('start_date', 'is', null)
      .order('start_date', { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    records.push(...(data || []));
    if ((data || []).length < 500) break;
  }
  return records.filter((a) => !['נמחק', 'deleted'].includes(clean(a.status).toLowerCase()));
}

async function allFiles() {
  const records = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('activity_photo_consent_files')
      .select('id,activity_id,file_name,mime_type,size_bytes,uploaded_by,uploaded_at')
      .order('uploaded_at', { ascending: false })
      .range(offset, offset + 499);
    if (error) throw error;
    records.push(...(data || []));
    if ((data || []).length < 500) break;
  }
  return records;
}

function blobFromBase64(base64, mime) {
  const content = atob(base64);
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) bytes[i] = content.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function mountPhotoConsentWorkspace(root, state = {}) {
  if (!root || root.dataset.pcMounted === '1') return;
  root.dataset.pcMounted = '1';
  if (![true, 'true', 'yes', '1', 1].includes(state?.user?.permissions?.manage_photo_consents)) {
    root.innerHTML = '<div class="pc-empty">אין הרשאה לצפות באישורי צילום.</div>';
    return;
  }

  const context = {
    activities: [], files: [], search: '', authority: 'all', filtersOpen: false,
    openSchool: '', page: 0, busy: false, notice: '', error: false, previewUrl: '', replaceId: '', replaceActivityId: 0
  };
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
  input.hidden = true;
  document.body.appendChild(input);

  const schoolGroups = () => photoConsentSchoolManagementGroups(context.activities, context.files);
  const filtered = (groups) => {
    const needle = context.search.trim().toLocaleLowerCase('he');
    return groups.filter((group) =>
      (context.authority === 'all' || group.authority === context.authority) &&
      (!needle || [group.school, group.authority,
        ...group.documents.flatMap((f) => [f.file_name, f.ownerActivity?.activity_name, f.ownerActivity?.activity_manager, f.ownerActivity?.instructor_name])]
        .some((s) => clean(s).toLocaleLowerCase('he').includes(needle))));
  };

  const notice = (message, error = false) => {
    context.notice = message;
    context.error = error;
    render();
  };

  function fileRows(group) {
    return '<div class="pc-file-list">' +
      '<div class="pc-file-list-title">אישורי צילום · ' + safe(group.school) + '</div>' +
      group.documents.map((file) =>
        '<div class="pc-file-row"><div class="pc-file-name"><strong>' + safe(file.file_name) + '</strong>' +
        '<div class="pc-muted">' + safe(file.ownerActivity?.activity_name || 'פעילות') +
        ' · תחילת קורס: ' + safe(dateHe(file.ownerActivity?.start_date)) +
        ' · מנהל פעילות: ' + safe(file.ownerActivity?.activity_manager || '—') +
        ' · מדריך: ' + safe(file.ownerActivity?.instructor_name || '—') +
        (file.uploaded_by ? ' · ' + safe(file.uploaded_by) : '') + '</div></div>' +
        '<div class="pc-actions">' +
        '<button class="pc-action" type="button" data-pc-view="' + safe(file.id) + '">צפייה</button>' +
        '<button class="pc-action" type="button" data-pc-download="' + safe(file.id) + '">הורדה</button>' +
        '<button class="pc-action" type="button" data-pc-replace="' + safe(file.id) +
          '" data-activity="' + Number(file.activity_id) + '">החלפה</button>' +
        '<button class="pc-action pc-action--danger" type="button" data-pc-delete="' + safe(file.id) + '">מחיקה</button>' +
        '</div></div>'
      ).join('') + '</div>';
  }

  function operationalNames(names) {
    return names.length ? safe(names.join(' · ')) : '—';
  }

  function operationalStartDate(group) {
    const { startDates, firstStartDate } = group.operational;
    return '<span>' + safe(dateHe(firstStartDate)) + '</span>' +
      (startDates.length > 1 ? '<small class="pc-multi-date">+' +
        (startDates.length - 1) + ' תאריכי התחלה נוספים</small>' : '');
  }

  function schoolButton(group, expanded) {
    return '<button type="button" class="pc-school-button" data-pc-toggle="' +
      safe(encodeURIComponent(group.key)) + '" aria-expanded="' + (expanded ? 'true' : 'false') +
      '" aria-label="פתיחת אישורי צילום של ' + safe(group.school) + '">' + safe(group.school) + '</button>';
  }

  function render() {
    const groups = schoolGroups(); // A school is shown only when at least one document exists.
    const found = filtered(groups);
    const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
    context.page = Math.min(context.page, pages - 1);
    const visible = found.slice(context.page * PAGE_SIZE, (context.page + 1) * PAGE_SIZE);
    const authorities = [...new Set(groups.map((group) => group.authority).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'he'));
    const activeFilters = Number(Boolean(context.search.trim())) + Number(context.authority !== 'all');

    const rows = visible.map((group) => {
      const expanded = context.openSchool === group.key;
      const button = schoolButton(group, expanded);
      const action = '<button type="button" class="pc-action" data-pc-toggle="' +
        safe(encodeURIComponent(group.key)) + '" aria-expanded="' + (expanded ? 'true' : 'false') + '">' +
        (expanded ? 'סגירה' : 'הצגת אישורים') + '</button>';
      return {
        desktop: '<tr><td>' + button + '</td><td>' + safe(group.authority) + '</td>' +
          '<td class="pc-operational-name">' + operationalNames(group.operational.managers) + '</td>' +
          '<td class="pc-operational-name">' + operationalNames(group.operational.instructors) + '</td>' +
          '<td class="pc-date">' + operationalStartDate(group) + '</td>' +
          '<td>' + group.documents.length + ' <span class="pc-muted">(' + group.activityCount + ' פעילויות)</span></td>' +
          '<td>' + action + '</td></tr>' +
          (expanded ? '<tr class="pc-expanded-row"><td colspan="7">' + fileRows(group) + '</td></tr>' : ''),
        mobile: '<article class="pc-mobile-card"><div class="pc-mobile-top"><div>' + button +
          '<div class="pc-muted">' + safe(group.authority) + '</div></div>' +
          '<strong>' + group.documents.length + ' אישורים</strong></div>' +
          '<div class="pc-mobile-meta-grid">' +
          '<div><small>מנהל פעילות</small><span>' + operationalNames(group.operational.managers) + '</span></div>' +
          '<div><small>מדריך</small><span>' + operationalNames(group.operational.instructors) + '</span></div>' +
          '<div><small>תחילת קורס</small><span>' + operationalStartDate(group) + '</span></div>' +
          '<div><small>פעילויות משויכות</small><span>' + group.activityCount + '</span></div>' +
          '</div>' + action +
          (expanded ? '<div class="pc-mobile-documents">' + fileRows(group) + '</div>' : '') +
          '</article>'
      };
    });

    const fileCount = groups.reduce((sum, group) => sum + group.documents.length, 0);
    const linkedCount = new Set(groups.flatMap((group) => group.documents.map((file) => Number(file.activity_id)))).size;
    const note = context.notice ? '<p role="status" class="pc-notice' +
      (context.error ? ' pc-notice--error' : '') + '">' + safe(context.notice) + '</p>' : '';
    const emptyMessage = groups.length ? 'אין בתי ספר התואמים לחיפוש' :
      'עדיין לא הועלו אישורי צילום. להעלאה, פותחים פעילות ולוחצים על אייקון המצלמה במגירה.';
    root.innerHTML = css +
      '<section class="pc-workspace" dir="rtl">' +
      '<header class="pc-title"><h2>אישורי צילום</h2><div class="pc-title-actions">' +
      '<button type="button" class="pc-action" data-pc-refresh' + (context.busy ? ' disabled' : '') + '>↻ רענון</button>' +
      '<a class="pc-action" href="' + SP_FOLDER_URL + '" target="_blank" rel="noopener noreferrer">תיקיית SharePoint ↗</a>' +
      '</div></header>' +
      '<div class="pc-summary">' +
      [['בתי ספר עם אישורים', groups.length], ['מסמכים שמורים', fileCount], ['פעילויות משויכות', linkedCount]].map(([title, value]) =>
        '<div class="pc-kpi"><span>' + safe(title) + '</span><strong>' + value + '</strong></div>').join('') +
      '</div>' +
      '<section class="pc-surface" aria-label="בתי ספר עם אישורי צילום">' + note +
      '<div class="pc-filter-shell"><button type="button" class="pc-filter-toggle" data-pc-filter-toggle aria-expanded="' +
      (context.filtersOpen ? 'true' : 'false') + '" aria-controls="pc-filter-fields">' +
      '<span>סינון וחיפוש' + (activeFilters ? '<span class="pc-filter-count">' + activeFilters + ' פעילים</span>' : '') +
      '</span><span aria-hidden="true">⌄</span></button>' +
      '<div class="pc-filter-body" id="pc-filter-fields"' + (context.filtersOpen ? '' : ' hidden') + '>' +
      '<div class="pc-toolbar"><label>חיפוש בתי ספר ואישורים' +
      '<input type="search" data-pc-search value="' + safe(context.search) + '" placeholder="בית ספר, פעילות או קובץ"></label>' +
      '<label>רשות<select data-pc-authority><option value="all">כל הרשויות</option>' +
      authorities.map((a) => '<option value="' + safe(a) + '"' +
        (context.authority === a ? ' selected' : '') + '>' + safe(a) + '</option>').join('') +
      '</select></label><button type="button" class="pc-action" data-pc-clear' +
      (activeFilters ? '' : ' disabled') + '>ניקוי סינון</button></div></div></div>' +
      '<div class="pc-results-header"><strong>בתי ספר עם אישורי צילום</strong>' +
      '<span class="pc-muted">מציג ' + found.length + ' מתוך ' + groups.length + ' בתי ספר</span></div>' +
      '<div class="pc-table-wrap"><table class="pc-table"><thead><tr>' +
      '<th>בית ספר</th><th>רשות</th><th>מנהל פעילות</th><th>מדריך</th><th class="pc-date-th">תחילת קורס</th><th>אישורים</th><th>פעולות</th>' +
      '</tr></thead><tbody>' +
      (rows.length ? rows.map((r) => r.desktop).join('') : '<tr><td colspan="7" class="pc-empty">' + safe(emptyMessage) + '</td></tr>') +
      '</tbody></table></div>' +
      '<div class="pc-mobile-list">' +
      (rows.length ? rows.map((r) => r.mobile).join('') : '<div class="pc-empty">' + safe(emptyMessage) + '</div>') +
      '</div>' +
      '<nav class="pc-pages" aria-label="דפדוף בבתי ספר">' +
      '<button type="button" class="pc-action" data-pc-prev' + (!context.page ? ' disabled' : '') + '>הקודם</button>' +
      '<span class="pc-muted">עמוד ' + (context.page + 1) + ' מתוך ' + pages + '</span>' +
      '<button type="button" class="pc-action" data-pc-next' + (context.page >= pages - 1 ? ' disabled' : '') + '>הבא</button>' +
      '</nav></section></section>';
  }

  async function refresh() {
    context.busy = true;
    notice('טוען בתי ספר עם אישורי צילום…');
    try {
      const [activities, files] = await Promise.all([allActivities(yearSeason(state)), allFiles()]);
      context.activities = activities;
      context.files = files;
      context.notice = '';
      context.error = false;
    } catch (error) {
      context.notice = error?.message || 'טעינת האישורים נכשלה.';
      context.error = true;
    } finally {
      context.busy = false;
      render();
    }
  }

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file || !context.replaceId || !context.replaceActivityId) return;
    const oldId = context.replaceId;
    const activityId = context.replaceActivityId;
    context.busy = true;
    render();
    try {
      const saved = await uploadPhotoConsentFiles(activityId, [file]);
      if (!saved.length) throw new Error('המסמך החדש לא נשמר.');
      try {
        await photoConsentInvoke('delete', { file_id: oldId });
        await refresh();
        notice('המסמך הוחלף ונשמר ב־SharePoint.');
      } catch (error) {
        await refresh();
        notice('המסמך החדש נשמר, אבל מחיקת הישן נכשלה: ' + error.message, true);
      }
    } catch (error) {
      notice(error.message || 'החלפת המסמך נכשלה.', true);
    } finally {
      context.busy = false;
      context.replaceId = '';
      context.replaceActivityId = 0;
      input.value = '';
      render();
    }
  });

  function closePreview() {
    document.querySelector('[data-pc-preview-overlay]')?.remove();
    if (context.previewUrl) URL.revokeObjectURL(context.previewUrl);
    context.previewUrl = '';
  }

  async function openDocument(fileId, download = false) {
    try {
      const info = await photoConsentInvoke('download', { file_id: fileId });
      const url = URL.createObjectURL(blobFromBase64(info.base64, info.mime_type));
      if (download) {
        const a = document.createElement('a');
        a.href = url;
        a.download = info.file_name || 'אישור צילום';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        return;
      }
      closePreview();
      context.previewUrl = url;
      const backdrop = document.createElement('div');
      backdrop.className = 'pc-preview-backdrop';
      backdrop.dataset.pcPreviewOverlay = '1';
      backdrop.innerHTML = '<div class="pc-preview" dir="rtl" role="dialog" aria-modal="true">' +
        '<header><strong>' + safe(info.file_name) + '</strong>' +
        '<button type="button" class="pc-action" data-pc-preview-close>סגירה</button></header>' +
        (info.mime_type === 'application/pdf'
          ? '<iframe title="צפייה באישור צילום" src="' + url + '"></iframe>'
          : '<img alt="צפייה באישור צילום" src="' + url + '">') + '</div>';
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop || event.target.closest('[data-pc-preview-close]')) closePreview();
      });
      document.body.appendChild(backdrop);
    } catch (error) {
      notice(error.message || 'טעינת אישור הצילום נכשלה.', true);
    }
  }

  root.addEventListener('input', (event) => {
    if (!event.target.matches('[data-pc-search]')) return;
    context.search = event.target.value;
    context.page = 0;
    const caret = event.target.selectionStart;
    render();
    const field = root.querySelector('[data-pc-search]');
    field?.focus();
    field?.setSelectionRange(caret, caret);
  });
  root.addEventListener('change', (event) => {
    if (event.target.matches('[data-pc-authority]')) {
      context.authority = event.target.value;
      context.page = 0;
      render();
    }
  });
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    if (button.hasAttribute('data-pc-filter-toggle')) {
      context.filtersOpen = !context.filtersOpen;
      render();
      root.querySelector('[data-pc-filter-toggle]')?.focus();
      return;
    }
    if (button.hasAttribute('data-pc-clear')) {
      context.search = '';
      context.authority = 'all';
      context.page = 0;
      render();
      return;
    }
    if (context.busy) return;
    if (button.hasAttribute('data-pc-refresh')) return refresh();
    if (button.hasAttribute('data-pc-prev')) { context.page = Math.max(0, context.page - 1); return render(); }
    if (button.hasAttribute('data-pc-next')) { context.page += 1; return render(); }
    if (button.hasAttribute('data-pc-toggle')) {
      const key = decodeURIComponent(button.dataset.pcToggle || '');
      context.openSchool = context.openSchool === key ? '' : key;
      return render();
    }
    if (button.hasAttribute('data-pc-view')) return openDocument(button.dataset.pcView);
    if (button.hasAttribute('data-pc-download')) return openDocument(button.dataset.pcDownload, true);
    if (button.hasAttribute('data-pc-replace')) {
      context.replaceId = button.dataset.pcReplace || '';
      context.replaceActivityId = Number(button.dataset.activity || 0);
      input.value = '';
      input.click();
      return;
    }
    if (button.hasAttribute('data-pc-delete')) {
      if (!window.confirm('למחוק את אישור הצילום גם מ־SharePoint?')) return;
      context.busy = true;
      render();
      try {
        await photoConsentInvoke('delete', { file_id: button.dataset.pcDelete });
        await refresh();
        notice('המסמך נמחק מ־SharePoint ומהמערכת.');
      } catch (error) {
        notice(error.message || 'מחיקת המסמך נכשלה.', true);
      } finally {
        context.busy = false;
        render();
      }
    }
  });

  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      observer.disconnect();
      input.remove();
      closePreview();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  render();
  refresh();
}

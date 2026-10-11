import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';

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
  '.pc-workspace{padding:16px 12px 30px;direction:rtl;max-width:1350px;margin:0 auto;color:var(--ds-text,#1b2938)}' +
  '.pc-workspace *{box-sizing:border-box}.pc-title{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}' +
  '.pc-title h2{font-size:20px;margin:0 0 4px}.pc-title p,.pc-muted{font-size:12px;color:#64748b;margin:0}' +
  '.pc-link{color:#007da1;text-decoration:underline}.pc-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}' +
  '.pc-kpi,.pc-surface{background:var(--ds-card-bg,#fff);border:1px solid var(--ds-border,#dce5ed);border-radius:12px;box-shadow:0 1px 2px #0f172a08}' +
  '.pc-kpi{padding:13px}.pc-kpi span{display:block;font-size:12px;color:#64748b}.pc-kpi strong{font-size:25px;line-height:1.45;display:block}' +
  '.pc-surface{padding:13px}.pc-toolbar{display:flex;align-items:end;gap:10px;flex-wrap:wrap;margin-bottom:12px}' +
  '.pc-toolbar label{font-size:12px;color:#475569;display:grid;gap:4px;min-width:160px;flex:1}.pc-toolbar label:first-child{flex:2;min-width:230px}' +
  '.pc-workspace input[type=search],.pc-workspace select{height:35px;width:100%;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:5px 9px;color:#0f172a}' +
  '.pc-action{border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#086e8d;cursor:pointer;font:inherit;font-size:12px;font-weight:650;padding:6px 10px;min-height:32px}' +
  '.pc-action:hover{background:#ebf8fb}.pc-action:disabled{opacity:.5;cursor:not-allowed}.pc-action--primary{background:#008bab;color:white;border-color:#008bab}' +
  '.pc-action--primary:hover{background:#05758f}.pc-action--danger{color:#ad3131}.pc-actions{display:flex;gap:4px;justify-content:center;flex-wrap:wrap}' +
  '.pc-table-wrap{overflow:auto;max-width:100%}.pc-table{border-collapse:collapse;width:100%;min-width:850px;font-size:12px;text-align:right}' +
  '.pc-table th{background:#f0f6f9;font-weight:700;text-align:center;padding:10px 7px;border-bottom:1px solid #dce5ed;white-space:nowrap}' +
  '.pc-table td{padding:10px 7px;border-bottom:1px solid #ebeff4;vertical-align:middle}.pc-table td.pc-center{text-align:center}' +
  '.pc-table td:first-child{font-weight:650}.pc-file-list{display:grid;gap:7px;background:#f8fbfd;border:1px solid #dce5ed;border-radius:9px;padding:10px}' +
  '.pc-file-row{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;border-bottom:1px solid #e2e8f0;padding-bottom:6px}.pc-file-row:last-child{border:0}' +
  '.pc-file-name{font-size:12px;overflow-wrap:anywhere}.pc-status{font-size:12px;color:#334155}.pc-status--yes{color:#027a6c;font-weight:700}' +
  '.pc-pages{display:flex;gap:12px;align-items:center;justify-content:center;margin-top:12px}.pc-empty{padding:30px;text-align:center;color:#64748b}' +
  '.pc-notice{font-size:12px;margin:0 0 10px;padding:9px 12px;border-radius:8px;background:#eff8fc;border:1px solid #cae6f0}' +
  '.pc-notice--error{background:#fff2f2;border-color:#f0c8c8;color:#9b1c1c}' +
  '.pc-preview-backdrop{position:fixed;inset:0;background:#0a1520ac;z-index:99999;display:grid;place-items:center;padding:20px}' +
  '.pc-preview{background:white;border-radius:12px;width:min(94vw,950px);height:min(92vh,950px);padding:12px;display:flex;flex-direction:column;gap:10px}' +
  '.pc-preview header{display:flex;justify-content:space-between;align-items:center}.pc-preview iframe,.pc-preview img{flex:1;min-height:0;width:100%;object-fit:contain;border:0}' +
  '@media(max-width:750px){.pc-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.pc-workspace{padding:10px 4px}}' +
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
  if (clean(state?.user?.role || state?.user?.display_role) !== 'admin') {
    root.innerHTML = '<div class="pc-empty">הגישה לאישורי צילום מותרת למנהל מערכת בלבד.</div>';
    return;
  }
  const context = { activities: [], files: [], search: '', status: 'all', authority: 'all', page: 0, busy: false, notice: '', error: false, openId: 0, selectedActivity: 0, replaceId: '', previewUrl: '' };
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
  function fileRows(files) {
    return '<div class="pc-file-list">' + files.map((f) =>
      '<div class="pc-file-row"><div class="pc-file-name"><strong>' + safe(f.file_name) + '</strong>' +
      ' <span class="pc-muted">· ' + safe(f.uploaded_by) + ' · ' + safe(dateHe(f.uploaded_at)) + '</span></div>' +
      '<div class="pc-actions">' +
      '<button type="button" class="pc-action" data-pc-view="' + safe(f.id) + '">צפייה</button>' +
      '<button type="button" class="pc-action" data-pc-download="' + safe(f.id) + '">הורדה</button>' +
      '<button type="button" class="pc-action" data-pc-replace="' + safe(f.id) + '" data-activity="' + Number(f.activity_id) + '">החלפה</button>' +
      '<button type="button" class="pc-action pc-action--danger" data-pc-delete="' + safe(f.id) + '">מחיקה</button></div></div>'
    ).join('') + '</div>';
  }
  function render() {
    const map = byActivity(), total = context.activities.length;
    const uploaded = context.activities.filter((a) => (map.get(Number(a.id)) || []).length > 0).length;
    const found = filtered();
    const pageCount = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
    context.page = Math.min(context.page, pageCount - 1);
    const visible = found.slice(context.page * PAGE_SIZE, (context.page + 1) * PAGE_SIZE);
    const authorities = Array.from(new Set(context.activities.map((a) => clean(a.authority)).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'he'));
    const notice = context.notice ? '<p role="status" class="pc-notice' + (context.error ? ' pc-notice--error' : '') + '">' + safe(context.notice) + '</p>' : '';
    root.innerHTML = css +
      '<section class="pc-workspace" dir="rtl">' +
      '<div class="pc-title"><div><h2>אישורי צילום</h2><p>מסמכים חתומים לפי פעילות שיש לה תאריך התחלה · הימצאות קובץ אינה מעידה על אישור צילום לכל התלמידים</p></div>' +
      '<div class="pc-actions"><button class="pc-action" type="button" data-pc-refresh ' + (context.busy ? 'disabled' : '') + '>רענון</button>' +
      '<a class="pc-action pc-link" href="' + SP_FOLDER_URL + '" target="_blank" rel="noopener noreferrer">תיקיית SharePoint</a></div></div>' +
      '<div class="pc-summary">' +
      [['פעילויות עם תאריך התחלה',total],['פעילויות עם מסמכים',uploaded],['פעילויות ללא מסמך',total-uploaded],['מסמכים שהועלו',context.files.length]].map((k)=>
        '<div class="pc-kpi"><span>' + safe(k[0]) + '</span><strong>' + Number(k[1]) + '</strong></div>').join('') + '</div>' +
      '<div class="pc-surface">' + notice +
      '<div class="pc-toolbar"><label>חיפוש פעילות<input data-pc-search type="search" placeholder="בית ספר, רשות, תוכנית, מדריך או מזהה" value="' + safe(context.search) + '"></label>' +
      '<label>רשות<select data-pc-authority><option value="all">כל הרשויות</option>' +
      authorities.map((a) => '<option value="' + safe(a) + '"' + (context.authority === a ? ' selected' : '') + '>' + safe(a) + '</option>').join('') + '</select></label>' +
      '<label>מסמכים<select data-pc-status><option value="all">כל הפעילויות</option><option value="present"' + (context.status === 'present' ? ' selected' : '') + '>עם מסמכים</option><option value="missing"' + (context.status === 'missing' ? ' selected' : '') + '>ללא מסמכים</option></select></label></div>' +
      '<p class="pc-muted">מציג ' + found.length + ' פעילויות בהתאם לסינון</p>' +
      '<div class="pc-table-wrap"><table class="pc-table"><thead><tr><th>בית ספר</th><th>רשות</th><th>תוכנית / פעילות</th><th>תחילת פעילות</th><th>מדריך</th><th>מסמכים</th><th>פעולות</th></tr></thead><tbody>' +
      (visible.length ? visible.map((a) => {
        const files = map.get(Number(a.id)) || [];
        return '<tr><td>' + safe(a.school || 'לא משויך') + '<div class="pc-muted">' + safe(a.row_id) + '</div></td>' +
          '<td>' + safe(a.authority || '—') + '</td><td>' + safe(a.activity_name || '—') + '</td>' +
          '<td class="pc-center">' + safe(dateHe(a.start_date)) + '</td><td>' + safe(a.instructor_name || '—') + '</td>' +
          '<td class="pc-center"><span class="pc-status' + (files.length ? ' pc-status--yes' : '') + '">' + (files.length ? files.length + ' קבצים' : 'טרם הועלה') + '</span></td>' +
          '<td><div class="pc-actions"><button type="button" class="pc-action pc-action--primary" data-pc-upload="' + Number(a.id) + '"' + (context.busy ? ' disabled' : '') + '>העלאה</button>' +
          (files.length ? '<button type="button" class="pc-action" data-pc-toggle="' + Number(a.id) + '">' + (context.openId === Number(a.id) ? 'סגירה' : 'הצגת קבצים') + '</button>' : '') +
          '</div></td></tr>' +
          (context.openId === Number(a.id) && files.length ? '<tr><td colspan="7">' + fileRows(files) + '</td></tr>' : '');
      }).join('') : '<tr><td colspan="7" class="pc-empty">לא נמצאו פעילויות המתאימות לסינון</td></tr>') +
      '</tbody></table></div><div class="pc-pages">' +
      '<button type="button" class="pc-action" data-pc-prev ' + (context.page === 0 ? 'disabled' : '') + '>הקודם</button>' +
      '<span class="pc-muted">עמוד ' + (context.page + 1) + ' מתוך ' + pageCount + '</span>' +
      '<button type="button" class="pc-action" data-pc-next ' + (context.page >= pageCount - 1 ? 'disabled' : '') + '>הבא</button>' +
      '</div></div></section>';
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
    if (!button || context.busy) return;
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

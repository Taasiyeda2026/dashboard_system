import { api } from './api.js';
import { state } from './state.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { escapeHtml } from './screens/shared/html.js';
import { hebrewPermissionField, hebrewRole } from './screens/shared/ui-hebrew.js';
import { ADMIN_ONLY_CAPABILITIES, ALL_PERMISSION_KEYS, capabilityTree } from './capability-registry.js';

const VERSION = '20260823-v5';
const STYLE_ID = 'admin-permissions-management-v2-style';
const ROOT_ATTR = 'data-admin-permissions-management-v2';
const ADMIN_ROLE = 'admin';
const ROLE_OPTIONS = [
  'admin',
  'operation_manager',
  'authorized_user',
  'instructor',
  'finance',
  'activities_manager',
  'domain_manager',
  'business_development_manager',
  'instructor_manager'
];

const CORE_PERMISSION_KEYS = [...ALL_PERMISSION_KEYS, 'view_permissions', 'can_request_edit_2', 'can_review_requests_2', 'view_inventory', 'view_proposals', 'view_finance'];
const PERMISSION_PAGES = capabilityTree().filter((item) => item.permission);

const LEGACY_PERMISSION_ALIASES = Object.freeze({
  can_request_edit: ['can_request_edit_2'],
  can_review_requests: ['can_review_requests_2'],
  view_workshop_stock: ['view_inventory'],
  finance_access: ['view_finance']
});

const uiState = {
  status: 'active',
  role: 'all',
  q: '',
  data: null,
  mounted: null,
  loading: false
};

function isAdmin() {
  return String(state?.user?.role || state?.user?.display_role || '').trim() === ADMIN_ROLE;
}

function isPermissionsRoute() {
  const route = String(state?.route || document.querySelector('.app-shell')?.dataset?.currentRoute || '').trim();
  return route === 'permissions';
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [${ROOT_ATTR}]{direction:rtl;width:min(1180px,100%);margin-inline:auto;color:var(--color-text,#172033)}
    .apm-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:14px}
    .apm-head h1{margin:0 0 4px;font-size:25px;font-weight:850}.apm-head p{margin:0;color:var(--color-text-secondary,#64748b);font-size:12.5px}
    .apm-add{height:36px;padding:0 16px;border:1px solid var(--color-primary,#0ea5c6);border-radius:7px;background:var(--color-primary,#0ea5c6);color:#fff;font:inherit;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap}
    .apm-toolbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:11px 0 13px;border-top:1px solid var(--color-border,#dbe3ec);border-bottom:1px solid var(--color-border,#dbe3ec)}
    .apm-tabs{display:inline-flex;align-items:center;border:1px solid var(--color-border,#cbd5e1);border-radius:7px;overflow:hidden;background:var(--color-surface,#fff)}
    .apm-tab{appearance:none;border:0;border-inline-end:1px solid var(--color-border,#e2e8f0);background:transparent;color:var(--color-text-secondary,#64748b);height:34px;padding:0 13px;font:inherit;font-size:12.5px;font-weight:750;cursor:pointer}.apm-tab:last-child{border-inline-end:0}.apm-tab.is-active{background:color-mix(in srgb,var(--color-primary,#0ea5c6) 10%,#fff);color:var(--color-primary,#0b86a2)}
    .apm-search{width:min(300px,42vw);height:34px;border:1px solid var(--color-border,#cbd5e1);border-radius:7px;background:var(--color-surface,#fff);padding:0 10px;font:inherit;font-size:12.5px}.apm-role{height:34px;min-width:155px;border:1px solid var(--color-border,#cbd5e1);border-radius:7px;background:var(--color-surface,#fff);padding:0 9px;font:inherit;font-size:12.5px}
    .apm-meta{margin-inline-start:auto;color:var(--color-text-secondary,#64748b);font-size:12px;white-space:nowrap}
    .apm-table-wrap{margin-top:14px;border:1px solid var(--color-border,#dbe3ec);border-radius:8px;overflow:auto;background:var(--color-surface,#fff)}
    .apm-table{width:100%;border-collapse:collapse;font-size:12.5px}.apm-table th,.apm-table td{padding:8px 10px;border-bottom:1px solid var(--color-border,#e7edf3);vertical-align:middle}.apm-table tbody tr:last-child td{border-bottom:0}.apm-table th{background:var(--color-surface-muted,#f7fafc);color:var(--color-text-secondary,#526176);font-size:11.5px;font-weight:850;white-space:nowrap;text-align:right}.apm-table th.apm-center,.apm-table td.apm-center{text-align:center}.apm-table tbody tr{cursor:pointer}.apm-table tbody tr:hover{background:color-mix(in srgb,var(--color-primary,#0ea5c6) 4%,transparent)}
    .apm-name{font-weight:800;white-space:nowrap}.apm-secondary{display:block;margin-top:1px;color:var(--color-text-secondary,#64748b);font-size:11px}.apm-status{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:750}.apm-status::before{content:'';width:7px;height:7px;border-radius:50%;background:#16a34a}.apm-status.is-inactive::before{background:#94a3b8}.apm-perm-count{font-weight:750;color:var(--color-text-secondary,#475569);white-space:nowrap}
    .apm-row-actions{display:flex;justify-content:center;gap:5px}.apm-icon-btn{appearance:none;border:1px solid var(--color-border,#cbd5e1);border-radius:6px;background:#fff;color:var(--color-text,#172033);height:29px;padding:0 9px;font:inherit;font-size:11.5px;font-weight:750;cursor:pointer}.apm-icon-btn:hover{border-color:var(--color-primary,#0ea5c6);color:var(--color-primary,#0b86a2)}
    .apm-empty{padding:34px 14px;text-align:center;color:var(--color-text-secondary,#64748b);font-size:13px}
    .apm-backdrop{position:fixed;inset:0;z-index:10020;background:rgba(15,23,42,.25)}.apm-drawer{position:fixed;z-index:10021;inset-block:0;right:0;width:min(560px,94vw);background:var(--color-surface,#fff);border-left:1px solid var(--color-border,#dbe3ec);box-shadow:-12px 0 32px rgba(15,23,42,.12);display:flex;flex-direction:column;direction:rtl}
    .apm-drawer-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:17px 19px 13px;border-bottom:1px solid var(--color-border,#e5e7eb)}.apm-drawer-head h2{margin:0 0 4px;font-size:20px}.apm-drawer-head p{margin:0;color:var(--color-text-secondary,#64748b);font-size:11.5px}.apm-close{appearance:none;border:0;background:transparent;font-size:26px;line-height:1;color:var(--color-text-secondary,#64748b);cursor:pointer;padding:0}
    .apm-drawer-body{padding:14px 19px 20px;overflow:auto}.apm-section{padding:0 0 15px;margin:0 0 15px;border-bottom:1px solid var(--color-border,#e5e7eb)}.apm-section:last-child{border-bottom:0;margin-bottom:0}.apm-section h3{margin:0 0 10px;font-size:13px;font-weight:850;color:var(--color-text,#172033)}
    .apm-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}.apm-field{display:flex;flex-direction:column;gap:5px;min-width:0}.apm-field--wide{grid-column:1/-1}.apm-field label{font-size:11.5px;font-weight:750;color:var(--color-text-secondary,#64748b)}.apm-field input,.apm-field select{width:100%;height:34px;box-sizing:border-box;border:1px solid var(--color-border,#cbd5e1);border-radius:6px;background:#fff;padding:0 8px;font:inherit;font-size:12.5px;color:var(--color-text,#172033)}.apm-field input[readonly]{background:var(--color-surface-muted,#f8fafc);color:var(--color-text-secondary,#64748b)}
    .apm-checkline{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:750}.apm-checkline input{width:16px;height:16px}.apm-lock-note{margin-top:6px;color:#9a6700;font-size:11px}
    .apm-permission-group{margin-top:12px}.apm-permission-group:first-child{margin-top:0}.apm-permission-group h4{margin:0 0 7px;font-size:11.5px;color:var(--color-text-secondary,#64748b)}.apm-permission-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}.apm-permission-item{display:flex;align-items:center;gap:7px;min-height:28px;font-size:11.5px}.apm-permission-item input{width:15px;height:15px;flex:0 0 auto}.apm-role-default-note{margin:7px 0 0;color:var(--color-text-secondary,#64748b);font-size:10.5px}
    .apm-drawer-actions{display:flex;align-items:center;gap:8px;padding:12px 19px;border-top:1px solid var(--color-border,#e5e7eb);background:var(--color-surface,#fff)}.apm-save{height:34px;border:1px solid var(--color-primary,#0ea5c6);border-radius:6px;background:var(--color-primary,#0ea5c6);color:#fff;padding:0 16px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.apm-secondary-btn{height:34px;border:1px solid var(--color-border,#cbd5e1);border-radius:6px;background:#fff;color:var(--color-text,#172033);padding:0 12px;font:inherit;font-size:12px;font-weight:750;cursor:pointer}.apm-danger{margin-inline-start:auto;color:#b42318;border-color:#f1b5ae}.apm-status-text{font-size:11.5px;color:var(--color-text-secondary,#64748b)}
    @media(max-width:820px){.apm-table th:nth-child(4),.apm-table td:nth-child(4),.apm-table th:nth-child(5),.apm-table td:nth-child(5){display:none}.apm-grid,.apm-permission-grid{grid-template-columns:1fr}.apm-search{width:100%;flex:1 1 220px}.apm-meta{width:100%;margin-inline-start:0}.apm-head{align-items:center}}
  `;
  document.head.appendChild(style);
}

function roleCode(row = {}) {
  return String(row.role || row.display_role || '').trim();
}

function isActive(row = {}) {
  const raw = row.active ?? row.is_active;
  if (typeof raw === 'boolean') return raw;
  return !['no', 'false', '0', 'inactive'].includes(String(raw ?? 'yes').trim().toLowerCase());
}

function permissionValue(row, key) {
  const raw = row?.[key];
  if (typeof raw === 'boolean') return raw;
  return String(raw || '').trim().toLowerCase() === 'yes';
}

function effectivePermissionValue(row, key) {
  if (row && Object.prototype.hasOwnProperty.call(row, key)) return permissionValue(row, key);
  return (LEGACY_PERMISSION_ALIASES[key] || []).some((alias) => permissionValue(row, alias));
}

function profileValue(row, key) {
  const profile = row?._employee_profile || {};
  if (key === 'full_name') return String(profile.full_name || row.full_name || row.name || '').trim();
  if (key === 'email') return String(profile.email || row.email || '').trim();
  if (key === 'emp_id') return String(profile.emp_id || row.emp_id || row.user_id || '').trim();
  return String(profile[key] || '').trim();
}

function permissionKeysFor(rows = []) {
  const keys = new Set(CORE_PERMISSION_KEYS);
  for (const row of rows) {
    Object.keys(row || {}).forEach((key) => {
      if (key !== 'approve_proposals_agreements' && (key.startsWith('view_') || key.startsWith('can_') || ['finance_access', 'personal_reports_manager', 'manage_proposals_agreements'].includes(key))) {
        keys.add(key);
      }
    });
  }
  return [...keys];
}

function normalizeSearch(value) {
  return String(value || '').trim().toLocaleLowerCase('he');
}

function mergedRows(userRows, profileRows) {
  const profileMap = new Map((profileRows || []).map((row) => [String(row.user_id || ''), row]));
  return (userRows || []).map((row) => ({
    ...row,
    _employee_profile: profileMap.get(String(row.user_id || '')) || null
  }));
}

async function fetchData() {
  if (!supabase) throw new Error('no_supabase_client');
  await waitForSupabaseAuthSession({ timeoutMs: 7000 });
  if (!isAdmin()) throw new Error('admin_only');
  const [permissionData, employeeResult] = await Promise.all([
    api.permissions(),
    supabase.from('employee_profiles').select('user_id,emp_id,full_name,email,mobile,address,birth_date,direct_manager,employment_type,updated_at').order('full_name', { ascending: true })
  ]);
  if (employeeResult.error) throw employeeResult.error;
  const rows = mergedRows(Array.isArray(permissionData?.rows) ? permissionData.rows : [], employeeResult.data || []);
  return {
    rows,
    roleDefaults: permissionData?.roleDefaults || {},
    permissionKeys: permissionKeysFor(rows)
  };
}

function roleOptions(selected = 'all', includeAll = true) {
  const parts = [];
  if (includeAll) parts.push(`<option value="all"${selected === 'all' ? ' selected' : ''}>כל התפקידים</option>`);
  for (const role of ROLE_OPTIONS) {
    parts.push(`<option value="${escapeHtml(role)}"${selected === role ? ' selected' : ''}>${escapeHtml(hebrewRole(role))}</option>`);
  }
  return parts.join('');
}

function filteredRows() {
  const rows = uiState.data?.rows || [];
  const q = normalizeSearch(uiState.q);
  return rows.filter((row) => {
    if (uiState.status === 'active' && !isActive(row)) return false;
    if (uiState.status === 'inactive' && isActive(row)) return false;
    if (uiState.role !== 'all' && roleCode(row) !== uiState.role) return false;
    if (!q) return true;
    const haystack = [
      profileValue(row, 'full_name'), profileValue(row, 'emp_id'), profileValue(row, 'email'),
      profileValue(row, 'mobile'), row.username, row.user_id, hebrewRole(roleCode(row))
    ].map(normalizeSearch).join(' ');
    return haystack.includes(q);
  }).sort((a, b) => profileValue(a, 'full_name').localeCompare(profileValue(b, 'full_name'), 'he'));
}

function tableHtml() {
  const rows = filteredRows();
  if (!rows.length) return '<div class="apm-empty">לא נמצאו עובדים בהתאם לסינון.</div>';
  return `<div class="apm-table-wrap"><table class="apm-table">
    <thead><tr><th>שם עובד</th><th>תפקיד</th><th>מייל / שם משתמש</th><th>סטטוס</th><th>גישה עיקרית</th><th class="apm-center">פעולות</th></tr></thead>
    <tbody>${rows.map((row) => {
      const uid = escapeHtml(String(row.user_id || ''));
      const username = String(row.username || '').trim();
      return `<tr data-apm-open="${uid}" tabindex="0">
        <td><span class="apm-name">${escapeHtml(profileValue(row, 'full_name') || row.user_id || 'ללא שם')}</span>${username ? `<span class="apm-secondary">${escapeHtml(username)}</span>` : ''}</td>
        <td>${escapeHtml(hebrewRole(roleCode(row)))}</td>
        <td>${escapeHtml(profileValue(row, 'email') || username || '—')}</td>
        <td><span class="apm-status${isActive(row) ? '' : ' is-inactive'}">${isActive(row) ? 'פעיל/ה' : 'לא פעיל/ה'}</span></td>
        <td>${escapeHtml(primaryAccessLabel(row))}</td>
        <td class="apm-center"><div class="apm-row-actions"><button type="button" class="apm-icon-btn" data-apm-edit="${uid}">עריכה</button></div></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function renderRoot(root) {
  const rows = uiState.data?.rows || [];
  const activeCount = rows.filter(isActive).length;
  const inactiveCount = rows.length - activeCount;
  const shownCount = filteredRows().length;
  root.innerHTML = `
    <div class="apm-head">
      <div><h1>משתמשים והרשאות</h1><p>ניהול עובדים, פרטי קשר והרשאות מערכת במקום אחד</p></div>
      <button type="button" class="apm-add" data-apm-add>+ הוספת עובד</button>
    </div>
    <div class="apm-toolbar">
      <div class="apm-tabs" role="tablist" aria-label="סטטוס עובד">
        <button type="button" class="apm-tab${uiState.status === 'active' ? ' is-active' : ''}" data-apm-status="active">פעילים (${activeCount})</button>
        <button type="button" class="apm-tab${uiState.status === 'inactive' ? ' is-active' : ''}" data-apm-status="inactive">לא פעילים (${inactiveCount})</button>
      </div>
      <input class="apm-search" type="search" data-apm-search placeholder="חיפוש לפי שם, מס׳ עובד, מייל או טלפון" value="${escapeHtml(uiState.q)}">
      <select class="apm-role" data-apm-role>${roleOptions(uiState.role, true)}</select>
      <span class="apm-meta">מוצגים ${shownCount} מתוך ${rows.length}</span>
    </div>
    <div data-apm-list>${tableHtml()}</div>`;
  bindRoot(root);
}

function bindRoot(root) {
  root.querySelectorAll('[data-apm-status]').forEach((btn) => btn.addEventListener('click', () => {
    uiState.status = btn.dataset.apmStatus || 'active';
    renderRoot(root);
  }));
  root.querySelector('[data-apm-search]')?.addEventListener('input', (event) => {
    uiState.q = event.target.value || '';
    const list = root.querySelector('[data-apm-list]');
    if (list) list.innerHTML = tableHtml();
    bindList(root);
    const meta = root.querySelector('.apm-meta');
    if (meta) meta.textContent = `מוצגים ${filteredRows().length} מתוך ${(uiState.data?.rows || []).length}`;
  });
  root.querySelector('[data-apm-role]')?.addEventListener('change', (event) => {
    uiState.role = event.target.value || 'all';
    renderRoot(root);
  });
  root.querySelector('[data-apm-add]')?.addEventListener('click', () => openEmployeeDrawer(null));
  bindList(root);
}

function bindList(root) {
  root.querySelectorAll('[data-apm-open]').forEach((tr) => {
    const open = () => openEmployeeDrawer(findRow(tr.dataset.apmOpen));
    tr.addEventListener('click', (event) => {
      if (event.target.closest('[data-apm-edit]')) return;
      open();
    });
    tr.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') open();
    });
  });
  root.querySelectorAll('[data-apm-edit]').forEach((btn) => btn.addEventListener('click', (event) => {
    event.stopPropagation();
    openEmployeeDrawer(findRow(btn.dataset.apmEdit));
  }));
}

function findRow(userId) {
  return (uiState.data?.rows || []).find((row) => String(row.user_id || '') === String(userId || '')) || null;
}

function closeDrawer() {
  document.querySelector('.apm-backdrop')?.remove();
  document.querySelector('.apm-drawer')?.remove();
}

function primaryAccessLabel(row) {
  if (roleCode(row) === ADMIN_ROLE) return 'גישה מלאה';
  const labels = PERMISSION_PAGES.filter((page) => effectivePermissionValue(row, page.permission)).map((page) => page.label);
  return labels.slice(0, 2).join(' · ') || 'ללא גישה לעמודים';
}

function permissionGroupsHtml(row, role, isNew = false) {
  const defaults = uiState.data?.roleDefaults?.[role] || {};
  const checked = (key) => role === ADMIN_ROLE || (isNew ? effectivePermissionValue(defaults, key) : effectivePermissionValue(row, key));
  const renderNode = (node, parentPermission = '', depth = 0, ancestorsOn = true) => {
    if (!node.permission) return '';
    const on = checked(node.permission);
    const effectiveOn = ancestorsOn && on;
    const disabled = role === ADMIN_ROLE || !ancestorsOn;
    const children = (node.children || []).filter((child) => child.permission).map((child) => renderNode(child, node.permission, depth + 1, effectiveOn)).join('');
    const input = `<label class="apm-permission-item"><input type="checkbox" data-apm-permission="${escapeHtml(node.permission)}" data-apm-stored-checked="${on ? 'yes' : 'no'}"${children ? ' data-apm-parent' : ''}${parentPermission ? ` data-apm-child-of="${escapeHtml(parentPermission)}"` : ''}${effectiveOn ? ' checked' : ''}${disabled ? ' disabled' : ''}><span>${escapeHtml(node.label)}</span></label>`;
    return depth === 0
      ? `<details class="apm-permission-group"${on ? ' open' : ''}><summary>${input}</summary>${children ? `<div class="apm-permission-grid">${children}</div>` : ''}</details>`
      : `<div class="apm-permission-node" style="margin-inline-start:${depth * 12}px">${input}${children}</div>`;
  };
  return PERMISSION_PAGES.map((page) => {
    return renderNode(page);
  }).join('');
}

function adminOnlyCapabilitiesHtml() {
  const labels = ADMIN_ONLY_CAPABILITIES.filter((item) => item.id !== 'admin.home').map((item) => `<li>${escapeHtml(item.label)}</li>`).join('');
  return `<details class="apm-permission-group"><summary><strong>כלי מנהל מערכת בלבד</strong></summary><p class="apm-role-default-note">כלים אלה אינם ניתנים להענקה לעובד רגיל.</p><ul>${labels}</ul></details>`;
}

function drawerHtml(row) {
  const isNew = !row;
  const currentUserId = String(state?.user?.user_id || '');
  const isSelf = !isNew && String(row.user_id || '') === currentUserId;
  const role = isNew ? 'instructor' : roleCode(row);
  const active = isNew ? true : isActive(row);
  const userId = isNew ? '' : String(row.user_id || '');
  const empId = isNew ? '' : profileValue(row, 'emp_id');
  const title = isNew ? 'הוספת עובד' : (profileValue(row, 'full_name') || userId);
  const subtitle = isNew ? 'יצירת עובד והרשאות מערכת' : `מס׳ עובד ${empId || '—'}${row.username ? ` · ${row.username}` : ''}`;
  return `<div class="apm-backdrop" data-apm-close></div>
    <aside class="apm-drawer" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="apm-drawer-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><button type="button" class="apm-close" data-apm-close aria-label="סגירה">×</button></div>
      <div class="apm-drawer-body">
        <section class="apm-section">
          <h3>פרטי עובד</h3>
          <div class="apm-grid">
            <div class="apm-field"><label>שם מלא</label><input data-apm-field="full_name" value="${escapeHtml(isNew ? '' : profileValue(row, 'full_name'))}"></div>
            <div class="apm-field"><label>מס׳ עובד</label><input data-apm-field="emp_id" value="${escapeHtml(empId)}"${isNew ? '' : ' readonly'}></div>
            <div class="apm-field"><label>שם משתמש</label><input data-apm-field="username" value="${escapeHtml(isNew ? '' : String(row.username || ''))}" placeholder="אופציונלי"></div>
            <div class="apm-field"><label>תפקיד</label><select data-apm-field="role"${isSelf ? ' disabled' : ''}>${roleOptions(role, false)}</select>${isSelf ? '<span class="apm-lock-note">לא ניתן לשנות את תפקיד מנהל המערכת המחובר.</span>' : ''}</div>
            <div class="apm-field"><label>מייל</label><input type="email" data-apm-field="email" value="${escapeHtml(isNew ? '' : profileValue(row, 'email'))}"></div>
            <div class="apm-field"><label>טלפון</label><input data-apm-field="mobile" value="${escapeHtml(isNew ? '' : profileValue(row, 'mobile'))}"></div>
            <div class="apm-field apm-field--wide"><label>כתובת</label><input data-apm-field="address" value="${escapeHtml(isNew ? '' : profileValue(row, 'address'))}"></div>
            <div class="apm-field"><label>תאריך לידה</label><input type="date" data-apm-field="birth_date" value="${escapeHtml(isNew ? '' : profileValue(row, 'birth_date').slice(0,10))}"></div>
            <div class="apm-field"><label>מנהל ישיר</label><input data-apm-field="direct_manager" value="${escapeHtml(isNew ? '' : profileValue(row, 'direct_manager'))}"></div>
            <div class="apm-field"><label>סוג העסקה</label><input data-apm-field="employment_type" value="${escapeHtml(isNew ? '' : profileValue(row, 'employment_type'))}"></div>
            <div class="apm-field"><label>סטטוס</label><label class="apm-checkline"><input type="checkbox" data-apm-field="active"${active ? ' checked' : ''}${isSelf ? ' disabled' : ''}> פעיל/ה</label></div>
          </div>
        </section>
        <section class="apm-section">
          <h3>הרשאות מערכת</h3>
          <div data-apm-permissions>${permissionGroupsHtml(row || {}, role, isNew)}${adminOnlyCapabilitiesHtml()}</div>
          <p class="apm-role-default-note">שינוי תפקיד מחיל את ברירת המחדל של התפקיד. לאחר מכן ניתן לדייק הרשאות ידנית.</p>
        </section>
      </div>
      <div class="apm-drawer-actions">
        <button type="button" class="apm-save" data-apm-save>${isNew ? 'הוספה' : 'שמירה'}</button>
        <button type="button" class="apm-secondary-btn" data-apm-close>ביטול</button>
        ${!isNew && !isSelf && !active ? '<button type="button" class="apm-secondary-btn apm-danger" data-apm-delete>מחיקה</button>' : ''}
        <span class="apm-status-text" data-apm-status-text></span>
      </div>
    </aside>`;
}

function openEmployeeDrawer(row) {
  if (!isAdmin()) return;
  closeDrawer();
  document.body.insertAdjacentHTML('beforeend', drawerHtml(row));
  const drawer = document.querySelector('.apm-drawer');
  if (!drawer) return;
  document.querySelectorAll('[data-apm-close]').forEach((node) => node.addEventListener('click', closeDrawer));
  const roleSelect = drawer.querySelector('[data-apm-field="role"]');
  roleSelect?.addEventListener('change', () => {
    if (row && !window.confirm('החלפת תפקיד תטען את תבנית ברירת המחדל ותאפס חריגות אישיות. להמשיך?')) {
      roleSelect.value = roleCode(row);
      return;
    }
    const container = drawer.querySelector('[data-apm-permissions]');
    if (container) container.innerHTML = permissionGroupsHtml({}, roleSelect.value, true);
    bindPermissionHierarchy(drawer);
  });
  bindPermissionHierarchy(drawer);
  drawer.querySelector('[data-apm-save]')?.addEventListener('click', () => saveDrawer(row, drawer));
  drawer.querySelector('[data-apm-delete]')?.addEventListener('click', () => deleteEmployee(row, drawer));
  drawer.querySelector('[data-apm-field="full_name"]')?.focus();
}

function bindPermissionHierarchy(drawer) {
  drawer.querySelectorAll('[data-apm-parent]').forEach((parent) => parent.addEventListener('change', () => {
    const updateChildren = (permission, enabled) => {
      drawer.querySelectorAll(`[data-apm-child-of="${CSS.escape(permission)}"]`).forEach((child) => {
        if (!child.disabled) child.dataset.apmStoredChecked = child.checked ? 'yes' : 'no';
        child.disabled = !enabled;
        child.checked = enabled && child.dataset.apmStoredChecked === 'yes';
        updateChildren(child.dataset.apmPermission, enabled && child.checked);
      });
    };
    updateChildren(parent.dataset.apmPermission, parent.checked);
  }));
}

function fieldValue(drawer, key) {
  const el = drawer.querySelector(`[data-apm-field="${key}"]`);
  if (!el) return '';
  if (el.type === 'checkbox') return !!el.checked;
  return String(el.value || '').trim();
}

function storedPermissionValue(row, key) {
  if (!row) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, key) && row[key] != null) return row[key];
  const nested = row.permissions;
  if (nested && Object.prototype.hasOwnProperty.call(nested, key) && nested[key] != null) return nested[key];
  return undefined;
}

function permissionPayload(drawer, role, existingRow = null) {
  const payload = {};
  const allKeys = uiState.data?.permissionKeys || CORE_PERMISSION_KEYS;
  if (role === ADMIN_ROLE) {
    allKeys.forEach((key) => { payload[key] = 'yes'; });
    return payload;
  }
  allKeys.forEach((key) => {
    const el = drawer.querySelector(`[data-apm-permission="${CSS.escape(key)}"]`);
    if (el) {
      payload[key] = el.disabled ? (el.dataset.apmStoredChecked || 'no') : (el.checked ? 'yes' : 'no');
      return;
    }
    // A permission that is not represented in the current business tree must
    // survive an unrelated employee edit. Missing controls are not an explicit
    // administrator decision to revoke access.
    const storedValue = storedPermissionValue(existingRow, key);
    if (storedValue !== undefined) payload[key] = storedValue;
  });
  drawer.querySelectorAll('[data-apm-permission]').forEach((el) => {
    payload[el.dataset.apmPermission] = el.disabled ? (el.dataset.apmStoredChecked || 'no') : (el.checked ? 'yes' : 'no');
  });
  for (const [canonical, aliases] of Object.entries(LEGACY_PERMISSION_ALIASES)) {
    aliases.forEach((alias) => { payload[alias] = payload[canonical] || 'no'; });
  }
  // The permissions workspace is admin-only and this legacy flag can never grant it.
  payload.view_permissions = role === ADMIN_ROLE ? 'yes' : 'no';
  // Historical values are retained in storage compatibility, but approval is
  // never grantable to a non-admin from this workspace.
  payload.approve_proposals_agreements = role === ADMIN_ROLE ? 'yes' : 'no';
  return payload;
}

async function upsertEmployeeProfile(userId, values) {
  const payload = {
    user_id: userId,
    emp_id: values.emp_id || userId,
    full_name: values.full_name || null,
    email: values.email || null,
    mobile: values.mobile || null,
    address: values.address || null,
    birth_date: values.birth_date || null,
    direct_manager: values.direct_manager || null,
    employment_type: values.employment_type || null,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from('employee_profiles').upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
}

async function ensureInstructorContact(values) {
  if (values.role !== 'instructor' || !/^\d+$/.test(values.emp_id || '')) return;
  const row = {
    emp_id: Number(values.emp_id),
    full_name: values.full_name || null,
    mobile: values.mobile || null,
    email: values.email || null,
    address: values.address || null,
    employment_type: values.employment_type || null,
    direct_manager: values.direct_manager || null,
    active: values.active ? 'yes' : 'no',
    birth_date: values.birth_date || null
  };
  const { error } = await supabase.from('contacts_instructors').upsert(row, { onConflict: 'emp_id' });
  if (error) throw error;
}

async function employeeNumberExists(empId) {
  const [byUser, byEmp] = await Promise.all([
    supabase.from('users').select('user_id').eq('user_id', empId).maybeSingle(),
    supabase.from('users').select('user_id').eq('emp_id', empId).maybeSingle()
  ]);
  if (byUser.error) throw byUser.error;
  if (byEmp.error) throw byEmp.error;
  return !!(byUser.data || byEmp.data);
}

async function saveDrawer(existingRow, drawer) {
  const status = drawer.querySelector('[data-apm-status-text]');
  const saveButton = drawer.querySelector('[data-apm-save]');
  const isNew = !existingRow;
  const selfId = String(state?.user?.user_id || '');
  const values = {
    full_name: fieldValue(drawer, 'full_name'),
    emp_id: fieldValue(drawer, 'emp_id'),
    username: fieldValue(drawer, 'username'),
    role: fieldValue(drawer, 'role') || 'instructor',
    email: fieldValue(drawer, 'email'),
    mobile: fieldValue(drawer, 'mobile'),
    address: fieldValue(drawer, 'address'),
    birth_date: fieldValue(drawer, 'birth_date'),
    direct_manager: fieldValue(drawer, 'direct_manager'),
    employment_type: fieldValue(drawer, 'employment_type'),
    active: !!fieldValue(drawer, 'active')
  };
  if (!values.full_name || !values.emp_id) {
    if (status) status.textContent = 'יש להזין שם מלא ומס׳ עובד.';
    return;
  }
  if (isNew && await employeeNumberExists(values.emp_id)) {
    if (status) status.textContent = 'מס׳ העובד כבר קיים במערכת.';
    return;
  }
  const userId = isNew ? values.emp_id : String(existingRow.user_id || '');
  if (!isNew && userId === selfId) {
    values.role = ADMIN_ROLE;
    values.active = true;
  }
  const perms = permissionPayload(drawer, values.role, existingRow);

  saveButton.disabled = true;
  if (status) status.textContent = 'שומר…';
  try {
    if (isNew) {
      await api.addUser({ user_id: userId, full_name: values.full_name, entry_code: '', role: values.role });
    }
    await api.savePermission({
      user_id: userId,
      full_name: values.full_name,
      role: values.role,
      active: values.active ? 'yes' : 'no',
      emp_id: values.emp_id,
      ...perms
    });
    const { error: userError } = await supabase.from('users').update({
      full_name: values.full_name,
      name: values.full_name,
      email: values.email || null,
      username: values.username || values.emp_id,
      emp_id: values.emp_id,
      is_active: values.active
    }).eq('user_id', userId);
    if (userError) throw userError;
    await upsertEmployeeProfile(userId, values);
    await ensureInstructorContact(values);
    if (status) status.textContent = 'נשמר בהצלחה';
    await reloadData();
    window.setTimeout(closeDrawer, 250);
  } catch (error) {
    console.error('[admin-permissions-management-v2] save failed', error);
    if (status) status.textContent = `לא ניתן לשמור: ${String(error?.message || 'שגיאה')}`;
  } finally {
    saveButton.disabled = false;
  }
}

async function deleteEmployee(row, drawer) {
  if (!row || isActive(row) || String(row.user_id || '') === String(state?.user?.user_id || '')) return;
  const name = profileValue(row, 'full_name') || row.user_id;
  if (!window.confirm(`למחוק לצמיתות את ${name}? היסטוריית הפעילויות לא תימחק.`)) return;
  const status = drawer.querySelector('[data-apm-status-text]');
  try {
    if (status) status.textContent = 'מוחק…';
    await api.deleteUser(String(row.user_id || ''));
    await reloadData();
    closeDrawer();
  } catch (error) {
    if (status) status.textContent = `לא ניתן למחוק: ${String(error?.message || 'שגיאה')}`;
  }
}

async function reloadData() {
  if (!uiState.mounted || uiState.loading) return;
  uiState.loading = true;
  const root = uiState.mounted;
  try {
    uiState.data = await fetchData();
    if (root.isConnected) renderRoot(root);
  } finally {
    uiState.loading = false;
  }
}

async function mountIfNeeded() {
  ensureStyles();
  if (!isPermissionsRoute()) {
    closeDrawer();
    return;
  }
  if (!isAdmin()) {
    closeDrawer();
    document.querySelector('.ds-perm-screen')?.remove();
    return;
  }
  const screen = document.querySelector('.ds-perm-screen');
  if (!screen) return;
  if (screen.getAttribute(ROOT_ATTR) === VERSION && uiState.mounted === screen) return;
  screen.setAttribute(ROOT_ATTR, VERSION);
  uiState.mounted = screen;
  screen.innerHTML = '<div class="apm-empty">טוען עובדים והרשאות…</div>';
  uiState.loading = true;
  try {
    uiState.data = await fetchData();
    if (screen.isConnected && isPermissionsRoute() && isAdmin()) renderRoot(screen);
  } catch (error) {
    console.error('[admin-permissions-management-v2] load failed', error);
    if (screen.isConnected) screen.innerHTML = '<div class="apm-empty">לא ניתן לטעון את נתוני העובדים וההרשאות.</div>';
  } finally {
    uiState.loading = false;
  }
}

function scheduleMount() {
  window.setTimeout(() => { mountIfNeeded().catch(() => {}); }, 0);
}

if (typeof document !== 'undefined') {
  ensureStyles();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleMount, { once: true });
  else scheduleMount();
  document.addEventListener('app:navigate', scheduleMount);
  const observer = new MutationObserver(scheduleMount);
  observer.observe(document.getElementById('app') || document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-current-route'] });
}

export { isAdmin, fetchData, mergedRows, primaryAccessLabel, permissionPayload };

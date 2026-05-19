import { escapeHtml } from './shared/html.js';
import { formatDateHe } from './shared/format-date.js';
import { dsPageHeader, dsCard, dsScreenStack, dsTableWrap, dsEmptyState } from './shared/layout.js';
import { hebrewActivityType } from './shared/ui-hebrew.js';

const FINANCE_CLOSED = 'סגור';

function permissionYes(value) { return ['yes', 'true', '1'].includes(String(value || '').trim().toLowerCase()); }
function normalizeFinanceStatus(value) { return String(value || '').trim(); }
function isFinanceClosed(value) { return normalizeFinanceStatus(value) === FINANCE_CLOSED; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function money(v) { return `₪${num(v).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`; }

function groupMeta(row = {}) {
  const funding = String(row.funding || '').trim() || 'ללא מימון';
  const authority = String(row.authority || '').trim() || '—';
  const school = String(row.school || '').trim() || '—';
  const cluster = funding === 'גפ״ן' ? school : (funding === 'רשות' ? authority : funding);
  return { funding, authority, school, cluster };
}

function groupActivities(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const meta = groupMeta(row);
    const key = `${meta.funding}__${meta.cluster}`;
    if (!map.has(key)) map.set(key, { key, ...meta, authorities: new Set(), activities: [], total: 0 });
    const g = map.get(key);
    g.authorities.add(meta.authority);
    g.activities.push(row);
    g.total += num(row.price);
  }
  return [...map.values()]
    .map((g) => ({ ...g, authorityDisplay: g.authorities.size === 1 ? [...g.authorities][0] : 'מרובה' }))
    .sort((a, b) => b.activities.length - a.activities.length);
}

function activityRowId(row = {}) { return String(row.RowID || row.row_id || '').trim(); }

function activityViewDetails(row) {
  return `<div style="margin-top:8px;font-size:12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">
    <div><strong>שם פעילות:</strong> ${escapeHtml(row.activity_name || '')}</div>
    <div><strong>סוג פעילות:</strong> ${escapeHtml(hebrewActivityType(row.activity_type))}</div>
    <div><strong>בית ספר:</strong> ${escapeHtml(row.school || '—')}</div>
    <div><strong>רשות:</strong> ${escapeHtml(row.authority || '—')}</div>
    <div><strong>מדריך:</strong> ${escapeHtml(row.instructor_name || '—')}</div>
    <div><strong>מנהל / אחראי:</strong> ${escapeHtml(row.activity_manager || '—')}</div>
    <div><strong>תאריך התחלה:</strong> ${escapeHtml(formatDateHe(row.start_date || row.date_start || '') || '—')}</div>
    <div><strong>תאריך סיום:</strong> ${escapeHtml(formatDateHe(row.end_date || row.date_end || '') || '—')}</div>
    <div><strong>מספר מפגשים:</strong> ${escapeHtml(String(row.sessions || '—'))}</div>
    <div><strong>סכום פעילות:</strong> ${escapeHtml(money(row.price))}</div>
    <div><strong>סטטוס פעילות:</strong> ${escapeHtml(row.status || '—')}</div>
    <div><strong>סטטוס כספים:</strong> ${escapeHtml(row.finance_status || '')}</div>
    <div style="grid-column:1/-1"><strong>הערות כספים:</strong> ${escapeHtml(String(row.finance_notes || '—'))}</div>
  </div>`;
}

function activityEditDetails(row) {
  const rowId = activityRowId(row);
  return `<div style="margin-top:8px;font-size:12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">
    <div><strong>שם פעילות:</strong> ${escapeHtml(row.activity_name || '')}</div>
    <div><strong>סוג פעילות:</strong> ${escapeHtml(hebrewActivityType(row.activity_type))}</div>
    <div><strong>בית ספר:</strong> ${escapeHtml(row.school || '—')}</div>
    <div><strong>רשות:</strong> ${escapeHtml(row.authority || '—')}</div>
    <div><strong>מדריך:</strong> ${escapeHtml(row.instructor_name || '—')}</div>
    <div><strong>מנהל / אחראי:</strong> ${escapeHtml(row.activity_manager || '—')}</div>
    <div><strong>תאריך התחלה:</strong> ${escapeHtml(formatDateHe(row.start_date || row.date_start || '') || '—')}</div>
    <div><strong>תאריך סיום:</strong> ${escapeHtml(formatDateHe(row.end_date || row.date_end || '') || '—')}</div>
    <div><strong>מספר מפגשים:</strong> ${escapeHtml(String(row.sessions || '—'))}</div>
    <div><strong>סכום פעילות:</strong> <input class="ds-input ds-input--sm" data-finance-field="price" data-row-id="${escapeHtml(rowId)}" value="${escapeHtml(String(row.price ?? ''))}" /></div>
    <div><strong>סטטוס פעילות:</strong> ${escapeHtml(row.status || '—')}</div>
    <div><strong>סטטוס כספים:</strong> <input class="ds-input ds-input--sm" data-finance-field="finance_status" data-row-id="${escapeHtml(rowId)}" value="${escapeHtml(String(row.finance_status || ''))}" /></div>
    <div style="grid-column:1/-1"><strong>הערות כספים:</strong> <textarea class="ds-input" rows="2" data-finance-field="finance_notes" data-row-id="${escapeHtml(rowId)}">${escapeHtml(String(row.finance_notes || ''))}</textarea></div>
    <div style="grid-column:1/-1"><button class="ds-btn ds-btn--sm ds-btn--primary" data-finance-save="${escapeHtml(rowId)}">שמירה</button></div>
  </div>`;
}

export const financeScreen = {
  load: ({ api }) => api.allActivities(),
  render(data, { state } = {}) {
    if (!permissionYes(state?.user?.finance_access)) {
      return dsScreenStack(`${dsPageHeader('כספים / גבייה', 'גישה מוגבלת')} ${dsEmptyState('אין הרשאה לעמוד כספים (finance_access).')}`);
    }

    const tab = String(state?.financeTab || 'active');
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const rows = allRows.filter((r) => tab === 'archive' ? isFinanceClosed(r.finance_status) : !isFinanceClosed(r.finance_status));
    const groups = groupActivities(rows);

    const tabs = `<div class="ds-tabs" style="display:flex;gap:6px"><button class="ds-btn ds-btn--sm ${tab === 'active' ? 'ds-btn--primary' : ''}" data-finance-tab="active">גבייה פעילה</button><button class="ds-btn ds-btn--sm ${tab === 'archive' ? 'ds-btn--primary' : ''}" data-finance-tab="archive">ארכיון כספים</button></div>`;
    const body = groups.map((g) => `<tr class="ds-data-row" data-finance-group="${escapeHtml(g.key)}" role="button" tabindex="0"><td>${escapeHtml(g.funding)}</td><td>${escapeHtml(g.authorityDisplay)}</td><td>${g.activities.length}</td><td>${escapeHtml(money(g.total))}</td></tr>`).join('');
    const table = groups.length
      ? dsTableWrap(`<table class="ds-table ds-table--interactive ds-table--compact"><thead><tr><th>גורם מימון</th><th>רשות</th><th>כמות פעילויות</th><th>סה״כ לגבייה</th></tr></thead><tbody>${body}</tbody></table>`)
      : dsEmptyState('אין רשומות בלשונית זו');
    return dsScreenStack(`${dsPageHeader('כספים / גבייה', `ריכוזי גבייה (${groups.length})`)} ${tabs} ${dsCard({ title: 'ריכוז גבייה', body: table, padded: groups.length === 0 })}`);
  },
  bind({ root, data, state, ui, api, rerender, clearScreenDataCache }) {
    if (!permissionYes(state?.user?.finance_access)) return;
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const tab = String(state?.financeTab || 'active');
    const filtered = allRows.filter((r) => tab === 'archive' ? isFinanceClosed(r.finance_status) : !isFinanceClosed(r.finance_status));
    const groups = groupActivities(filtered);
    const byKey = new Map(groups.map((g) => [g.key, g]));

    root.querySelectorAll('[data-finance-tab]').forEach((b) => b.addEventListener('click', () => { state.financeTab = b.dataset.financeTab; rerender?.(); }));

    const openGroup = (g) => {
      const summary = `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;font-size:12px"><div><strong>גורם מימון:</strong> ${escapeHtml(g.funding)}</div><div><strong>רשות:</strong> ${escapeHtml(g.authorityDisplay)}</div><div><strong>גורם ריכוז:</strong> ${escapeHtml(g.cluster)}</div><div><strong>כמות פעילויות:</strong> ${g.activities.length}</div><div><strong>סה״כ לגבייה:</strong> ${escapeHtml(money(g.total))}</div></div>`;
      const activities = g.activities.map((row) => {
        const rowId = activityRowId(row);
        return `<details class="ds-acc" style="border:1px solid #e5e7eb;border-radius:8px;padding:6px">
          <summary style="cursor:pointer;display:flex;justify-content:space-between;gap:8px;font-size:12px"><span>${escapeHtml(row.activity_name || 'ללא שם')}</span><span>${escapeHtml(hebrewActivityType(row.activity_type))}</span><span>${escapeHtml(formatDateHe(row.end_date || row.date_end || '') || '—')}</span><span>${escapeHtml(money(row.price))}</span></summary>
          <div style="margin-top:8px;display:flex;gap:6px"><button class="ds-btn ds-btn--sm" data-finance-mode="view" data-row-id="${escapeHtml(rowId)}">צפייה</button><button class="ds-btn ds-btn--sm" data-finance-mode="edit" data-row-id="${escapeHtml(rowId)}">עריכה</button></div>
          <div data-finance-panel="${escapeHtml(rowId)}">${activityViewDetails(row)}</div>
        </details>`;
      }).join('');
      ui.openDrawer({ title: 'פירוט גבייה', content: `<div style="display:grid;gap:10px">${summary}<div style="display:grid;gap:6px">${activities}</div></div>` });

      const rowLookup = new Map(g.activities.map((r) => [activityRowId(r), r]));
      document.querySelectorAll('[data-finance-mode]').forEach((btn) => btn.addEventListener('click', () => {
        const rowId = String(btn.dataset.rowId || '');
        const mode = String(btn.dataset.financeMode || 'view');
        const row = rowLookup.get(rowId);
        const panel = document.querySelector(`[data-finance-panel="${rowId}"]`);
        if (!row || !panel) return;
        panel.innerHTML = mode === 'edit' ? activityEditDetails(row) : activityViewDetails(row);
      }));

      document.querySelectorAll('[data-finance-save]').forEach((btn) => btn.addEventListener('click', async () => {
        const rowId = String(btn.dataset.financeSave || '');
        const changes = {};
        document.querySelectorAll(`[data-row-id="${rowId}"]`).forEach((el) => { changes[el.dataset.financeField] = el.value; });
        await api.saveActivity({ source_row_id: rowId, source_sheet: 'activities', changes });
        clearScreenDataCache?.();
        rerender?.();
      }));
    };

    root.querySelectorAll('[data-finance-group]').forEach((rowEl) => rowEl.addEventListener('click', () => {
      const g = byKey.get(rowEl.dataset.financeGroup);
      if (g) openGroup(g);
    }));
  }
};

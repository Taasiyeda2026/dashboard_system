import { escapeHtml } from './shared/html.js';
import { formatDateHe } from './shared/format-date.js';
import { dsPageHeader, dsCard, dsScreenStack, dsTableWrap, dsEmptyState, dsStatusChip } from './shared/layout.js';
import { hebrewActivityType, financeStatusVariant } from './shared/ui-hebrew.js';

const FINANCE_CLOSED = 'סגור';

function normalizeFinanceStatus(value) { return String(value || '').trim(); }
function isFinanceClosed(value) { return normalizeFinanceStatus(value) === FINANCE_CLOSED; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function money(v) { return `₪${num(v).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`; }

function buildGroupKey(row = {}) {
  const funding = String(row.funding || '').trim() || 'ללא מימון';
  const authority = String(row.authority || '').trim() || '—';
  const school = String(row.school || '').trim() || '—';
  const cluster = funding === 'גפ״ן' ? school : (funding === 'רשות' ? authority : funding);
  return `${funding}__${authority}__${cluster}`;
}

function groupActivities(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const key = buildGroupKey(row);
    const funding = String(row.funding || '').trim() || 'ללא מימון';
    const authority = String(row.authority || '').trim() || '—';
    const school = String(row.school || '').trim() || '—';
    const cluster = funding === 'גפ״ן' ? school : (funding === 'רשות' ? authority : funding);
    if (!map.has(key)) map.set(key, { key, funding, authority, cluster, activities: [], total: 0, notesCount: 0, openCount: 0 });
    const g = map.get(key);
    g.activities.push(row);
    g.total += num(row.price);
    if (String(row.finance_notes || '').trim()) g.notesCount += 1;
    if (!isFinanceClosed(row.finance_status)) g.openCount += 1;
  }
  return [...map.values()].sort((a, b) => b.activities.length - a.activities.length);
}

function groupFinanceStatus(g) { return g.openCount === 0 ? FINANCE_CLOSED : 'פתוח'; }

export const financeScreen = {
  load: ({ api }) => api.allActivities(),
  render(data, { state } = {}) {
    const hasAccess = ['yes', 'true', '1'].includes(String(state?.user?.finance_access || '').toLowerCase());
    if (!hasAccess) return dsScreenStack(`${dsPageHeader('כספים / גבייה', 'גישה מוגבלת')} ${dsEmptyState('אין הרשאה לעמוד כספים (finance_access).')}`);

    const tab = String(state?.financeTab || 'active');
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const rows = allRows.filter((r) => tab === 'archive' ? isFinanceClosed(r.finance_status) : !isFinanceClosed(r.finance_status));
    const groups = groupActivities(rows);

    const tabs = `<div class="ds-tabs" style="display:flex;gap:8px"><button class="ds-btn ds-btn--sm ${tab === 'active' ? 'ds-btn--primary' : ''}" data-finance-tab="active">גבייה פעילה</button><button class="ds-btn ds-btn--sm ${tab === 'archive' ? 'ds-btn--primary' : ''}" data-finance-tab="archive">ארכיון כספים</button></div>`;
    const body = groups.map((g) => `<tr class="ds-data-row" data-finance-group="${escapeHtml(g.key)}" role="button" tabindex="0"><td>${escapeHtml(g.funding)}</td><td>${escapeHtml(g.authority)}</td><td>${g.activities.length}</td><td>${escapeHtml(money(g.total))}</td></tr>`).join('');
    const table = groups.length ? dsTableWrap(`<table class="ds-table ds-table--interactive ds-table--compact"><thead><tr><th>גורם מימון</th><th>רשות</th><th>כמות פעילויות</th><th>סה״כ לגבייה</th></tr></thead><tbody>${body}</tbody></table>`) : dsEmptyState('אין רשומות בלשונית זו');
    return dsScreenStack(`${dsPageHeader('כספים / גבייה', `ריכוזי גבייה (${groups.length})`)} ${tabs} ${dsCard({ title:'ריכוז גבייה', body: table, padded: groups.length===0 })}`);
  },
  bind({ root, data, state, ui, api, rerender, clearScreenDataCache }) {
    const hasAccess = ['yes', 'true', '1'].includes(String(state?.user?.finance_access || '').toLowerCase());
    if (!hasAccess) return;
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const tab = String(state?.financeTab || 'active');
    const filtered = allRows.filter((r) => tab === 'archive' ? isFinanceClosed(r.finance_status) : !isFinanceClosed(r.finance_status));
    const groups = groupActivities(filtered);
    const byKey = new Map(groups.map((g) => [g.key, g]));

    root.querySelectorAll('[data-finance-tab]').forEach((b) => b.addEventListener('click', () => { state.financeTab = b.dataset.financeTab; rerender?.(); }));

    const openGroup = (g) => {
      const summary = `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;font-size:13px"><div><strong>גורם מימון:</strong> ${escapeHtml(g.funding)}</div><div><strong>רשות:</strong> ${escapeHtml(g.authority)}</div><div><strong>גורם ריכוז:</strong> ${escapeHtml(g.cluster)}</div><div><strong>כמות פעילויות:</strong> ${g.activities.length}</div><div><strong>סה״כ לגבייה:</strong> ${escapeHtml(money(g.total))}</div><div><strong>סטטוס כספים:</strong> ${dsStatusChip(groupFinanceStatus(g), financeStatusVariant(groupFinanceStatus(g)))}</div><div><strong>הערות כספים:</strong> ${g.notesCount > 0 ? 'יש' : 'אין'}</div></div>`;
      const activities = g.activities.map((row, idx) => `<details class="ds-acc" style="border:1px solid #e5e7eb;border-radius:8px;padding:6px"><summary style="cursor:pointer;display:flex;justify-content:space-between;gap:8px"><span>${escapeHtml(row.activity_name || 'ללא שם')}</span><span>${escapeHtml(hebrewActivityType(row.activity_type))}</span><span>${escapeHtml(formatDateHe(row.end_date || row.date_end || '') || '—')}</span><span>${escapeHtml(money(row.price))}</span></summary><div style="margin-top:8px;font-size:13px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px"><div><strong>שם פעילות:</strong> ${escapeHtml(row.activity_name || '')}</div><div><strong>סוג פעילות:</strong> ${escapeHtml(hebrewActivityType(row.activity_type))}</div><div><strong>בית ספר:</strong> ${escapeHtml(row.school || '—')}</div><div><strong>רשות:</strong> ${escapeHtml(row.authority || '—')}</div><div><strong>מדריך:</strong> ${escapeHtml(row.instructor_name || '—')}</div><div><strong>מנהל / אחראי:</strong> ${escapeHtml(row.activity_manager || '—')}</div><div><strong>תאריך התחלה:</strong> ${escapeHtml(formatDateHe(row.start_date || row.date_start || '') || '—')}</div><div><strong>תאריך סיום:</strong> ${escapeHtml(formatDateHe(row.end_date || row.date_end || '') || '—')}</div><div><strong>מספר מפגשים:</strong> ${escapeHtml(String(row.sessions || '—'))}</div><div><strong>סכום פעילות:</strong> <input class="ds-input ds-input--sm" data-finance-field="price" data-row-id="${escapeHtml(row.RowID || row.row_id)}" value="${escapeHtml(String(row.price ?? ''))}" /></div><div><strong>סטטוס פעילות:</strong> ${escapeHtml(row.status || '—')}</div><div><strong>סטטוס כספים:</strong> <input class="ds-input ds-input--sm" data-finance-field="finance_status" data-row-id="${escapeHtml(row.RowID || row.row_id)}" value="${escapeHtml(String(row.finance_status || ''))}" /></div><div style="grid-column:1/-1"><strong>הערות כספים:</strong> <textarea class="ds-input" rows="2" data-finance-field="finance_notes" data-row-id="${escapeHtml(row.RowID || row.row_id)}">${escapeHtml(String(row.finance_notes || ''))}</textarea></div><div style="grid-column:1/-1;display:flex;gap:6px"><button class="ds-btn ds-btn--sm ds-btn--primary" data-finance-save="${escapeHtml(row.RowID || row.row_id)}">שמירה</button></div></div></details>`).join('');
      ui.openDrawer({ title: 'פירוט גבייה', content: `<div style="display:grid;gap:10px">${summary}<div style="display:grid;gap:6px">${activities}</div></div>` });
      document.querySelectorAll('[data-finance-save]').forEach((btn) => btn.addEventListener('click', async () => {
        const rowId = btn.dataset.financeSave;
        const changes = {};
        document.querySelectorAll(`[data-row-id="${rowId}"]`).forEach((el) => { changes[el.dataset.financeField] = el.value; });
        await api.saveActivity({ source_row_id: rowId, source_sheet: 'activities', changes });
        clearScreenDataCache?.();
        rerender?.();
      }));
    };

    root.querySelectorAll('[data-finance-group]').forEach((rowEl) => rowEl.addEventListener('click', () => { const g = byKey.get(rowEl.dataset.financeGroup); if (g) openGroup(g); }));
  }
};

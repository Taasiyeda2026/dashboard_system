import { escapeHtml } from './shared/html.js';
import { formatDateHe } from './shared/format-date.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsEmptyState
} from './shared/layout.js';

// ─── Permission ─────────────────────────────────────────────────────────────

function permissionYes(value) {
  return value === true || ['yes', 'true', '1'].includes(String(value || '').trim().toLowerCase());
}

function canAccessFinance(user = {}) {
  // finance_access is set from has_finance_access which includes view_finance = "yes"
  return permissionYes(user?.finance_access) || String(user?.role || user?.display_role || '').trim() === 'finance';
}

// ─── Normalize helpers ───────────────────────────────────────────────────────

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const cleaned = String(v ?? '').replace(/[₪,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function money(v) {
  const n = num(v);
  if (!n) return '—';
  return `₪${n.toLocaleString('he-IL', { maximumFractionDigits: 0 })}`;
}

function hasValidPrice(row = {}) {
  const raw = row.price ?? row.amount ?? row.activity_price;
  if (raw === null || raw === undefined || raw === '') return false;
  const n = num(raw);
  return n > 0;
}

function rowPrice(row = {}) {
  return num(row.price ?? row.amount ?? row.activity_price);
}

function isCollected(row = {}) {
  const v = String(row.payment_collected ?? row.collected ?? '').trim().toLowerCase();
  return v === 'yes' || v === 'true' || v === '1' || v === 'נגבה';
}

function activityRowId(row = {}) {
  return String(row.RowID || row.row_id || row.source_row_id || '').trim();
}

function rowEndDate(row = {}) {
  return String(row.end_date || row.date_end || row.start_date || '').trim();
}

function isActivityClosed(row = {}) {
  const status = String(row.status || '').trim().toLowerCase();
  if (['סגור', 'closed', 'inactive', 'נמחק', 'deleted'].includes(status)) return true;
  const endRaw = rowEndDate(row);
  if (!endRaw) return false;
  const endDate = new Date(endRaw);
  if (isNaN(endDate.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return endDate < today;
}

// ─── Activity type normalization ─────────────────────────────────────────────

const FINANCE_ACTIVITY_TYPES = [
  { key: 'course', label: 'קורסים' },
  { key: 'workshop', label: 'סדנאות' },
  { key: 'escape_room', label: 'חדרי בריחה' },
  { key: 'after_school', label: 'After School' }
];
const FINANCE_TYPE_LABEL = Object.fromEntries(FINANCE_ACTIVITY_TYPES.map((t) => [t.key, t.label]));

function normalizeFinanceActivityType(value) {
  const raw = String(value || '').trim();
  const compact = raw.toLowerCase().replace(/[\s_\-]+/g, '');
  if (['course', 'courses', 'קורס', 'קורסים'].includes(compact)) return 'course';
  if (['workshop', 'workshops', 'סדנה', 'סדנאות'].includes(compact)) return 'workshop';
  if (['escaproom', 'escaperoom', 'escape_room', 'חדרבריחה', 'חדריבריחה'].includes(compact)) return 'escape_room';
  if (['afterschool', 'after_school', 'אפטרסקול', 'חוגאפטרסקול'].includes(compact)) return 'after_school';
  return 'other';
}

// ─── Finance exceptions ───────────────────────────────────────────────────────

function financeExceptions(row = {}) {
  const out = [];
  if (!hasValidPrice(row)) out.push('no_price');
  if (!String(row.funding || '').trim()) out.push('no_funding');
  if (!String(row.activity_type || '').trim()) out.push('no_activity_type');
  if (!String(row.activity_season || row.season || '').trim()) out.push('no_season');
  if (isActivityClosed(row) && !hasValidPrice(row)) out.push('closed_no_price');
  const price = rowPrice(row);
  if (price > 0 && isNaN(price)) out.push('invalid_price');
  return [...new Set(out)];
}

const EXCEPTION_LABELS = {
  no_price: 'ללא מחיר',
  no_funding: 'ללא גורם מימון',
  no_activity_type: 'ללא סוג פעילות',
  no_season: 'ללא עונה',
  closed_no_price: 'סגורה ללא מחיר',
  invalid_price: 'מחיר לא תקין'
};

function exceptionLabel(type) {
  return EXCEPTION_LABELS[type] || type;
}

// ─── Data grouping ────────────────────────────────────────────────────────────

function buildFinanceTree(rows = []) {
  // tree: activityTypeKey → fundingKey → clusterKey → rows[]
  const tree = {};
  for (const row of rows) {
    const typeKey = normalizeFinanceActivityType(row.activity_type);
    const funding = String(row.funding || '').trim() || 'ללא מימון';
    const authority = String(row.authority || '').trim() || '—';
    const school = String(row.school || '').trim() || '—';
    // cluster logic per spec
    let clusterKey;
    if (funding === 'גפ״ן' || funding === "גפ'ן" || funding === 'גפן') {
      clusterKey = school;
    } else if (funding === 'רשות') {
      clusterKey = authority;
    } else {
      clusterKey = funding;
    }
    if (!tree[typeKey]) tree[typeKey] = {};
    if (!tree[typeKey][funding]) tree[typeKey][funding] = {};
    if (!tree[typeKey][funding][clusterKey]) tree[typeKey][funding][clusterKey] = [];
    tree[typeKey][funding][clusterKey].push(row);
  }
  return tree;
}

function treeStats(rows = []) {
  let total = 0, collected = 0, notCollected = 0, noPrice = 0, open = 0, closed = 0, totalPrice = 0, collectedPrice = 0;
  for (const row of rows) {
    total++;
    const price = rowPrice(row);
    totalPrice += price;
    if (isActivityClosed(row)) closed++;
    else open++;
    if (!hasValidPrice(row)) { noPrice++; }
    if (isCollected(row)) { collected++; collectedPrice += price; }
    else notCollected++;
  }
  return { total, collected, notCollected, noPrice, open, closed, totalPrice, collectedPrice };
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function kpiBox(label, value, sub = '') {
  return `<div class="ds-fin-kpi">
    <div class="ds-fin-kpi__val">${escapeHtml(String(value))}</div>
    <div class="ds-fin-kpi__label">${escapeHtml(label)}</div>
    ${sub ? `<div class="ds-fin-kpi__sub">${escapeHtml(sub)}</div>` : ''}
  </div>`;
}

function kpiRow(stats) {
  return `<div class="ds-fin-kpis">
    ${kpiBox('סה״כ', stats.total)}
    ${kpiBox('ללא מחיר', stats.noPrice)}
    ${kpiBox('נגבו', stats.collected, stats.collectedPrice ? money(stats.collectedPrice) : '')}
    ${kpiBox('לא נגבו', stats.notCollected)}
    ${kpiBox('פתוחות', stats.open)}
    ${kpiBox('סגורות', stats.closed)}
    ${kpiBox('סך מחיר', '', money(stats.totalPrice))}
  </div>`;
}

function activityRowHtml(row, showSaveBtn = false) {
  const rowId = escapeHtml(activityRowId(row));
  const price = rowPrice(row);
  const collected = isCollected(row);
  const closed = isActivityClosed(row);
  const exceptions = financeExceptions(row);
  const excText = exceptions.map(exceptionLabel).join(', ');
  const dateStr = escapeHtml(formatDateHe(rowEndDate(row)) || rowEndDate(row) || '—');
  const collectLabel = collected ? 'נגבה' : 'לא נגבה';
  const collectClass = collected ? 'ds-fin-badge--collected' : 'ds-fin-badge--not-collected';
  const statusLabel = closed ? 'סגורה' : 'פתוחה';
  const statusClass = closed ? 'ds-fin-badge--closed' : 'ds-fin-badge--open';
  return `<tr class="ds-fin-row" data-fin-row-id="${rowId}">
    <td class="ds-fin-col--name">${escapeHtml(row.activity_name || '—')}</td>
    <td class="ds-fin-col--type">${escapeHtml(FINANCE_TYPE_LABEL[normalizeFinanceActivityType(row.activity_type)] || row.activity_type || '—')}</td>
    <td class="ds-fin-col--date" style="text-align:center">${dateStr}</td>
    <td class="ds-fin-col--school">${escapeHtml(String(row.school || '—'))}</td>
    <td class="ds-fin-col--price" style="text-align:left">${price ? escapeHtml(money(price)) : '—'}</td>
    <td class="ds-fin-col--collect">
      <span class="ds-fin-badge ${collectClass}">${collectLabel}</span>
      ${showSaveBtn ? `<button type="button" class="ds-fin-toggle-btn ds-btn ds-btn--xs ds-btn--ghost" data-fin-toggle-collect="${rowId}">${collected ? 'בטל גבייה' : 'סמן כנגבה'}</button>` : ''}
    </td>
    <td class="ds-fin-col--status"><span class="ds-fin-badge ${statusClass}">${statusLabel}</span></td>
    <td class="ds-fin-col--exc">${excText ? escapeHtml(excText) : ''}</td>
  </tr>`;
}

function clusterAccordionHtml(clusterKey, clusterRows, fundingKey, typeKey, expandAll = false) {
  const stats = treeStats(clusterRows);
  const clusterLabel = clusterKey;
  const rowsHtml = clusterRows
    .slice()
    .sort((a, b) => String(rowEndDate(a)).localeCompare(String(rowEndDate(b))))
    .map((row) => activityRowHtml(row, true))
    .join('');
  const tableHtml = `<table class="ds-fin-table" dir="rtl">
    <thead><tr>
      <th class="ds-fin-col--name">שם פעילות</th>
      <th class="ds-fin-col--type">סוג</th>
      <th class="ds-fin-col--date" style="text-align:center">תאריך</th>
      <th class="ds-fin-col--school">בית ספר</th>
      <th class="ds-fin-col--price">מחיר</th>
      <th class="ds-fin-col--collect">גבייה</th>
      <th class="ds-fin-col--status">סטטוס</th>
      <th class="ds-fin-col--exc">חריגה</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
  const summaryLine = `${stats.total} פעילויות · ${stats.collected} נגבו · ${stats.notCollected} לא נגבו · ${stats.noPrice} ללא מחיר · ${money(stats.totalPrice)}`;
  return `<details class="ds-fin-acc ds-fin-acc--cluster"${expandAll ? ' open' : ''} data-fin-cluster="${escapeHtml(fundingKey)}|${escapeHtml(clusterKey)}|${escapeHtml(typeKey)}">
    <summary class="ds-fin-acc__summary">
      <span class="ds-fin-acc__title">${escapeHtml(clusterLabel)}</span>
      <span class="ds-fin-acc__meta">${escapeHtml(summaryLine)}</span>
    </summary>
    <div class="ds-fin-acc__body">${tableHtml}</div>
  </details>`;
}

function fundingAccordionHtml(fundingKey, clusterMap, typeKey) {
  const allRows = Object.values(clusterMap).flat();
  const stats = treeStats(allRows);
  const isGafan = (fundingKey === 'גפ״ן' || fundingKey === "גפ'ן" || fundingKey === 'גפן');
  const isReshut = fundingKey === 'רשות';
  const clusterLabel = isGafan ? 'בתי ספר' : isReshut ? 'רשויות' : 'גורם ריכוז';
  const clusterCount = Object.keys(clusterMap).length;
  const summaryLine = `${stats.total} פעילויות · ${clusterCount} ${clusterLabel} · ${money(stats.totalPrice)}`;
  const clustersHtml = Object.entries(clusterMap)
    .sort(([a], [b]) => a.localeCompare(b, 'he'))
    .map(([clusterKey, rows]) => clusterAccordionHtml(clusterKey, rows, fundingKey, typeKey))
    .join('');
  return `<details class="ds-fin-acc ds-fin-acc--funding" data-fin-funding="${escapeHtml(fundingKey)}|${escapeHtml(typeKey)}">
    <summary class="ds-fin-acc__summary">
      <span class="ds-fin-acc__title">${escapeHtml(fundingKey)}</span>
      <span class="ds-fin-acc__meta">${escapeHtml(summaryLine)}</span>
    </summary>
    <div class="ds-fin-acc__body">${clustersHtml}</div>
  </details>`;
}

function programSummaryHtml(rows = []) {
  const byName = new Map();
  for (const row of rows) {
    const name = String(row.activity_name || '').trim() || 'ללא שם';
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(row);
  }
  if (!byName.size) return '';
  const sortedNames = [...byName.entries()].sort(([, a], [, b]) => b.length - a.length);
  const tableRows = sortedNames.map(([name, nameRows]) => {
    const stats = treeStats(nameRows);
    return `<tr>
      <td>${escapeHtml(name)}</td>
      <td style="text-align:center">${stats.total}</td>
      <td style="text-align:left">${stats.totalPrice ? escapeHtml(money(stats.totalPrice)) : '—'}</td>
      <td style="text-align:center">${stats.noPrice}</td>
      <td style="text-align:center">${stats.collected}</td>
      <td style="text-align:center">${stats.notCollected}</td>
      <td style="text-align:center">${stats.open} פתוחות / ${stats.closed} סגורות</td>
    </tr>`;
  }).join('');
  return `<details class="ds-fin-acc ds-fin-acc--programs">
    <summary class="ds-fin-acc__summary"><span class="ds-fin-acc__title">סיכום לפי שמות תוכניות</span></summary>
    <div class="ds-fin-acc__body">
      <table class="ds-fin-table" dir="rtl">
        <thead><tr>
          <th>שם פעילות / תוכנית</th>
          <th style="text-align:center">כמות</th>
          <th>סך מחיר</th>
          <th style="text-align:center">ללא מחיר</th>
          <th style="text-align:center">נגבו</th>
          <th style="text-align:center">לא נגבו</th>
          <th style="text-align:center">סטטוס</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  </details>`;
}

function activityTypeAccordionHtml(typeKey, typeLabel, fundingTree, allTypeRows) {
  const stats = treeStats(allTypeRows);
  const fundingsHtml = Object.entries(fundingTree)
    .sort(([a], [b]) => a.localeCompare(b, 'he'))
    .map(([fundingKey, clusterMap]) => fundingAccordionHtml(fundingKey, clusterMap, typeKey))
    .join('');
  const programsSummary = programSummaryHtml(allTypeRows);
  return `<details class="ds-fin-acc ds-fin-acc--type" data-fin-type="${escapeHtml(typeKey)}">
    <summary class="ds-fin-acc__summary ds-fin-acc__summary--type">
      <span class="ds-fin-acc__title ds-fin-acc__title--type">${escapeHtml(typeLabel)}</span>
      <span class="ds-fin-acc__meta">${stats.total} פעילויות · ${money(stats.totalPrice)}</span>
    </summary>
    <div class="ds-fin-acc__body">
      ${kpiRow(stats)}
      ${programsSummary}
      ${fundingsHtml}
    </div>
  </details>`;
}

function financeSummaryKpis(rows = []) {
  const stats = treeStats(rows);
  const exceptionCount = rows.reduce((sum, row) => sum + financeExceptions(row).length, 0);
  return `<div class="ds-fin-top-kpis">
    ${kpiBox('סה״כ פעילויות', stats.total)}
    ${kpiBox('נגבו', stats.collected, money(stats.collectedPrice))}
    ${kpiBox('לא נגבו', stats.notCollected)}
    ${kpiBox('ללא מחיר', stats.noPrice)}
    ${kpiBox('פתוחות', stats.open)}
    ${kpiBox('סגורות', stats.closed)}
    ${kpiBox('חריגות', exceptionCount)}
  </div>`;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export const financeScreen = {
  load: ({ api }) => api.allActivities(),

  render(data, { state } = {}) {
    if (!canAccessFinance(state?.user)) {
      return dsScreenStack(`${dsPageHeader('כספים', 'גישה מוגבלת')} ${dsEmptyState('אין הרשאה לצפייה בעמוד כספים.')}`);
    }

    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const tree = buildFinanceTree(allRows);
    const stats = treeStats(allRows);
    void stats;

    const typeAccordions = FINANCE_ACTIVITY_TYPES.map(({ key, label }) => {
      const fundingTree = tree[key];
      if (!fundingTree) return '';
      const allTypeRows = Object.values(fundingTree).flatMap((cm) => Object.values(cm)).flat();
      return activityTypeAccordionHtml(key, label, fundingTree, allTypeRows);
    }).join('');

    // Other types not in the main list
    const knownTypes = new Set(FINANCE_ACTIVITY_TYPES.map((t) => t.key));
    const otherTypeRows = allRows.filter((r) => !knownTypes.has(normalizeFinanceActivityType(r.activity_type)));
    const otherSection = otherTypeRows.length > 0
      ? activityTypeAccordionHtml('other', 'אחר', buildFinanceTree(otherTypeRows)['other'] || {}, otherTypeRows)
      : '';

    const body = `
      ${financeSummaryKpis(allRows)}
      <div class="ds-fin-accordions" dir="rtl">
        ${typeAccordions}
        ${otherSection}
      </div>`;

    return dsScreenStack(`
      ${dsPageHeader('כספים', `בקרה עסקית · ${allRows.length} פעילויות`)}
      ${dsCard({ body, padded: true })}
    `);
  },

  bind({ root, data, state, api, rerender }) {
    if (!canAccessFinance(state?.user)) return;
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const rowById = new Map(allRows.map((r) => [activityRowId(r), r]));

    // Toggle collection status
    root.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-fin-toggle-collect]');
      if (!btn) return;
      const rowId = String(btn.dataset.finToggleCollect || '');
      const row = rowById.get(rowId);
      if (!row) return;
      btn.disabled = true;
      const newCollected = !isCollected(row);
      const newValue = newCollected ? 'yes' : 'no';
      try {
        await api.saveActivity({
          source_row_id: rowId,
          source_sheet: 'activities',
          changes: { payment_collected: newValue }
        });
        row.payment_collected = newValue;
        rerender?.();
      } catch (err) {
        console.error('[finance] toggle collect failed', err);
      } finally {
        btn.disabled = false;
      }
    });
  }
};

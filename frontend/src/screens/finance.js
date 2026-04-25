import { escapeHtml } from './shared/html.js';
import {
  hebrewColumn,
  hebrewFinanceStatus,
  financeStatusVariant,
  translateApiErrorForUser
} from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState,
  dsInteractiveCard,
  dsStatusChip,
  dsKpiGrid
} from './shared/layout.js';
import { isNarrowViewport } from './shared/responsive.js';
import { activityWorkDrawerHtml } from './shared/activity-detail-html.js';
import { bindActivityEditForm as bindActivityEditFormShared } from './shared/bind-activity-edit-form.js';
import { showToast } from './shared/toast.js';

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

/* ————————————————————————————————
   Filtering helpers
———————————————————————————————— */
function applySearch(rows, q) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return rows.filter(
    (r) =>
      String(r.activity_name || '').toLowerCase().includes(lq) ||
      String(r.RowID || '').toLowerCase().includes(lq) ||
      String(r.school || '').toLowerCase().includes(lq) ||
      String(r.activity_manager || '').toLowerCase().includes(lq) ||
      String(r.funding || '').toLowerCase().includes(lq) ||
      String(r.authority || '').toLowerCase().includes(lq) ||
      hebrewFinanceStatus(r.finance_status).toLowerCase().includes(lq)
  );
}

function applyMonthFilter(rows, ymStr, dateFrom, dateTo) {
  /* Custom date range takes precedence */
  if (!ymStr && (dateFrom || dateTo)) {
    return rows.filter((r) => {
      const d = String(r.end_date || '');
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  }
  /* No filter: show all */
  if (!ymStr) return rows;
  /* Month window: show selected month AND previous month together */
  const prevYm = prevMonth(ymStr);
  return rows.filter((r) => {
    const ym = String(r.end_date || '').slice(0, 7);
    return ym === ymStr || ym === prevYm;
  });
}

function applyTabFilter(rows, tab) {
  if (!tab || tab === 'active') {
    return rows.filter((r) => {
      const arch = String(r.is_archived || r.archive || '').toLowerCase();
      return arch !== 'yes' && arch !== 'true' && arch !== '1';
    });
  }
  if (tab === 'archive') {
    return rows.filter((r) => {
      const arch = String(r.is_archived || r.archive || '').toLowerCase();
      return arch === 'yes' || arch === 'true' || arch === '1';
    });
  }
  return rows;
}

/* Sort: open first → closed → other; within group by end_date asc */
function sortRows(rows) {
  const order = { open: 0, closed: 1 };
  return [...rows].sort((a, b) => {
    const aO = order[String(a.finance_status || '').toLowerCase()] ?? 2;
    const bO = order[String(b.finance_status || '').toLowerCase()] ?? 2;
    if (aO !== bO) return aO - bO;
    return String(a.end_date || '').localeCompare(String(b.end_date || ''));
  });
}

/* ————————————————————————————————
   Grouping: גפן funding → by school; else by funding
———————————————————————————————— */
function isGafenFunding(fundingVal) {
  const f = String(fundingVal || '').trim();
  return f === 'גפן';
}

function getGroupKey(row, groupingRule) {
  if (groupingRule === 'gafen_by_school_else_funding' && isGafenFunding(row.funding)) {
    return `בי"ס: ${String(row.school || '').trim() || 'לא מוגדר'}`;
  }
  return String(row.funding || '').trim() || 'לא מוגדר';
}

function getGroupSortKey(key) {
  if (key.startsWith('בי"ס:')) return 'ב' + key;
  return key;
}

/* ————————————————————————————————
   Formatting
———————————————————————————————— */
function formatILS(amount) {
  if (!amount && amount !== 0) return '—';
  return '₪' + Number(amount).toLocaleString('he-IL', { maximumFractionDigits: 0 });
}

function formatDateIL(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = String(isoDate).split('-');
  if (!y || !m || !d) return String(isoDate);
  return `${d}/${m}/${y}`;
}

/* Row amount: use actual Payment (collected amount) first;
   fall back to price × sessions (agreed/expected amount). */
function rowAmount(row) {
  const explicit = parseFloat(row.Payment || row.payment || row.payment_amount) || 0;
  if (explicit > 0) return explicit;
  const price = parseFloat(row.price) || 0;
  const sessions = parseFloat(row.sessions) || 0;
  return sessions > 0 ? price * sessions : price;
}

function ymToMonthLabel(ymStr) {
  if (!ymStr || !/^\d{4}-\d{2}$/.test(ymStr)) return '';
  const [y, m] = ymStr.split('-');
  return `${HE_MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

function prevMonth(ymStr) {
  const base = ymStr && /^\d{4}-\d{2}$/.test(ymStr) ? ymStr : currentYm();
  const [y, m] = base.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextMonth(ymStr) {
  const base = ymStr && /^\d{4}-\d{2}$/.test(ymStr) ? ymStr : currentYm();
  const [y, m] = base.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentYm() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/* ————————————————————————————————
   Manager breakdown (for summary card)
———————————————————————————————— */
function buildManagerBreakdown(rows) {
  const map = {};
  rows.forEach((r) => {
    const mgr = String(r.activity_manager || '').trim() || '—';
    if (!map[mgr]) map[mgr] = { total: 0, open: 0, closed: 0, other: 0, amountOpen: 0, amountClosed: 0, amountOther: 0, amountTotal: 0 };
    const amt = rowAmount(r);
    map[mgr].total += 1;
    map[mgr].amountTotal += amt;
    const st = String(r.finance_status || '').toLowerCase();
    if (st === 'open') { map[mgr].open += 1; map[mgr].amountOpen += amt; }
    else if (st === 'closed') { map[mgr].closed += 1; map[mgr].amountClosed += amt; }
    else { map[mgr].other += 1; map[mgr].amountOther += amt; }
  });
  return Object.entries(map).map(([mgr, counts]) => ({ mgr, ...counts })).sort((a, b) => b.total - a.total);
}

/* ————————————————————————————————
   Meetings date panel (Date1–Date35)
———————————————————————————————— */
function buildMeetingsDatesHtml(row) {
  const today = new Date().toISOString().slice(0, 10);
  const dates = [];
  for (let i = 1; i <= 35; i++) {
    const val = String(row[`Date${i}`] || '').trim();
    if (val) dates.push({ num: i, val });
  }

  const totalSessions = parseFloat(row.sessions) || 0;
  const recorded = dates.length;
  const pending = Math.max(0, Math.round(totalSessions) - recorded);

  if (recorded === 0 && pending === 0) return '';

  const recordedChips = dates.map(({ num, val }) => {
    const parts = val.split('/');
    const isoVal = parts.length === 3
      ? `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
      : val;
    const kind = isoVal < today ? 'past' : 'future';
    return `<span class="ds-date-chip ds-date-chip--${kind}" title="פגישה ${num}">${escapeHtml(val)}</span>`;
  }).join('');

  const pendingChips = pending > 0
    ? Array.from({ length: Math.min(pending, 10) }, (_, i) =>
        `<span class="ds-date-chip ds-date-chip--pending" title="פגישה ${recorded + i + 1} — טרם תוזמנה">—</span>`
      ).join('') + (pending > 10 ? `<span class="ds-muted" style="font-size:0.7rem;">ועוד ${pending - 10}</span>` : '')
    : '';

  const past = dates.filter(({ val }) => {
    const parts = val.split('/');
    const iso = parts.length === 3 ? `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}` : val;
    return iso < today;
  }).length;
  const future = recorded - past;

  return `<div class="ds-meetings-panel">
    <div class="ds-meetings-panel__summary">
      <span>פגישות (${recorded}${pending > 0 ? `/${Math.round(totalSessions)}` : ''})</span>
      <span class="ds-meetings-panel__counts">
        ${past > 0 ? `<span class="ds-date-count ds-date-count--past">${past} עברו</span>` : ''}
        ${future > 0 ? `<span class="ds-date-count ds-date-count--future">${future} עתידיות</span>` : ''}
        ${pending > 0 ? `<span class="ds-date-count ds-date-count--pending">${pending} ממתינות</span>` : ''}
      </span>
    </div>
    <div class="ds-meetings-panel__body">${recordedChips}${pendingChips}</div>
  </div>`;
}

/* ————————————————————————————————
   Dates-only expand row (beneath data row)
———————————————————————————————— */
function buildDatesExpandRowHtml(row, colCount) {
  const uid = escapeHtml(row.RowID);
  const meetingsHtml = buildMeetingsDatesHtml(row);
  if (!meetingsHtml) return '';
  return `<tr class="ds-finance-dates-row" data-dates-row="${uid}" style="display:none;">
    <td colspan="${colCount}" class="ds-finance-inline-edit-cell">
      ${meetingsHtml}
    </td>
  </tr>`;
}

/* ————————————————————————————————
   Activity active/ended detection
———————————————————————————————— */
function isActivityActive(row) {
  const arch = String(row.is_archived || row.archive || '').toLowerCase();
  if (arch === 'yes' || arch === 'true' || arch === '1') return false;
  if (row.end_date) {
    const today = new Date().toISOString().slice(0, 10);
    return String(row.end_date) >= today;
  }
  return true;
}

/* ————————————————————————————————
   Groups layout: build group structure
   A. גפן → by school+authority (flat)
   B. רשות → by authority → school
   C. other → by funding → school
———————————————————————————————— */
function buildGroupStructure(rows) {
  const groups = new Map();
  let idx = 0;

  sortRows(rows).forEach((row) => {
    const funding = String(row.funding || '').trim();
    const school = String(row.school || '').trim() || 'לא מוגדר';
    const authority = String(row.authority || '').trim() || '';

    if (isGafenFunding(funding)) {
      const key = `gafen::${school}::${authority}`;
      if (!groups.has(key)) {
        groups.set(key, { id: `fg-${idx++}`, label: school, sublabel: authority || null, type: 'gafen', funding, rows: [], subgroups: null });
      }
      groups.get(key).rows.push(row);
    } else if (funding === 'רשות') {
      const authLabel = authority || 'לא מוגדר';
      const key = `rasut::${authLabel}`;
      if (!groups.has(key)) {
        groups.set(key, { id: `fg-${idx++}`, label: authLabel, sublabel: null, type: 'authority', funding, rows: [], subgroups: new Map() });
      }
      const grp = groups.get(key);
      grp.rows.push(row);
      if (!grp.subgroups.has(school)) grp.subgroups.set(school, []);
      grp.subgroups.get(school).push(row);
    } else {
      const fundingLabel = funding || 'לא מוגדר';
      const key = `funding::${fundingLabel}`;
      if (!groups.has(key)) {
        groups.set(key, { id: `fg-${idx++}`, label: fundingLabel, sublabel: null, type: 'funding', funding: fundingLabel, rows: [], subgroups: new Map() });
      }
      const grp = groups.get(key);
      grp.rows.push(row);
      if (!grp.subgroups.has(school)) grp.subgroups.set(school, []);
      grp.subgroups.get(school).push(row);
    }
  });

  return groups;
}

/* Single activity row for the groups layout */
function buildActivityRowHtml(row, canEdit) {
  const uid = escapeHtml(row.RowID);
  const active = isActivityActive(row);

  const activityBadge = active
    ? `<span class="ds-fg-badge ds-fg-badge--active">פעיל</span>`
    : `<span class="ds-fg-badge ds-fg-badge--ended">הסתיים</span>`;

  const fstVal = String(row.finance_status || '').toLowerCase();
  const financeBadge = fstVal === 'open'
    ? `<span class="ds-fg-badge ds-fg-badge--open">פתוח</span>`
    : fstVal === 'closed'
      ? `<span class="ds-fg-badge ds-fg-badge--closed">סגור</span>`
      : `<span class="ds-fg-badge ds-fg-badge--no-status">ללא</span>`;

  const endDateHtml = row.end_date
    ? `<span class="ds-fg-activity__date">סיום: ${formatDateIL(row.end_date)}</span>`
    : '';

  const notesHtml = row.finance_notes
    ? `<div class="ds-fg-activity__notes">הערות כספים: ${escapeHtml(row.finance_notes)}</div>`
    : '';

  let editHtml = '';
  if (canEdit) {
    const statusOpts = ['', 'open', 'closed'].map((v) =>
      `<option value="${v}" ${String(row.finance_status || '') === v ? 'selected' : ''}>${v === '' ? '— ללא —' : hebrewFinanceStatus(v)}</option>`
    ).join('');
    editHtml = `<div class="ds-fg-activity__edit" data-fg-edit="${uid}" style="display:none;">
      <select class="ds-input ds-input--sm ds-finance-status-select" data-inline-status="${uid}">${statusOpts}</select>
      <input type="text" class="ds-input ds-input--sm ds-finance-notes-input" data-inline-notes="${uid}"
        value="${escapeHtml(String(row.finance_notes || ''))}" placeholder="הערות כספים..." />
      <button type="button" class="ds-btn ds-btn--sm ds-btn--primary ds-finance-save-btn" data-inline-save="${uid}">שמור</button>
      <span class="ds-finance-inline-status ds-muted" data-inline-msg="${uid}" role="status" aria-live="polite"></span>
    </div>`;
  }

  return `<div class="ds-fg-activity" data-row-id="${uid}">
    <div class="ds-fg-activity__main">
      <div class="ds-fg-activity__info">
        <span class="ds-fg-activity__name">${escapeHtml(row.activity_name || '—')}</span>
        ${endDateHtml}
      </div>
      <div class="ds-fg-activity__badges">
        ${activityBadge}
        ${financeBadge}
        ${canEdit ? `<button type="button" class="ds-btn ds-btn--ghost ds-btn--sm ds-fg-activity__edit-btn" data-fg-edit-toggle="${uid}" title="ערוך">✎</button>` : ''}
      </div>
    </div>
    ${notesHtml}
    ${editHtml}
  </div>`;
}

/* Main groups layout: replaces the table in the default view */
function buildFinanceGroupsLayout(rows, canEdit) {
  if (rows.length === 0) return dsEmptyState('לא נמצאו פעילויות');

  const groups = buildGroupStructure(rows);
  const sortedGroups = [...groups.values()].sort((a, b) => {
    const typeOrder = { gafen: 0, authority: 1, funding: 2 };
    const ta = typeOrder[a.type] ?? 3;
    const tb = typeOrder[b.type] ?? 3;
    if (ta !== tb) return ta - tb;
    return a.label.localeCompare(b.label, 'he');
  });

  const groupHtml = sortedGroups.map((grp) => {
    const gid = grp.id;
    const gTotal = grp.rows.reduce((s, r) => s + rowAmount(r), 0);
    const gOpen = grp.rows.filter((r) => String(r.finance_status || '').toLowerCase() === 'open').length;
    const gClosed = grp.rows.filter((r) => String(r.finance_status || '').toLowerCase() === 'closed').length;
    const gCount = grp.rows.length;

    const statusChipsHtml = [
      gOpen > 0 ? `<span class="ds-fg-chip ds-fg-chip--open">${gOpen} פתוח</span>` : '',
      gClosed > 0 ? `<span class="ds-fg-chip ds-fg-chip--closed">${gClosed} סגור</span>` : ''
    ].filter(Boolean).join('');

    const subtitleHtml = grp.sublabel
      ? `<span class="ds-fg-card__subtitle">${escapeHtml(grp.sublabel)}</span>`
      : '';

    const typeBadgeHtml = grp.type === 'gafen'
      ? `<span class="ds-fg-type-badge ds-fg-type-badge--gafen">גפ"ן</span>`
      : grp.type === 'authority'
        ? `<span class="ds-fg-type-badge ds-fg-type-badge--authority">רשות</span>`
        : `<span class="ds-fg-type-badge ds-fg-type-badge--funding">מימון</span>`;

    let bodyHtml;
    if (grp.subgroups === null) {
      bodyHtml = grp.rows.map((r) => buildActivityRowHtml(r, canEdit)).join('');
    } else {
      const schoolKeys = [...grp.subgroups.keys()].sort((a, b) => a.localeCompare(b, 'he'));
      bodyHtml = schoolKeys.map((school) => {
        const activitiesHtml = grp.subgroups.get(school).map((r) => buildActivityRowHtml(r, canEdit)).join('');
        return `<div class="ds-fg-subgroup">
          <div class="ds-fg-subgroup__head">${escapeHtml(school)}</div>
          <div class="ds-fg-subgroup__rows">${activitiesHtml}</div>
        </div>`;
      }).join('');
    }

    return `<div class="ds-fg-card ds-fg-card--${escapeHtml(grp.type)} is-open" data-fg-id="${escapeHtml(gid)}">
      <div class="ds-fg-card__head" data-fg-toggle="${escapeHtml(gid)}">
        <div class="ds-fg-card__title-area">
          ${typeBadgeHtml}
          <h3 class="ds-fg-card__title">${escapeHtml(grp.label)}</h3>
          ${subtitleHtml}
        </div>
        <div class="ds-fg-card__info">
          <span class="ds-fg-card__total">${formatILS(gTotal)}</span>
          <span class="ds-fg-card__count">${gCount} פעילויות</span>
          <span class="ds-fg-card__status-chips">${statusChipsHtml}</span>
        </div>
        <span class="ds-fg-card__chevron" aria-hidden="true">▾</span>
      </div>
      <div class="ds-fg-card__body" data-fg-body="${escapeHtml(gid)}">
        ${bodyHtml}
      </div>
    </div>`;
  }).join('');

  return `<div class="ds-fg-list">${groupHtml}</div>`;
}

/* ————————————————————————————————
   Grouped table rendering
———————————————————————————————— */
function buildGroupedTable(rows, canEdit, canView, tableSortCol, tableSortDir, groupingRule) {
  if (rows.length === 0) return dsEmptyState('לא נמצאו רשומות');

  const sorted = sortRows(rows);
  const groups = {};
  sorted.forEach((r) => {
    const key = getGroupKey(r, groupingRule);
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  const sortedKeys = Object.keys(groups).sort((a, b) =>
    getGroupSortKey(a).localeCompare(getGroupSortKey(b), 'he')
  );

  /* Columns: name | school | authority | manager | price | sessions | amount | end_date | funding | status | notes | actions
     Notes and actions are shown for all canView users (read-only for non-editors) */
  const hasNotesCol = canView;
  const hasActionsCol = canView;
  const BASE_COLS = 10 + (hasNotesCol ? 1 : 0) + (hasActionsCol ? 1 : 0);

  function tableTh(label, col, align) {
    const active = tableSortCol === col;
    const alignStyle = align ? `text-align:${align};` : '';
    const activeStyle = active ? 'text-decoration:underline dotted;' : '';
    const ind = active ? (tableSortDir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th data-table-sort-col="${escapeHtml(col)}" style="cursor:pointer;user-select:none;white-space:nowrap;${alignStyle}${activeStyle}">${escapeHtml(label)}${ind}</th>`;
  }

  const tbody = sortedKeys.map((key) => {
    const rawGRows = groups[key];
    const gRows = tableSortCol
      ? [...rawGRows].sort((a, b) => {
          let av, bv;
          if (tableSortCol === 'amount') {
            const calcAmt = (r) => { const p = parseFloat(r.price) || 0; const s = parseFloat(r.sessions) || 0; return s > 0 ? p * s : p; };
            av = calcAmt(a);
            bv = calcAmt(b);
            return tableSortDir === 'asc' ? av - bv : bv - av;
          } else if (tableSortCol === 'end_date') {
            av = String(a.end_date || '');
            bv = String(b.end_date || '');
            return tableSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
          } else {
            av = parseFloat(a[tableSortCol]) || 0;
            bv = parseFloat(b[tableSortCol]) || 0;
            return tableSortDir === 'asc' ? av - bv : bv - av;
          }
        })
      : rawGRows;
    const gOpen = gRows.filter((r) => String(r.finance_status || '').toLowerCase() === 'open').length;
    const gClosed = gRows.filter((r) => String(r.finance_status || '').toLowerCase() === 'closed').length;
    const gTotal = gRows.reduce((s, r) => {
      const p = parseFloat(r.price) || 0;
      const sess = parseFloat(r.sessions) || 0;
      return s + (sess > 0 ? p * sess : p);
    }, 0);

    const statusMini = [
      gOpen > 0 ? `<span class="ds-finance-group-chip ds-finance-group-chip--open">${gOpen} פתוח</span>` : '',
      gClosed > 0 ? `<span class="ds-finance-group-chip ds-finance-group-chip--closed">${gClosed} סגור</span>` : ''
    ].filter(Boolean).join('');

    const groupHeader = `<tr class="ds-finance-group-header">
      <td colspan="${BASE_COLS}">
        <span class="ds-finance-group-title">${escapeHtml(key)}</span>
        <span class="ds-finance-group-meta">${gRows.length} פעילויות · ${formatILS(gTotal)}</span>
        <span class="ds-finance-group-chips">${statusMini}</span>
      </td>
    </tr>`;

    const dataRows = gRows.map((row) => {
      const uid = escapeHtml(row.RowID);
      const hasDates = Array.from({ length: 35 }, (_, i) => row[`Date${i + 1}`]).some(Boolean);

      /* Status cell: editable select (admin/reviewer) or read-only chip (all) */
      const statusOpts = ['', 'open', 'closed'].map((v) =>
        `<option value="${v}" ${String(row.finance_status || '') === v ? 'selected' : ''}>${v === '' ? '— ללא —' : hebrewFinanceStatus(v)}</option>`
      ).join('');
      const statusCell = canEdit
        ? `<td class="ds-finance-status-cell"><select class="ds-input ds-input--sm ds-finance-status-select" data-inline-status="${uid}">${statusOpts}</select></td>`
        : `<td>${dsStatusChip(hebrewFinanceStatus(row.finance_status), financeStatusVariant(row.finance_status))}</td>`;

      /* Notes column: editable input (admin/reviewer) or read-only text (other canView) */
      let notesCell = '';
      if (hasNotesCol) {
        notesCell = canEdit
          ? `<td class="ds-finance-notes-cell"><input type="text" class="ds-input ds-input--sm ds-finance-notes-input" data-inline-notes="${uid}"
              value="${escapeHtml(String(row.finance_notes || ''))}" placeholder="הערות..." title="הערות כספים" /></td>`
          : `<td class="ds-finance-notes-cell ds-muted" style="font-size:0.8rem;">${escapeHtml(String(row.finance_notes || ''))}</td>`;
      }

      /* Actions column: save/archive for editors; dates/export for all canView */
      let actionsCell = '';
      if (hasActionsCol) {
        const viewActions = `${hasDates ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-dates-toggle="${uid}" title="תאריכי פגישות">תאריכים ▾</button>` : ''}
          <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-export-row="${uid}" title="ייצוא שורה">↓</button>`;
        actionsCell = canEdit
          ? `<td class="ds-finance-actions-cell">
              <div class="ds-finance-row-actions">
                <button type="button" class="ds-btn ds-btn--sm ds-btn--primary ds-finance-save-btn" data-inline-save="${uid}" title="שמור">💾</button>
                ${viewActions}
                <span class="ds-finance-inline-status ds-muted" data-inline-msg="${uid}" role="status" aria-live="polite"></span>
              </div>
            </td>`
          : `<td class="ds-finance-actions-cell"><div class="ds-finance-row-actions">${viewActions}</div></td>`;
      }

      const datesExpandRow = buildDatesExpandRowHtml(row, BASE_COLS);

      const price = parseFloat(row.price) || 0;
      const sessions = parseFloat(row.sessions) || 0;
      const calcAmount = sessions > 0 ? price * sessions : price;

      return `<tr class="ds-data-row" data-row-id="${uid}">
        <td>${escapeHtml(row.activity_name || '—')}</td>
        <td>${escapeHtml(row.school || '—')}</td>
        <td>${escapeHtml(row.authority || '—')}</td>
        <td>${escapeHtml(row.activity_manager || '—')}</td>
        <td style="text-align:left;">${price > 0 ? formatILS(price) : '—'}</td>
        <td style="text-align:center;">${sessions > 0 ? sessions : '—'}</td>
        <td style="text-align:left;">${calcAmount > 0 ? formatILS(calcAmount) : '—'}</td>
        <td>${row.end_date ? formatDateIL(row.end_date) : '—'}</td>
        <td>${escapeHtml(row.funding || '—')}</td>
        ${statusCell}
        ${notesCell}
        ${actionsCell}
      </tr>${datesExpandRow}`;
    }).join('');

    return groupHeader + dataRows;
  }).join('');

  const notesHead = hasNotesCol ? '<th>הערות</th>' : '';
  const actionsHead = hasActionsCol ? '<th class="ds-finance-actions-head">פעולות</th>' : '';

  return dsTableWrap(`<table class="ds-table ds-table--interactive ds-table--grouped">
    <thead><tr>
      <th>שם פעילות / קורס</th>
      <th>בית ספר</th>
      <th>רשות</th>
      <th>מנהל קורס</th>
      ${tableTh('מחיר', 'price', 'left')}
      ${tableTh('מפגשים', 'sessions', 'center')}
      ${tableTh('סכום', 'amount', 'left')}
      ${tableTh('תאריך סיום', 'end_date', '')}
      <th>מימון</th>
      <th>סטטוס</th>
      ${notesHead}
      ${actionsHead}
    </tr></thead>
    <tbody>${tbody}</tbody>
  </table>`);
}

/* ————————————————————————————————
   Cards view (mobile / toggle)
———————————————————————————————— */
function buildCardsView(rows, canEdit) {
  if (rows.length === 0) return dsEmptyState('לא נמצאו רשומות');
  const sorted = sortRows(rows);
  return `<div class="ds-finance-cards-list">${sorted.map((row) => {
    const uid = escapeHtml(row.RowID);
    const fst = String(row.finance_status || '').trim();
    const amt = rowAmount(row);
    const cardPrice = parseFloat(row.price) || 0;
    const cardSessions = parseFloat(row.sessions) || 0;
    const statusOpts = canEdit ? ['', 'open', 'closed'].map((v) =>
      `<option value="${v}" ${String(row.finance_status || '') === v ? 'selected' : ''}>${v === '' ? '— ללא —' : hebrewFinanceStatus(v)}</option>`
    ).join('') : '';
    const editDetails = canEdit ? `<details class="ds-finance-card-details">
      <summary class="ds-finance-card-details__trigger">עריכה ▾</summary>
      <div class="ds-finance-card-details__body" dir="rtl">
        <label class="ds-finance-inline-label">סטטוס
          <select class="ds-input ds-input--sm" data-inline-status="${uid}">${statusOpts}</select>
        </label>
        <label class="ds-finance-inline-label ds-finance-inline-label--notes">הערות
          <input type="text" class="ds-input ds-input--sm" data-inline-notes="${uid}"
            value="${escapeHtml(String(row.finance_notes || ''))}" placeholder="הערות..." />
        </label>
        <div style="display:flex;align-items:center;gap:6px;margin-top:6px;">
          <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-inline-save="${uid}">💾 שמור</button>
          <span class="ds-finance-inline-status ds-muted" data-inline-msg="${uid}" role="status" aria-live="polite"></span>
        </div>
      </div>
    </details>` : '';

    return `<div class="ds-finance-card" data-list-item data-filter="${escapeHtml(fst)}" data-row-id="${uid}" dir="rtl">
      <div class="ds-finance-card__header">
        <span class="ds-finance-card__name">${escapeHtml(row.activity_name || '—')}</span>
        ${dsStatusChip(hebrewFinanceStatus(row.finance_status), financeStatusVariant(row.finance_status))}
      </div>
      <div class="ds-finance-card__meta">
        ${row.school ? `<span>${escapeHtml(row.school)}</span>` : ''}
        ${row.authority ? `<span class="ds-muted">${escapeHtml(row.authority)}</span>` : ''}
        ${row.activity_manager ? `<span>${escapeHtml(row.activity_manager)}</span>` : ''}
        ${row.end_date ? `<span>סיום: ${formatDateIL(row.end_date)}</span>` : ''}
        ${row.funding ? `<span>מימון: ${escapeHtml(row.funding)}</span>` : ''}
        ${row.Payer ? `<span>משלם: ${escapeHtml(row.Payer)}</span>` : ''}
        ${cardPrice > 0 ? `<span>מחיר: ${formatILS(cardPrice)}</span>` : ''}
        ${cardSessions > 0 ? `<span>מפגשים: ${cardSessions}</span>` : ''}
        ${amt > 0 ? `<span class="ds-finance-card__amount">${formatILS(amt)}</span>` : ''}
      </div>
      ${row.finance_notes ? `<p class="ds-finance-card__notes ds-muted">${escapeHtml(row.finance_notes)}</p>` : ''}
      ${editDetails}
    </div>`;
  }).join('')}</div>`;
}

/* ————————————————————————————————
   Excel export (.xls HTML table format, RTL)
———————————————————————————————— */
function exportToExcel(rows, label, periodLabel, filterLabel) {
  const cols = ['RowID', 'activity_name', 'school', 'authority', 'activity_manager', 'funding', 'Payer', 'price', 'sessions', 'Payment', 'finance_status', 'finance_notes', 'start_date', 'end_date', 'status'];
  const headers = cols.map((c) => hebrewColumn(c) || c);

  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* Self-documenting header rows: period + active filters */
  const metaRows = [];
  if (periodLabel) {
    const filterNote = filterLabel ? ` · ${filterLabel}` : '';
    metaRows.push(`<tr><td colspan="${cols.length}" style="background:#e8eaf6;font-weight:bold;font-size:0.9rem;padding:6px 8px;border:1px solid #aab;">תקופה: ${esc(periodLabel)}${esc(filterNote)}</td></tr>`);
  }
  const exportDate = new Date().toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  metaRows.push(`<tr><td colspan="${cols.length}" style="background:#f5f5f5;font-size:0.8rem;color:#555;padding:4px 8px;border:1px solid #ccc;">יוצא בתאריך: ${esc(exportDate)} · ${esc(String(rows.length))} רשומות</td></tr>`);

  const headerRow = `<tr>${headers.map((h) => `<th style="background:#dde;">${esc(h)}</th>`).join('')}</tr>`;
  const dataRows = rows.map((row) => {
    const cells = cols.map((c) => {
      let v;
      if (c === 'Payment') v = String(rowAmount(row));
      else v = String(row[c] ?? '');
      if (c === 'finance_status') v = hebrewFinanceStatus(v);
      return `<td>${esc(v)}</td>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  });

  const html = `<html dir="rtl" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="UTF-8">
<style>td,th{border:1px solid #ccc;padding:4px 8px;}th{background:#cce;font-weight:bold;}table{border-collapse:collapse;direction:rtl;}</style>
</head><body><table>${metaRows.join('')}${headerRow}${dataRows.join('')}</table></body></html>`;

  const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `כספים${label ? '_' + label : ''}.xls`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}

/* ————————————————————————————————
   LocalStorage persistence
———————————————————————————————— */
const LS = {
  dateFrom: 'finance_date_from',
  dateTo: 'finance_date_to',
  search: 'finance_search',
  statusFilter: 'finance_status_filter',
  monthYm: 'finance_month_ym',
  tab: 'finance_tab',
  viewMode: 'finance_view_mode',
  mgrSortCol: 'finance_mgr_sort_col',
  mgrSortDir: 'finance_mgr_sort_dir',
  tableSortCol: 'finance_table_sort_col',
  tableSortDir: 'finance_table_sort_dir',
  userId: 'finance_user_id'
};

const LS_ALL_PREF_KEYS = [
  'finance_date_from', 'finance_date_to', 'finance_search', 'finance_status_filter',
  'finance_month_ym', 'finance_tab', 'finance_view_mode',
  'finance_mgr_sort_col', 'finance_mgr_sort_dir',
  'finance_table_sort_col', 'finance_table_sort_dir',
  'finance_user_id'
];

function clearFinanceStorage() {
  LS_ALL_PREF_KEYS.forEach((k) => localStorage.removeItem(k));
}

function resetFinanceStateKeys(state) {
  state.financeDateFrom = '';
  state.financeDateTo = '';
  state.financeSearch = '';
  state.financeStatusFilter = '';
  state.financeMonthYm = '';
  state.financeTab = '';
  state.financeViewMode = '';
  state.managerBreakdownSortCol = '';
  state.managerBreakdownSortDir = '';
  state.financeTableSortCol = '';
  state.financeTableSortDir = '';
}

function loadStateFromStorage(state) {
  /* Isolate preferences by user — clear both LS and in-memory finance state
     when a different user logs in, preventing cross-user preference leakage */
  const currentUserId = String(state?.user?.user_id || '');
  const storedUserId = localStorage.getItem(LS.userId) || '';
  if (currentUserId && storedUserId && currentUserId !== storedUserId) {
    clearFinanceStorage();
    resetFinanceStateKeys(state);
  }
  if (currentUserId) {
    localStorage.setItem(LS.userId, currentUserId);
  }

  const map = {
    financeDateFrom: LS.dateFrom,
    financeDateTo: LS.dateTo,
    financeSearch: LS.search,
    financeStatusFilter: LS.statusFilter,
    financeMonthYm: LS.monthYm,
    financeTab: LS.tab,
    financeViewMode: LS.viewMode,
    financeTableSortCol: LS.tableSortCol,
    financeTableSortDir: LS.tableSortDir,
    managerBreakdownSortCol: LS.mgrSortCol,
    managerBreakdownSortDir: LS.mgrSortDir
  };
  Object.entries(map).forEach(([stateKey, lsKey]) => {
    if (!state[stateKey]) {
      const v = localStorage.getItem(lsKey);
      if (v) state[stateKey] = v;
    }
  });
  /* Default: show open finance status (main purpose of finance screen) */
  if (!state.financeStatusFilter) {
    state.financeStatusFilter = 'open';
  }
  /* Default tab: all — show both active and archived activities */
  if (!state.financeTab) {
    state.financeTab = 'all';
  }
  /* No default month filter — show all activities */
}

function save(key, val) {
  val ? localStorage.setItem(key, val) : localStorage.removeItem(key);
}

/* ————————————————————————————————
   Screen export
———————————————————————————————— */
export const financeScreen = {
  load: ({ api, state }) => {
    loadStateFromStorage(state);
    return api.finance({
      date_from: state?.financeDateFrom || '',
      date_to: state?.financeDateTo || '',
      search: '',      /* search and status applied client-side for instant filtering */
      status: '',
      tab: 'all',      /* load both active and archived — finance screen shows all */
      month: state?.financeMonthYm || ''
    });
  },

  render(data, { state } = {}) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const narrow = isNarrowViewport();
    const searchQ = state?.financeSearch || '';
    const statusFilter = state?.financeStatusFilter || '';
    const dateFrom = state?.financeDateFrom || '';
    const dateTo = state?.financeDateTo || '';
    const activeTab = state?.financeTab || 'active';
    const monthYm = state?.financeMonthYm || '';
    const viewMode = state?.financeViewMode || (narrow ? 'cards' : 'groups');
    const canEdit = ['admin', 'operation_manager'].includes(state?.user?.display_role);
    const canView = state?.user?.display_role !== 'instructor';
    const isAdmin = state?.user?.display_role === 'admin';
    const groupingRule = state?.clientSettings?.finance_grouping_rule || data?.finance_grouping_rule || 'gafen_by_school_else_funding';

    /* All rows loaded with tab='all'; apply tab filter only if user explicitly chose active/archive */
    let baseRows = (activeTab && activeTab !== 'all')
      ? applyTabFilter(allRows, activeTab)
      : allRows;

    /* KPI window: month-filter only — independent of search/status chips */
    const kpiRows = applyMonthFilter(baseRows, monthYm, dateFrom, dateTo);
    const kpiOpen = kpiRows.filter((r) => String(r.finance_status || '').toLowerCase() === 'open');
    const kpiClosed = kpiRows.filter((r) => String(r.finance_status || '').toLowerCase() === 'closed');
    const amountOpen = kpiOpen.reduce((s, r) => s + rowAmount(r), 0);
    const amountClosed = kpiClosed.reduce((s, r) => s + rowAmount(r), 0);
    const amountTotal = kpiRows.reduce((s, r) => s + rowAmount(r), 0);

    const kpis = [
      { label: 'פעילויות בחלון', value: String(kpiRows.length) },
      { label: 'סל גבייה פתוח', value: formatILS(amountOpen), hint: `${kpiOpen.length} פעילויות` },
      { label: 'סל גבייה סגור', value: formatILS(amountClosed), hint: `${kpiClosed.length} פעילויות` },
      { label: 'סה"כ סל גבייה', value: formatILS(amountTotal) }
    ];

    /* Display rows: apply status filter and search client-side on top of the month window */
    let rows = kpiRows;
    if (statusFilter) {
      rows = rows.filter((r) => String(r.finance_status || '').toLowerCase() === statusFilter);
    }

    /* Status filter chips */
    const statuses = [...new Set(rows.map((r) => String(r.finance_status || '')).filter(Boolean))];
    const statusChips = [{ val: '', label: 'הכל' }, ...statuses.map((s) => ({ val: s, label: hebrewFinanceStatus(s) }))]
      .map((c) =>
        `<button type="button" class="ds-chip ${c.val === statusFilter ? 'is-active' : ''}" data-status-filter="${escapeHtml(c.val)}">${escapeHtml(c.label)}</button>`
      ).join('');

    /* Manager breakdown */
    const agg = data?.aggregates;
    const mgrSortCol = state?.managerBreakdownSortCol || 'total';
    const mgrSortDir = state?.managerBreakdownSortDir || 'desc';
    const rawMgr = agg?.byManager || buildManagerBreakdown(rows);
    const managerBreakdown = [...rawMgr].sort((a, b) => {
      const av = mgrSortCol === 'mgr' ? String(a.mgr || '') : Number(a[mgrSortCol]) || 0;
      const bv = mgrSortCol === 'mgr' ? String(b.mgr || '') : Number(b[mgrSortCol]) || 0;
      if (mgrSortCol === 'mgr') return mgrSortDir === 'asc' ? av.localeCompare(bv, 'he') : bv.localeCompare(av, 'he');
      return mgrSortDir === 'asc' ? av - bv : bv - av;
    });

    function mgrTh(label, col, center) {
      const active = mgrSortCol === col;
      const style = `cursor:pointer;user-select:none;white-space:nowrap;${center ? 'text-align:center;' : ''}${active ? 'text-decoration:underline dotted;' : ''}`;
      const ind = active ? (mgrSortDir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th data-mgr-sort-col="${escapeHtml(col)}" style="${style}">${escapeHtml(label)}${ind}</th>`;
    }

    const mgrTableRows = managerBreakdown.map((m) => `<tr>
      <td>${escapeHtml(m.mgr)}</td>
      <td style="text-align:center;">${m.total}</td>
      <td style="text-align:center;">${dsStatusChip(String(m.open), 'warning')}</td>
      <td style="text-align:center;">${formatILS(m.amountOpen)}</td>
      <td style="text-align:center;">${dsStatusChip(String(m.closed), 'success')}</td>
      <td style="text-align:center;">${formatILS(m.amountClosed)}</td>
      <td style="text-align:center;">${formatILS(m.amountTotal)}</td>
    </tr>`).join('');

    const managerTable = managerBreakdown.length === 0 ? '' : dsCard({
      title: 'פירוט לפי מנהל פעילות',
      badge: `${managerBreakdown.length} מנהלים`,
      body: dsTableWrap(`<table class="ds-table">
        <thead><tr>
          ${mgrTh('מנהל פעילות','mgr',false)}
          ${mgrTh('סה"כ','total',true)}
          ${mgrTh('פתוח','open',true)}
          ${mgrTh('סכום פתוח','amountOpen',true)}
          ${mgrTh('סגור','closed',true)}
          ${mgrTh('סכום סגור','amountClosed',true)}
          ${mgrTh('סה"כ סכום','amountTotal',true)}
        </tr></thead>
        <tbody>${mgrTableRows}</tbody>
      </table>`),
      padded: false
    });

    /* Tabs — show filter options for authorized users */
    const showArchiveTab = canEdit;
    const tabsHtml = showArchiveTab ? `<div class="ds-finance-tabs" dir="rtl">
      <button type="button" class="ds-finance-tab ${!activeTab || activeTab === 'all' ? 'is-active' : ''}" data-finance-tab="all">הכל</button>
      <button type="button" class="ds-finance-tab ${activeTab === 'active' ? 'is-active' : ''}" data-finance-tab="active">פעילויות בלבד</button>
      <button type="button" class="ds-finance-tab ${activeTab === 'archive' ? 'is-active' : ''}" data-finance-tab="archive">ארכיון בלבד</button>
    </div>` : '';

    /* Month nav — shows a 2-month window */
    const isCurrentMonth = monthYm === currentYm();
    const pairLabel = monthYm
      ? `${ymToMonthLabel(prevMonth(monthYm))} – ${ymToMonthLabel(monthYm)}`
      : 'כל התקופה';
    const monthNavHtml = `<div class="ds-month-nav" dir="rtl">
      <button type="button" class="ds-month-nav__btn" data-month-prev title="חלון קודם">◀</button>
      <span class="ds-month-nav__label">${pairLabel}</span>
      <button type="button" class="ds-month-nav__btn" data-month-next title="חלון הבא">▶</button>
      ${!isCurrentMonth ? `<button type="button" class="ds-btn ds-btn--ghost ds-btn--sm ds-month-nav__today-btn" data-month-today>היום</button>` : ''}
      ${monthYm ? `<button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-month-clear>כל התקופה</button>` : ''}
    </div>`;

    /* View toggle */
    const viewToggleHtml = `<div class="ds-view-toggle" dir="rtl">
      <button type="button" class="ds-view-toggle__btn ${viewMode === 'groups' ? 'is-active' : ''}" data-view-mode="groups" title="תצוגת ריכוזים">⊡ ריכוזים</button>
      <button type="button" class="ds-view-toggle__btn ${viewMode === 'table' ? 'is-active' : ''}" data-view-mode="table" title="תצוגת טבלה">☰ טבלה</button>
      <button type="button" class="ds-view-toggle__btn ${viewMode === 'cards' ? 'is-active' : ''}" data-view-mode="cards" title="תצוגת כרטיסיות">⊞ כרטיסיות</button>
    </div>`;

    /* Header subtitle */
    let headerSubtitle;
    if (monthYm) headerSubtitle = `מציג: ${ymToMonthLabel(prevMonth(monthYm))} – ${ymToMonthLabel(monthYm)}`;
    else if (dateFrom && dateTo) headerSubtitle = `מציג: ${formatDateIL(dateFrom)} – ${formatDateIL(dateTo)}`;
    else if (dateFrom) headerSubtitle = `מציג: מתאריך ${formatDateIL(dateFrom)}`;
    else if (dateTo) headerSubtitle = `מציג: עד ${formatDateIL(dateTo)}`;
    else headerSubtitle = 'מציג: כל התקופה';

    const exportBtn = `<button type="button" class="ds-btn ds-btn--sm" data-export-csv>ייצוא Excel</button>`;
    const refreshBtn = `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-finance-refresh title="טען נתוני כספים מחדש מהשרת">↻ רענון נתונים</button>`;
    const syncBtn = isAdmin ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-sync-finance title="סנכרון נתוני כספים">↻ סנכרון</button>` : '';

    const tableSortCol = state?.financeTableSortCol || '';
    const tableSortDir = state?.financeTableSortDir || 'asc';

    const dataBody = viewMode === 'table'
      ? buildGroupedTable(rows, canEdit, canView, tableSortCol, tableSortDir, groupingRule)
      : viewMode === 'cards'
        ? buildCardsView(rows, canEdit)
        : buildFinanceGroupsLayout(rows, canEdit);

    return dsScreenStack(`
      ${dsPageHeader('כספים', headerSubtitle)}
      ${tabsHtml}
      ${monthNavHtml}
      ${dsKpiGrid(kpis)}
      ${managerTable}
      <div class="ds-screen-top-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input id="finance-search" type="search" class="ds-search-input"
          placeholder="חיפוש..." value="${escapeHtml(searchQ)}" dir="rtl" style="flex:1;min-width:160px;" />
        ${viewToggleHtml}
        ${refreshBtn}
        ${exportBtn}
        ${syncBtn}
      </div>
      <div class="ds-filter-bar" role="toolbar" style="flex-wrap:wrap;gap:8px;">
        ${statusChips}
        <span style="display:flex;align-items:center;gap:4px;margin-right:8px;">
          <label for="finance-date-from" style="font-size:0.85rem;white-space:nowrap;">מתאריך</label>
          <input id="finance-date-from" type="date" class="ds-input" value="${escapeHtml(dateFrom)}" style="font-size:0.85rem;padding:4px 6px;" />
        </span>
        <span style="display:flex;align-items:center;gap:4px;">
          <label for="finance-date-to" style="font-size:0.85rem;white-space:nowrap;">עד תאריך</label>
          <input id="finance-date-to" type="date" class="ds-input" value="${escapeHtml(dateTo)}" style="font-size:0.85rem;padding:4px 6px;" />
        </span>
        ${(dateFrom || dateTo) ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-clear-dates>נקה תאריכים</button>` : ''}
        ${(dateFrom || dateTo || searchQ || statusFilter) ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-reset-filters style="border-color:var(--color-warning,#d97706);color:var(--color-warning,#d97706)">איפוס כל הסננים</button>` : ''}
      </div>
      <div data-finance-data-area>
        ${dsCard({
          title: 'ריכוז כספים',
          badge: `${rows.length} פעילויות`,
          body: dataBody,
          padded: rows.length === 0 || viewMode === 'cards' || viewMode === 'groups'
        })}
      </div>
    `);
  },

  bind({ root, data, ui, api, state, rerender, clearScreenDataCache = () => {} }) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const canEdit = ['admin', 'operation_manager'].includes(state?.user?.display_role);
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;

    function showDataAreaLoading() {
      const area = root.querySelector('[data-finance-data-area]');
      if (area) {
        area.innerHTML = '<div class="ds-loading-card" dir="rtl" role="status"><div class="ds-spinner" aria-hidden="true"></div><p>טוען נתונים...</p></div>';
      }
      root.querySelectorAll('.ds-kpi__value').forEach((el) => { el.style.opacity = '0.35'; });
    }

    /* Tabs */
    root.querySelectorAll('[data-finance-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.financeTab = btn.dataset.financeTab || 'active';
        save(LS.tab, state.financeTab);
        rerender();
      });
    });

    /* Month nav */
    root.querySelector('[data-month-prev]')?.addEventListener('click', () => {
      state.financeMonthYm = prevMonth(state.financeMonthYm);
      save(LS.monthYm, state.financeMonthYm);
      rerender();
    });
    root.querySelector('[data-month-next]')?.addEventListener('click', () => {
      state.financeMonthYm = nextMonth(state.financeMonthYm);
      save(LS.monthYm, state.financeMonthYm);
      rerender();
    });
    root.querySelector('[data-month-today]')?.addEventListener('click', () => {
      state.financeMonthYm = currentYm();
      save(LS.monthYm, state.financeMonthYm);
      rerender();
    });
    root.querySelector('[data-month-clear]')?.addEventListener('click', () => {
      state.financeMonthYm = '';
      save(LS.monthYm, '');
      rerender();
    });

    /* View toggle */
    root.querySelectorAll('[data-view-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.financeViewMode = btn.dataset.viewMode;
        save(LS.viewMode, state.financeViewMode);
        rerender();
      });
    });

    /* Finance group cards — expand / collapse */
    root.querySelectorAll('[data-fg-toggle]').forEach((head) => {
      head.addEventListener('click', (e) => {
        e.stopPropagation();
        const gid = head.dataset.fgToggle;
        const card = root.querySelector(`[data-fg-id="${gid}"]`);
        const body = root.querySelector(`[data-fg-body="${gid}"]`);
        if (!card || !body) return;
        const isOpen = !body.hidden;
        body.hidden = isOpen;
        card.classList.toggle('is-open', !isOpen);
      });
    });

    /* Finance group activity inline edit toggle */
    root.querySelectorAll('[data-fg-edit-toggle]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = btn.dataset.fgEditToggle;
        const editPanel = root.querySelector(`[data-fg-edit="${uid}"]`);
        if (!editPanel) return;
        editPanel.style.display = editPanel.style.display === 'none' ? '' : 'none';
      });
    });

    /* Search */
    root.querySelector('#finance-search')?.addEventListener('input', (ev) => {
      state.financeSearch = ev.target.value || '';
      save(LS.search, state.financeSearch);
      rerender();
    });

    /* Status filter chips */
    root.querySelectorAll('[data-status-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.financeStatusFilter = btn.dataset.statusFilter || '';
        save(LS.statusFilter, state.financeStatusFilter);
        rerender();
      });
    });

    /* Date filters */
    root.querySelector('#finance-date-from')?.addEventListener('change', (ev) => {
      state.financeDateFrom = ev.target.value || '';
      state.financeMonthYm = '';
      save(LS.dateFrom, state.financeDateFrom);
      save(LS.monthYm, '');
      showDataAreaLoading();
      clearScreenDataCache();
      rerender();
    });
    root.querySelector('#finance-date-to')?.addEventListener('change', (ev) => {
      state.financeDateTo = ev.target.value || '';
      state.financeMonthYm = '';
      save(LS.dateTo, state.financeDateTo);
      save(LS.monthYm, '');
      showDataAreaLoading();
      clearScreenDataCache();
      rerender();
    });
    root.querySelector('[data-clear-dates]')?.addEventListener('click', () => {
      state.financeDateFrom = '';
      state.financeDateTo = '';
      save(LS.dateFrom, '');
      save(LS.dateTo, '');
      showDataAreaLoading();
      clearScreenDataCache();
      rerender();
    });
    root.querySelector('[data-reset-filters]')?.addEventListener('click', () => {
      const hadDates = !!(state.financeDateFrom || state.financeDateTo);
      state.financeDateFrom = '';
      state.financeDateTo = '';
      state.financeSearch = '';
      state.financeStatusFilter = '';
      save(LS.dateFrom, '');
      save(LS.dateTo, '');
      save(LS.search, '');
      save(LS.statusFilter, '');
      if (hadDates) {
        showDataAreaLoading();
        clearScreenDataCache();
      }
      rerender();
    });

    /* Table sort (price / sessions column headers) */
    root.querySelectorAll('[data-table-sort-col]').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.dataset.tableSortCol;
        if (state.financeTableSortCol === col) {
          state.financeTableSortDir = state.financeTableSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.financeTableSortCol = col;
          state.financeTableSortDir = 'asc';
        }
        localStorage.setItem(LS.tableSortCol, state.financeTableSortCol);
        localStorage.setItem(LS.tableSortDir, state.financeTableSortDir);
        rerender();
      });
    });

    /* Manager sort — persist chosen column + direction to localStorage */
    root.querySelectorAll('[data-mgr-sort-col]').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.dataset.mgrSortCol;
        if (state.managerBreakdownSortCol === col) {
          state.managerBreakdownSortDir = state.managerBreakdownSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.managerBreakdownSortCol = col;
          state.managerBreakdownSortDir = 'desc';
        }
        localStorage.setItem(LS.mgrSortCol, state.managerBreakdownSortCol);
        localStorage.setItem(LS.mgrSortDir, state.managerBreakdownSortDir);
        rerender();
      });
    });

    /* CSV export */
    root.querySelector('[data-export-csv]')?.addEventListener('click', () => {
      const searchQ = state?.financeSearch || '';
      const statusFilter = state?.financeStatusFilter || '';
      const monthYm = state?.financeMonthYm || '';
      const dateFrom = state?.financeDateFrom || '';
      const dateTo = state?.financeDateTo || '';
      const activeTab = state?.financeTab || 'active';
      const isAdminExport = state?.user?.display_role === 'admin';
      let rows = isAdminExport ? applyTabFilter(allRows, activeTab) : allRows.filter((r) => {
        const arch = String(r.is_archived || r.archive || '').toLowerCase();
        return arch !== 'yes' && arch !== 'true' && arch !== '1';
      });
      /* When a custom date range is active it takes precedence over monthYm —
         pass empty string for ymStr so applyMonthFilter uses the date range. */
      const effectiveYm = (dateFrom || dateTo) ? '' : monthYm;
      rows = applyMonthFilter(rows, effectiveYm, dateFrom, dateTo);
      rows = applySearch(rows, searchQ);
      if (statusFilter) rows = rows.filter((r) => String(r.finance_status || '') === statusFilter);

      /* Build filename: include date range when a from/to filter is active;
         month selection alone does not change the base filename (כספים.xls) */
      let exportLabel = '';
      if (dateFrom || dateTo) {
        const fmt = (iso) => iso ? iso.split('-').reverse().join('-') : '';
        const parts = [fmt(dateFrom), fmt(dateTo)].filter(Boolean);
        exportLabel = parts.join('_');
      }

      /* Period label for embedded header row */
      let periodLabel = '';
      if (monthYm) {
        periodLabel = `${ymToMonthLabel(prevMonth(monthYm))} – ${ymToMonthLabel(monthYm)}`;
      } else if (dateFrom || dateTo) {
        const fromLabel = dateFrom ? formatDateIL(dateFrom) : 'תחילת התקופה';
        const toLabel = dateTo ? formatDateIL(dateTo) : 'סוף התקופה';
        periodLabel = `${fromLabel} – ${toLabel}`;
      } else {
        periodLabel = 'כל התקופה';
      }

      /* Filter label for embedded header row */
      const filterParts = [];
      if (statusFilter) filterParts.push(`סטטוס: ${hebrewFinanceStatus(statusFilter)}`);
      if (searchQ) filterParts.push(`חיפוש: "${searchQ}"`);
      if (activeTab === 'archive') filterParts.push('ארכיון');
      const filterLabel = filterParts.join(' · ');

      exportToExcel(rows, exportLabel, periodLabel, filterLabel);
    });

    /* Manual refresh button — fetches fresh data, updates cache, rerenders without clearing old view */
    root.querySelector('[data-finance-refresh]')?.addEventListener('click', async () => {
      const btn = root.querySelector('[data-finance-refresh]');
      if (btn) { btn.disabled = true; btn.textContent = '↻ מרענן...'; }
      try {
        const freshData = await api.finance({
          date_from: state?.financeDateFrom || '',
          date_to: state?.financeDateTo || '',
          search: state?.financeSearch || '',
          status: state?.financeStatusFilter || '',
          tab: state?.financeTab || 'active',
          month: state?.financeMonthYm || ''
        });
        const financeFilters = {
          dateFrom: state?.financeDateFrom || '',
          dateTo: state?.financeDateTo || '',
          search: state?.financeSearch || '',
          status: state?.financeStatusFilter || '',
          tab: state?.financeTab || 'active',
          ym: state?.financeMonthYm || ''
        };
        const financeKey = `finance:${JSON.stringify(financeFilters)}`;
        Object.keys(state.screenDataCache).forEach((k) => {
          if (k.startsWith('finance:')) delete state.screenDataCache[k];
        });
        state.screenDataCache[financeKey] = { data: freshData, t: Date.now() };
        rerender();
      } catch (err) {
        showToast(translateApiErrorForUser(err?.message), 'error');
        if (btn) { btn.disabled = false; btn.textContent = '↻ רענון נתונים'; }
      }
    });

    /* Sync button (admin/reviewer only — invalidates server cache and rerenders) */
    root.querySelector('[data-sync-finance]')?.addEventListener('click', async () => {
      const btn = root.querySelector('[data-sync-finance]');
      if (btn) { btn.disabled = true; btn.textContent = '↻ מסנכרן...'; }
      try {
        const res = await api.syncFinance();
        const ts = res?.timestamp ? new Date(res.timestamp).toLocaleTimeString('he-IL') : '';
        showToast(`הנתונים סונכרנו בהצלחה${ts ? ' — ' + ts : ''}`, 'success');
        clearScreenDataCache();
        rerender();
      } catch (err) {
        showToast(translateApiErrorForUser(err?.message), 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '↻ סנכרון'; }
      }
    });

    /* Dates-panel toggle */
    root.querySelectorAll('[data-dates-toggle]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = btn.dataset.datesToggle;
        const datesRow = root.querySelector(`[data-dates-row="${uid}"]`);
        if (!datesRow) return;
        const isOpen = datesRow.style.display !== 'none';
        datesRow.style.display = isOpen ? 'none' : '';
        btn.textContent = isOpen ? 'תאריכים ▾' : 'תאריכים ▴';
      });
    });

    /* Per-row CSV export */
    root.querySelectorAll('[data-export-row]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = btn.dataset.exportRow;
        const hit = allRows.find((r) => String(r.RowID) === String(uid));
        if (hit) exportToExcel([hit], String(hit.activity_name || hit.RowID).slice(0, 20));
      });
    });

    /* Inline save */
    root.querySelectorAll('[data-inline-save]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.inlineSave;
        const row = allRows.find((r) => String(r.RowID) === String(uid));
        if (!row) return;
        const statusEl = root.querySelector(`[data-inline-msg="${uid}"]`);
        const statusVal = root.querySelector(`[data-inline-status="${uid}"]`)?.value ?? '';
        const notesVal = root.querySelector(`[data-inline-notes="${uid}"]`)?.value ?? '';

        btn.disabled = true;
        if (statusEl) statusEl.textContent = '';
        try {
          /* Use dedicated saveFinanceRow for status/notes edits */
          const saveFn = typeof api.saveFinanceRow === 'function' ? api.saveFinanceRow : null;
          if (saveFn) {
            await saveFn({
              source_row_id: String(uid),
              source_sheet: row.source_sheet || '',
              finance_status: statusVal,
              finance_notes: notesVal
            });
          } else {
            await api.saveActivity({
              source_sheet: row.source_sheet || '',
              source_row_id: String(uid),
              changes: { finance_status: statusVal, finance_notes: notesVal }
            });
          }
          if (statusEl) statusEl.textContent = 'נשמר ✓';
          showToast('הנתונים נשמרו', 'success', 2000);
          clearScreenDataCache();
          setTimeout(() => rerender(), 600);
        } catch (err) {
          if (statusEl) statusEl.textContent = translateApiErrorForUser(err?.message);
        } finally {
          btn.disabled = false;
        }
      });
    });

    /* Row click → drawer */
    const bindFinanceEditForm = (contentRoot) =>
      bindActivityEditFormShared(contentRoot, { api, ui, clearScreenDataCache, rerender });
    const detailCache = new Map();
    const loadingDetailMarkup = '<div class="ds-loading-card" dir="rtl"><p>טוען פירוט כספים…</p></div>';

    const openDrawerWithRow = (hit) => {
      const meetingsHtml = buildMeetingsDatesHtml(hit);
      const showPrivateNote = state?.user?.display_role === 'operation_manager';
      const privateNote = showPrivateNote ? hit.private_note || '—' : null;
      const baseHtml = activityWorkDrawerHtml(hit, {
        privateNote,
        canEdit,
        canDirectEdit: canEdit,
        hideEmpIds,
        hideRowId,
        hideActivityNo,
        settings: state?.clientSettings || {}
      });
      /* Finance-specific header: status badges + finance notes prominently */
      const fstVal = String(hit.finance_status || '').toLowerCase();
      const fsBadge = fstVal === 'open'
        ? `<span class="ds-fg-badge ds-fg-badge--open">כספים: פתוח</span>`
        : fstVal === 'closed'
          ? `<span class="ds-fg-badge ds-fg-badge--closed">כספים: סגור</span>`
          : '';
      const actBadge = isActivityActive(hit)
        ? `<span class="ds-fg-badge ds-fg-badge--active">פעילות: פעיל</span>`
        : `<span class="ds-fg-badge ds-fg-badge--ended">פעילות: הסתיים</span>`;
      const financeHeader = `<div class="ds-fg-drawer-header" dir="rtl">
        <div class="ds-fg-drawer-header__badges">${actBadge} ${fsBadge}</div>
        ${hit.finance_notes ? `<div class="ds-fg-drawer-header__notes"><span class="ds-fg-drawer-header__notes-label">הערות כספים:</span> ${escapeHtml(hit.finance_notes)}</div>` : ''}
      </div>`;
      ui.openDrawer({
        title: `כספים · ${hit.activity_name || 'פעילות'}`,
        content: financeHeader + baseHtml + (meetingsHtml ? `<div style="padding:var(--ds-space-3)">${meetingsHtml}</div>` : ''),
        onOpen: canEdit ? bindFinanceEditForm : undefined
      });
    };

    const openDrawer = async (summaryRow) => {
      if (!summaryRow || !ui) return;
      ui.openDrawer({
        title: `כספים · ${summaryRow.activity_name || 'פעילות'}`,
        content: loadingDetailMarkup
      });
      const cacheKey = `${summaryRow.source_sheet || ''}|${summaryRow.RowID || ''}`;
      let row = detailCache.get(cacheKey);
      if (!row) {
        const rsp = await api.financeDetail(summaryRow.RowID, summaryRow.source_sheet);
        row = rsp?.row || summaryRow;
        detailCache.set(cacheKey, row);
      }
      openDrawerWithRow(row);
    };

    root.querySelectorAll('.ds-data-row').forEach((rowNode) => {
      rowNode.addEventListener('click', (e) => {
        if (e.target.closest('[data-inline-save],[data-dates-toggle],[data-export-row],[data-inline-status],[data-inline-notes]')) return;
        const rowId = rowNode.dataset.rowId;
        const hit = allRows.find((r) => String(r.RowID) === String(rowId));
        openDrawer(hit).catch(() => {});
      });
      rowNode.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); rowNode.click(); }
      });
    });

    /* Finance groups layout — activity row click → drawer */
    root.querySelectorAll('.ds-fg-activity').forEach((actRow) => {
      actRow.addEventListener('click', (e) => {
        if (e.target.closest('[data-fg-edit-toggle],[data-inline-save],[data-inline-status],[data-inline-notes],[data-fg-edit]')) return;
        const rowId = actRow.dataset.rowId;
        const hit = allRows.find((r) => String(r.RowID) === String(rowId));
        openDrawer(hit).catch(() => {});
      });
    });

    /* Finance card view — click header area to open drawer */
    root.querySelectorAll('.ds-finance-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('details,select,input,button')) return;
        const rowId = card.dataset.rowId;
        const hit = allRows.find((r) => String(r.RowID) === String(rowId));
        openDrawer(hit).catch(() => {});
      });
    });

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('finance:')) return;
      const rowId = action.slice('finance:'.length);
      const hit = allRows.find((r) => String(r.RowID) === String(rowId));
      openDrawer(hit).catch(() => {});
    });
  },

  onLeave({ state }) {
    state.financeSearch = '';
    state.financeStatusFilter = '';
    save(LS.search, '');
    save(LS.statusFilter, '');
  }
};

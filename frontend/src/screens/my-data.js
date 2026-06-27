import { escapeHtml } from './shared/html.js';
import { formatDateHe, formatTimeShort } from './shared/format-date.js';
import { dsPageHeader, dsCard, dsScreenStack, dsTableWrap, dsEmptyState } from './shared/layout.js';
import { activityDetailHtml, assignedToCurrentInstructor, bindActivityDetailActions, completionStatusFromUpload, contactGroupsByDateSchool, currentInstructorIds, groupForRow, isResponsibleForGroup, statusChipHtml } from './instructor-utils.js';

const VISIBLE_COLS = ['completion_approval_status', 'start_date', 'activity_hours', 'school', 'school_contact', 'grade', 'activity_name'];
const COL_LABELS = { start_date: 'תאריך', activity_hours: 'שעות', school: 'בית ספר', school_contact: 'איש קשר', grade: 'שכבה', activity_name: 'שם פעילות', completion_approval_status: 'סטטוס' };

function cellValue(row, column) {
  if (column === 'activity_hours') {
    const start = formatTimeShort(row?.start_time || row?.StartTime || '');
    const end = formatTimeShort(row?.end_time || row?.EndTime || '');
    return start && end ? `${start}–${end}` : (start || end || '—');
  }
  if (column === 'start_date') return formatDateHe(String(row?.start_date || row?.activity_date || '')) || '—';
  if (column === 'activity_name') return String(row?.activity_name || row?.activity || '').trim() || '—';
  if (column === 'school') return String(row?.school || '').trim() || '—';
  if (column === 'school_contact') {
    const name = String(row?.school_contact_name || '').trim() || 'לא עודכן';
    const phone = String(row?.school_contact_phone || '').trim() || 'לא עודכן';
    return `${name}\n${phone}`;
  }
  if (column === 'grade') return String(row?.grade || '').trim() || '—';
  if (column === 'completion_approval_status') return row?.completion_approval_status || 'טרם הועלה';
  return String(row?.[column] ?? '').trim();
}

function buildSearchHaystack(row) {
  return [
    formatDateHe(String(row?.start_date || row?.activity_date || '')) || '',
    row?.school || '', row?.authority || '', row?.grade || '',
    row?.activity_name || '', row?.activity_type || ''
  ].join(' ');
}

function rowMeta(row, userEmpId, teamMap, state) {
  const rawType = String(row.activity_type || '').trim();
  const status = completionStatusFromUpload(null, row);
  const rowDate = String(row?.start_date || row?.activity_date || '').slice(0, 10);
  const responsible = isResponsibleForGroup(groupForRow(row, teamMap), currentInstructorIds(state));
  const searchHay = buildSearchHaystack(row);
  return { rawType, status, rowDate, responsible, searchHay };
}

function schoolContactHtml(row) {
  const name = String(row?.school_contact_name || '').trim() || 'לא עודכן';
  const phone = String(row?.school_contact_phone || '').trim() || 'לא עודכן';
  return `<span class="instr-contact-box__title">איש קשר</span><strong>${escapeHtml(name)}</strong><strong>${escapeHtml(phone)}</strong>`;
}

function activityCardHtml(row, meta) {
  return `<article class="instr-activity-list-card" data-list-item data-search="${escapeHtml(meta.searchHay)}" data-filter="${escapeHtml(meta.rawType)}" data-status="${escapeHtml(meta.status.key)}" data-date="${escapeHtml(meta.rowDate)}" data-responsible="${meta.responsible ? 'yes' : 'no'}" data-row-id="${escapeHtml(row.RowID)}">
    <div class="instr-activity-list-card__status">${statusChipHtml(meta.status)}</div>
    <div class="instr-activity-list-card__fields">
      <div class="instr-activity-list-card__field"><span>תאריך</span><strong>${escapeHtml(cellValue(row, 'start_date'))}</strong></div>
      <div class="instr-activity-list-card__field"><span>שעות</span><strong>${escapeHtml(cellValue(row, 'activity_hours'))}</strong></div>
      <div class="instr-activity-list-card__field"><span>בית ספר</span><strong>${escapeHtml(cellValue(row, 'school'))}</strong></div>
      <div class="instr-activity-list-card__field instr-activity-list-card__field--contact">${schoolContactHtml(row)}</div>
      <div class="instr-activity-list-card__field"><span>שם פעילות</span><strong>${escapeHtml(cellValue(row, 'activity_name'))}</strong></div>
      <div class="instr-activity-list-card__field"><span>שכבה</span><strong>${escapeHtml(cellValue(row, 'grade'))}</strong></div>
    </div>
    <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost instr-row-action-btn" data-row-detail>פירוט</button>
  </article>`;
}

export const myDataScreen = {
  load: ({ api }) => api.myData(),
  render(data, { state } = {}) {
    const userEmpId = String(state?.user?.emp_id || state?.user?.employee_id || '').trim();
    const rowsAll = Array.isArray(data?.rows) ? data.rows : [];
    const rows = rowsAll.filter((row) => assignedToCurrentInstructor(row, currentInstructorIds(state)));
    const teamMap = contactGroupsByDateSchool(data?.teamGroups || []);
    const preparedRows = rows.map((row) => {
      const isPrimary = userEmpId && String(row?.emp_id || '').trim() === userEmpId;
      const peer = isPrimary ? String(row?.instructor_name_2 || '').trim() : String(row?.instructor_name || '').trim();
      return { ...row, peer_instructor: peer || 'אין מדריך נוסף' };
    });

    const body = preparedRows.map((row) => {
      const meta = rowMeta(row, userEmpId, teamMap, state);
      const cells = VISIBLE_COLS.map((col) => {
        if (col === 'completion_approval_status') return `<td class="instr-col-status">${statusChipHtml(meta.status)}</td>`;
        if (col === 'school_contact') return `<td class="instr-col-school-contact"><div class="instr-table-contact"><strong>${escapeHtml(String(row?.school_contact_name || '').trim() || 'לא עודכן')}</strong><span>${escapeHtml(String(row?.school_contact_phone || '').trim() || 'לא עודכן')}</span></div></td>`;
        return `<td class="instr-col-${col.replace(/_/g, '-')}">${escapeHtml(cellValue(row, col))}</td>`;
      }).join('');
      return `<tr class="ds-data-row instr-table-row" data-list-item data-search="${escapeHtml(meta.searchHay)}" data-filter="${escapeHtml(meta.rawType)}" data-status="${escapeHtml(meta.status.key)}" data-date="${escapeHtml(meta.rowDate)}" data-responsible="${meta.responsible ? 'yes' : 'no'}" data-row-id="${escapeHtml(row.RowID)}" role="button" tabindex="0">${cells}<td class="instr-col-action"><div class="instr-row-actions"><button type="button" class="ds-btn ds-btn--xs ds-btn--ghost instr-row-action-btn" data-row-detail>פירוט</button></div></td></tr>`;
    }).join('');

    const cards = preparedRows.map((row) => activityCardHtml(row, rowMeta(row, userEmpId, teamMap, state))).join('');

    const thead = `<thead><tr>${VISIBLE_COLS.map((col) => `<th class="instr-col-${col.replace(/_/g, '-')}">${escapeHtml(COL_LABELS[col] || col)}</th>`).join('')}<th class="instr-col-action">פעולה</th></tr></thead>`;

    const listBlock = preparedRows.length === 0
      ? dsEmptyState('אין פעילויות להצגה')
      : `<div class="instr-list-dual"><div class="instr-list-desktop activities-table-wrapper">${dsTableWrap(`<table class="ds-table ds-table--interactive ds-table--instr-list"><colgroup><col class="instr-col-completion-approval-status"><col class="instr-col-start-date"><col class="instr-col-activity-hours"><col class="instr-col-school"><col class="instr-col-school-contact"><col class="instr-col-grade"><col class="instr-col-activity-name"><col class="instr-col-action"></colgroup>${thead}<tbody>${body}</tbody></table>`)}</div><div class="instr-list-mobile instr-activity-cards activities-mobile-cards">${cards}</div></div>`;

    return dsScreenStack(`
      <section class="instructor-area instructor-area--table">
        ${dsPageHeader('הפעילויות שלי', 'כל הפעילויות שמשויכות אליך')}
        <div class="instr-filter-bar">
          <input class="ds-input instr-filter-search" data-instr-search placeholder="חיפוש לפי בית ספר / פעילות / רשות">
          <input class="ds-input instr-filter-date" type="date" data-instr-date aria-label="תאריך פעילות">
          <select class="ds-input instr-filter-status" data-instr-status>
            <option value="">כל הסטטוסים</option>
            <option value="missing">טרם הועלה</option>
            <option value="uploaded">הועלה לבדיקה</option>
            <option value="approved">אושר</option>
            <option value="rejected">נדחה</option>
          </select>
          <label class="instr-check instr-filter-responsible"><input type="checkbox" data-instr-responsible> אני אחראי קשר</label>
          <div class="instr-filter-actions">
            <button type="button" class="ds-btn ds-btn--sm ds-btn--secondary instr-filter-btn" data-instr-today>היום</button>
            <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost instr-filter-btn" data-instr-clear>ניקוי</button>
          </div>
        </div>
        ${dsCard({ title: 'הפעילויות שלי', badge: String(preparedRows.length), body: listBlock, padded: preparedRows.length === 0 })}
      </section>
    `);
  },
  bind({ root, data, ui, state }) {
    const applyFilters = () => {
      const q = String(root.querySelector('[data-instr-search]')?.value || '').trim().toLowerCase();
      const selectedDate = String(root.querySelector('[data-instr-date]')?.value || '').trim();
      const st = String(root.querySelector('[data-instr-status]')?.value || '').trim();
      const resp = !!root.querySelector('[data-instr-responsible]')?.checked;
      root.querySelectorAll('[data-list-item]').forEach((tr) => {
        const ok = (!q || String(tr.dataset.search || '').toLowerCase().includes(q))
          && (!selectedDate || tr.dataset.date === selectedDate)
          && (!st || tr.dataset.status === st)
          && (!resp || tr.dataset.responsible === 'yes');
        tr.hidden = !ok;
      });
    };
    root.querySelectorAll('[data-instr-search],[data-instr-date],[data-instr-status],[data-instr-responsible]').forEach((el) => el.addEventListener('input', applyFilters));
    root.querySelector('[data-instr-today]')?.addEventListener('click', () => {
      const dateInput = root.querySelector('[data-instr-date]');
      if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
      applyFilters();
    });
    root.querySelector('[data-instr-clear]')?.addEventListener('click', () => {
      const dateInput = root.querySelector('[data-instr-date]');
      if (dateInput) dateInput.value = '';
      applyFilters();
    });

    const rows = (Array.isArray(data?.rows) ? data.rows : []).filter((row) => assignedToCurrentInstructor(row, currentInstructorIds(state)));
    const teamMap = contactGroupsByDateSchool(data?.teamGroups || []);
    const rowById = new Map(rows.map((row) => [String(row.RowID), row]));

    const openActivityDetail = (hit) => {
      if (!hit || !ui) return;
      try {
        ui.openDrawer({
          title: 'פירוט פעילות',
          content: activityDetailHtml(hit, { ids: currentInstructorIds(state), teamMap }),
          onOpen: (contentNode) => {
            bindActivityDetailActions(contentNode, { ui, row: hit, rows, allInstructorRows: rows, teamMap, state });
          }
        });
      } catch (err) {
        console.error('[myData] openActivityDetail error', err);
        alert('שגיאה בפתיחת פירוט הפעילות.');
      }
    };

    root.querySelectorAll('.instr-table-row, .instr-activity-list-card').forEach((rowNode) => {
      rowNode.addEventListener('click', (event) => {
        if (event.target.closest('[data-row-detail]')) return;
        const hit = rowById.get(String(rowNode.dataset.rowId));
        if (hit) openActivityDetail(hit);
      });
      rowNode.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); rowNode.click(); }
      });
      const detailBtn = rowNode.querySelector('[data-row-detail]');
      if (detailBtn) {
        detailBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          const hit = rowById.get(String(rowNode.dataset.rowId));
          if (hit) openActivityDetail(hit);
        });
      }
    });
  }
};

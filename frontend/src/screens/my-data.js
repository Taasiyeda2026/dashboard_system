import { escapeHtml } from './shared/html.js';
import { formatDateHe, formatTimeShort } from './shared/format-date.js';
import { hebrewActivityType } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsTableWrap, dsEmptyState } from './shared/layout.js';
import { activityDetailHtml, assignedToCurrentInstructor, bindActivityDetailActions, completionStatusFromUpload, contactGroupsByDateSchool, currentInstructorIds, currentInstructorName, groupForRow, isResponsibleForGroup, isoDate, statusChipHtml, text } from './instructor-utils.js';

const WEEKDAYS_HE = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'יום ש׳'];
function weekdayNameHe(value) {
  const s = String(value || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '' : (WEEKDAYS_HE[d.getDay()] || '');
}

const VISIBLE_COLS = ['start_date', 'activity_hours', 'school', 'grade', 'activity_name', 'completion_approval_status'];
const COL_LABELS = { start_date: 'תאריך', activity_hours: 'שעות', school: 'בית ספר', grade: 'שכבה', activity_name: 'שם פעילות', completion_approval_status: 'סטטוס' };

function cellValue(row, column) {
  if (column === 'activity_hours') {
    const start = formatTimeShort(row?.start_time || row?.StartTime || '');
    const end = formatTimeShort(row?.end_time || row?.EndTime || '');
    return start && end ? `${start}–${end}` : (start || end || '—');
  }
  if (column === 'start_date') return formatDateHe(String(row?.start_date || row?.activity_date || '')) || '—';
  if (column === 'activity_name') return String(row?.activity_name || row?.activity || '').trim() || '—';
  if (column === 'school') return String(row?.school || '').trim() || '—';
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
      const rawType = String(row.activity_type || '').trim();
      const status = completionStatusFromUpload(null, row);
      const rowMonth = String(row?.start_date || row?.activity_date || '').slice(0, 7);
      const responsible = isResponsibleForGroup(groupForRow(row, teamMap), currentInstructorIds(state));
      const searchHay = buildSearchHaystack(row);
      const cells = VISIBLE_COLS.map((col) => {
        if (col === 'completion_approval_status') return `<td class="instr-col-status">${statusChipHtml(status)}</td>`;
        return `<td class="instr-col-${col.replace(/_/g, '-')}">${escapeHtml(cellValue(row, col))}</td>`;
      }).join('');
      return `<tr class="ds-data-row instr-table-row" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(rawType)}" data-status="${escapeHtml(status.key)}" data-month="${escapeHtml(rowMonth)}" data-responsible="${responsible ? 'yes' : 'no'}" data-row-id="${escapeHtml(row.RowID)}" role="button" tabindex="0">${cells}<td class="instr-col-action"><button type="button" class="ds-btn ds-btn--xs ds-btn--ghost instr-row-detail-btn" data-row-detail>פירוט ›</button></td></tr>`;
    });

    const thead = `<thead><tr>${VISIBLE_COLS.map((col) => `<th class="instr-col-${col.replace(/_/g, '-')}">${escapeHtml(COL_LABELS[col] || col)}</th>`).join('')}<th class="instr-col-action"></th></tr></thead>`;

    const tableBlock = preparedRows.length === 0
      ? dsEmptyState('אין פעילויות להצגה')
      : dsTableWrap(`<table class="ds-table ds-table--interactive ds-table--instr-list"><colgroup><col class="instr-col-start-date"><col class="instr-col-activity-hours"><col class="instr-col-school"><col class="instr-col-grade"><col class="instr-col-activity-name"><col class="instr-col-completion-approval-status"><col class="instr-col-action"></colgroup>${thead}<tbody>${body.join('')}</tbody></table>`);

    return dsScreenStack(`
      <section class="instructor-area instructor-area--table">
        ${dsPageHeader('הפעילויות שלי', 'כל הפעילויות שמשויכות אליך')}
        <div class="instr-filter-bar">
          <input class="ds-input" data-instr-search placeholder="חיפוש לפי בית ספר / פעילות / רשות">
          <input class="ds-input" type="month" data-instr-month>
          <select class="ds-input" data-instr-status>
            <option value="">כל הסטטוסים</option>
            <option value="missing">טרם הועלה</option>
            <option value="uploaded">הועלה לבדיקה</option>
            <option value="approved">אושר</option>
            <option value="rejected">נדחה</option>
          </select>
          <label class="instr-check"><input type="checkbox" data-instr-responsible> אני אחראי קשר</label>
        </div>
        ${dsCard({ title: 'הפעילויות שלי', badge: String(preparedRows.length), body: tableBlock, padded: preparedRows.length === 0 })}
      </section>
    `);
  },
  bind({ root, data, ui, state }) {
    const applyFilters = () => {
      const q = String(root.querySelector('[data-instr-search]')?.value || '').trim().toLowerCase();
      const m = String(root.querySelector('[data-instr-month]')?.value || '').trim();
      const st = String(root.querySelector('[data-instr-status]')?.value || '').trim();
      const resp = !!root.querySelector('[data-instr-responsible]')?.checked;
      root.querySelectorAll('[data-list-item]').forEach((tr) => {
        const ok = (!q || String(tr.dataset.search || '').toLowerCase().includes(q))
          && (!m || tr.dataset.month === m)
          && (!st || tr.dataset.status === st)
          && (!resp || tr.dataset.responsible === 'yes');
        tr.hidden = !ok;
      });
    };
    root.querySelectorAll('[data-instr-search],[data-instr-month],[data-instr-status],[data-instr-responsible]').forEach((el) => el.addEventListener('input', applyFilters));

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

    root.querySelectorAll('.instr-table-row').forEach((rowNode) => {
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

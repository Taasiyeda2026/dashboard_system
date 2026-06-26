import { escapeHtml } from './shared/html.js';
import { formatDateHe, formatTimeShort } from './shared/format-date.js';
import { hebrewColumn, hebrewActivityType } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState
} from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';
import { activityDetailHtml, activityHours, assignedToCurrentInstructor, completionStatusFromUpload, contactGroupsByDateSchool, currentInstructorIds, groupForRow, isResponsibleForGroup, isoDate, statusChipHtml, text } from './instructor-utils.js';


const WEEKDAYS_HE = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'יום ש׳'];
function weekdayNameHe(value) {
  const s = String(value || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '' : (WEEKDAYS_HE[d.getDay()] || '');
}


function contactTeamGroupsHtml(groups = [], userEmpId = '') {
  const items = (Array.isArray(groups) ? groups : []).map((group) => {
    const instructors = (Array.isArray(group.instructors) ? group.instructors : []).map((i) => i.name || i.empId).filter(Boolean).join(', ') || '—';
    const isResponsible = userEmpId && String(group.responsibleEmpId || '').trim() === userEmpId;
    const message = isResponsible
      ? 'את/ה אחראי/ת ליצור קשר עם בית הספר ולעדכן את שאר הצוות.'
      : `אחראי הקשר הוא ${group.responsibleName || '—'} — יש לתאם דרכו ולא לפנות בנפרד לבית הספר.`;
    return `<li class="ds-contact-team-card"><strong>${escapeHtml(formatDateHe(group.activity_date) || group.activity_date || '')} · ${escapeHtml(group.school || '')}</strong><br><span>מי איתי היום: ${escapeHtml(instructors)}</span><br><span>${escapeHtml(message)}</span></li>`;
  }).join('');
  if (!items) return '';
  return dsCard({ title: 'מי איתי היום', body: `<ul class="ds-contact-team-list">${items}</ul>`, padded: true });
}

function displayCellValue(row, column) {
  if (column === 'activity_day') return weekdayNameHe(row?.start_date || row?.activity_date || '') || '—';
  if (column === 'activity_hours') {
    const start = formatTimeShort(row?.start_time || row?.StartTime || '');
    const end = formatTimeShort(row?.end_time || row?.EndTime || '');
    return start && end ? `${start}–${end}` : (start || end || '—');
  }
  if (column === 'participants_count') {
    const val = row?.participants_count;
    return val === null || val === undefined || String(val).trim() === '' ? '—' : String(val);
  }
  if (column === 'completion_approval_status') return row?.completion_approval_status || 'טרם הועלה';
  let val = row?.[column] ?? '';
  if (column === 'activity_type') val = hebrewActivityType(val);
  if (column === 'start_date' || column === 'end_date') val = formatDateHe(String(val || '')) || val;
  if (column === 'start_time' || column === 'end_time' || column === 'StartTime' || column === 'EndTime') val = formatTimeShort(val);
  if (column === 'peer_instructor') val = row?.peer_instructor || 'אין מדריך נוסף';
  return val;
}

export const myDataScreen = {
  load: ({ api }) => api.myData(),
  render(data, { state } = {}) {
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const userEmpId = String(state?.user?.emp_id || state?.user?.employee_id || '').trim();
    const rowsAll = Array.isArray(data?.rows) ? data.rows : [];
    const rows = rowsAll.filter((row) => {
      return assignedToCurrentInstructor(row, currentInstructorIds(state));
    });
    void hideRowId;
    const columns = ['start_date', 'activity_day', 'activity_hours', 'authority', 'school', 'grade', 'activity_name', 'participants_count', 'completion_approval_status'];
    const teamMap = contactGroupsByDateSchool(data?.teamGroups || []);
    const preparedRows = rows.map((row) => {
      const isPrimary = userEmpId && String(row?.emp_id || '').trim() === userEmpId;
      const peer = isPrimary ? String(row?.instructor_name_2 || '').trim() : String(row?.instructor_name || '').trim();
      return { ...row, peer_instructor: peer || 'אין מדריך נוסף' };
    });
    const typeFilters = [...new Set(preparedRows.map((r) => String(r.activity_type || '').trim()).filter(Boolean))].map((t) => ({
      value: t,
      label: hebrewActivityType(t)
    }));

    const body = preparedRows.map((row) => {
      const rawType = String(row.activity_type || '').trim();
      const status = completionStatusFromUpload(null, row);
      const rowMonth = String(row?.start_date || row?.activity_date || '').slice(0, 7);
      const responsible = isResponsibleForGroup(groupForRow(row, teamMap), currentInstructorIds(state));
      const searchHay = columns
        .map((column) => {
          const val = displayCellValue(row, column);
          return String(val);
        })
        .join(' ');
      return `
      <tr class="ds-data-row" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(rawType)}" data-status="${escapeHtml(status.key)}" data-month="${escapeHtml(rowMonth)}" data-responsible="${responsible ? 'yes' : 'no'}" data-row-id="${escapeHtml(row.RowID)}" role="button" tabindex="0">${columns
        .map((column) => {
          const val = displayCellValue(row, column);
          if (column === 'completion_approval_status') return `<td>${statusChipHtml(status)}</td>`;
          return `<td>${escapeHtml(val)}</td>`;
        })
        .join('')}</tr>
    `;
    });

    const tableBlock =
      preparedRows.length === 0
        ? dsEmptyState('אין פעילויות להצגה בתקופה שנבחרה')
        : dsTableWrap(`<table class="ds-table ds-table--interactive ds-table--ops">
            <thead><tr>${columns.map((column) => { const labels = { start_date: 'תאריך', activity_day: 'יום', activity_hours: 'שעות', authority: 'רשות', school: 'בית ספר', grade: 'שכבה', activity_name: 'שם פעילות', participants_count: 'משתתפים', completion_approval_status: 'סטטוס' }; return `<th data-col="${escapeHtml(column)}">${escapeHtml(labels[column] || hebrewColumn(column))}</th>`; }).join('')}</tr></thead>
            <tbody>${body.join('')}</tbody>
          </table>`);

    return dsScreenStack(`
      <section class="instructor-area instructor-area--table">${dsPageHeader('הפעילויות שלי', 'כל הפעילויות שמשויכות אליך')}
      ${contactTeamGroupsHtml(data?.teamGroups || [], userEmpId)}
      ${preparedRows.length ? dsPageListToolsBar({ searchPlaceholder: 'חיפוש בפעילויות שלי…', filterLabel: 'סוג פעילות', filters: typeFilters }) : ''}
      <div class="instr-filter-bar"><input class="ds-input" data-instr-search placeholder="חיפוש לפי בית ספר / פעילות / רשות"><input class="ds-input" type="month" data-instr-month><select class="ds-input" data-instr-status><option value="">כל הסטטוסים</option><option value="missing">טרם הועלה</option><option value="uploaded">הועלה לבדיקה</option><option value="approved">אושר</option><option value="rejected">נדחה</option></select><label class="instr-check"><input type="checkbox" data-instr-responsible> אני אחראי קשר</label></div>${dsCard({
        title: 'הפעילויות שלי',
        body: tableBlock,
        padded: preparedRows.length === 0
      })}</section>
    `);
  },
  bind({ root, data, ui, state, rerender, clearScreenDataCache }) {
    bindPageListTools(root);
    const applyInstructorFilters = () => {
      const q = String(root.querySelector('[data-instr-search]')?.value || '').trim().toLowerCase();
      const m = String(root.querySelector('[data-instr-month]')?.value || '').trim();
      const st = String(root.querySelector('[data-instr-status]')?.value || '').trim();
      const resp = !!root.querySelector('[data-instr-responsible]')?.checked;
      root.querySelectorAll('[data-list-item]').forEach((tr) => {
        const ok = (!q || String(tr.dataset.search || '').toLowerCase().includes(q)) && (!m || tr.dataset.month === m) && (!st || tr.dataset.status === st) && (!resp || tr.dataset.responsible === 'yes');
        tr.hidden = !ok;
      });
    };
    root.querySelectorAll('[data-instr-search],[data-instr-month],[data-instr-status],[data-instr-responsible]').forEach((el) => el.addEventListener('input', applyInstructorFilters));
    const userEmpId = String(state?.user?.emp_id || state?.user?.employee_id || '').trim();
    const rows = (Array.isArray(data?.rows) ? data.rows : []).filter((row) => {
      if (!userEmpId) return true;
      return assignedToCurrentInstructor(row, currentInstructorIds(state));
    });
    const teamMap = contactGroupsByDateSchool(data?.teamGroups || []);
    const rowById = new Map(rows.map((row) => [String(row.RowID), row]));

    root.querySelectorAll('.ds-data-row').forEach((rowNode) => {
      rowNode.addEventListener('click', () => {
        const rowId = rowNode.dataset.rowId;
        const hit = rowById.get(String(rowId));
        if (!hit || !ui) return;
        ui.openDrawer({ title: 'פירוט פעילות', content: activityDetailHtml(hit, { ids: currentInstructorIds(state), teamMap }) });
      });
      rowNode.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          rowNode.click();
        }
      });
    });

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('mydata:')) return;
      const rowId = action.slice('mydata:'.length);
      const hit = rowById.get(String(rowId));
      if (!hit) return;
      ui.openDrawer({ title: 'פירוט פעילות', content: activityDetailHtml(hit, { ids: currentInstructorIds(state), teamMap }) });
    });
  }
};

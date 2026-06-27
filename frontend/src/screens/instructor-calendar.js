import { escapeHtml } from './shared/html.js';
import { formatDateHe } from './shared/format-date.js';
import { dsPageHeader, dsScreenStack } from './shared/layout.js';
import { activityDetailHtml, activityHours, assignedToCurrentInstructor, bindActivityDetailActions, completionStatusFromUpload, contactGroupsByDateSchool, currentInstructorIds, currentInstructorName, groupForRow, isResponsibleForGroup, isoDate, monthKey, parseLocalDate, participants, rowTitle, statusChipHtml, text, WEEKDAY_SHORT_HE, weekdayNameHe } from './instructor-utils.js';

let selectedMonth = new Date();
let renderRows = [];
let teamMap = new Map();
let currentIds = [];

function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1, 12); }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1, 12); }
function toIso(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function monthTitle(d) { return d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' }); }
function rowsForMonth(rows, d) { const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; return rows.filter((r) => monthKey(r.start_date || r.activity_date) === mk); }
function uploadMap(uploads = []) { const m = new Map(); (Array.isArray(uploads) ? uploads : []).forEach((u) => m.set(`${isoDate(u.activity_date)}|${String(u.school||'').trim()}`, u)); return m; }
function uploadFor(row, map) { return map.get(`${isoDate(row.start_date || row.activity_date)}|${String(row.school||'').trim()}`) || null; }

function dayCell(date, rows, uMap, inMonth) {
  const iso = toIso(date);
  const dayRows = rows.filter((r) => isoDate(r.start_date || r.activity_date) === iso);
  const tags = [];
  if (dayRows.length) tags.push(`<span class="instr-day-count">${dayRows.length} פעילויות</span>`);
  const statuses = new Set(dayRows.map((r) => completionStatusFromUpload(uploadFor(r, uMap), r).key));
  if (statuses.has('missing')) tags.push(statusChipHtml({ key: 'missing', label: 'חסר אישור' }));
  else if (statuses.has('rejected')) tags.push(statusChipHtml({ key: 'rejected', label: 'נדחה' }));
  else if (statuses.has('uploaded')) tags.push(statusChipHtml({ key: 'uploaded', label: 'הועלה' }));
  else if (statuses.has('approved')) tags.push(statusChipHtml({ key: 'approved', label: 'אושר' }));
  if (dayRows.some((r) => isResponsibleForGroup(groupForRow(r, teamMap), currentIds))) tags.push(statusChipHtml({ key: 'contact', label: 'אחראי קשר' }));
  return `<button type="button" class="instr-calendar-day ${inMonth ? '' : 'is-muted'} ${dayRows.length ? 'has-activity' : ''}" data-calendar-day="${escapeHtml(iso)}" ${dayRows.length ? '' : 'disabled'}><strong>${date.getDate()}</strong><div>${tags.slice(0,2).join('')}</div></button>`;
}

function calendarHtml(rows, uMap, d) {
  const first = monthStart(d);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const cur = new Date(start);
    cur.setDate(start.getDate() + i);
    cells.push(dayCell(cur, rows, uMap, cur.getMonth() === d.getMonth()));
  }
  return `<div class="instructor-calendar-inner"><section class="instr-calendar-card"><div class="instr-calendar-toolbar"><h2>${escapeHtml(monthTitle(d))}</h2><div><button class="ds-btn ds-btn--sm ds-btn--secondary" data-cal-prev>חודש קודם</button><button class="ds-btn ds-btn--sm ds-btn--ghost" data-cal-today>היום</button><button class="ds-btn ds-btn--sm ds-btn--secondary" data-cal-next>חודש הבא</button></div></div><div class="instr-weekdays">${WEEKDAY_SHORT_HE.map((w)=>`<span>${w}</span>`).join('')}</div><div class="instr-calendar-grid">${cells.join('')}</div></section></div>`;
}

function dayDrawerHtml(iso, rows, uMap) {
  const dayRows = rows
    .filter((r) => isoDate(r.start_date || r.activity_date) === iso)
    .sort((a, b) => text(a.start_time || a.StartTime).localeCompare(text(b.start_time || b.StartTime)));
  const responsible = dayRows.some((r) => isResponsibleForGroup(groupForRow(r, teamMap), currentIds));
  const groups = new Map();
  dayRows.forEach((r) => {
    const key = `${text(r.authority)} | ${text(r.school)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  const responsibleNote = responsible
    ? '<div class="instr-contact-note"><strong>אתה אחראי קשר ביום זה</strong><br>יש לוודא את קיום הפעילות מול איש הקשר ולעדכן את שאר הצוות.</div>'
    : '';
  const groupsHtml = [...groups.entries()].map(([k, items]) =>
    `<section><h3>${escapeHtml(k)}</h3>${items.map((r) =>
      `<article class="instr-activity-card"><div><strong>${escapeHtml(activityHours(r))} | ${escapeHtml(rowTitle(r))} | ${escapeHtml(text(r.grade)||'—')}</strong><small>${escapeHtml(text(r.school)||'')} · משתתפים: ${escapeHtml(participants(r))}</small>${statusChipHtml(completionStatusFromUpload(uploadFor(r, uMap), r))}</div><button class="ds-btn ds-btn--xs ds-btn--primary" data-activity-detail="${escapeHtml(String(r.RowID||''))}">פירוט</button></article>`
    ).join('')}</section>`
  ).join('');
  return `<div class="instr-day-drawer">${responsibleNote}${groupsHtml}</div>`;
}

export const instructorCalendarScreen = {
  load: async ({ api }) => {
    const [myData, uploads] = await Promise.all([
      api.myData(),
      api.completionApprovalUploads().catch(() => ({ rows: [] }))
    ]);
    return { rows: myData?.rows || [], teamGroups: myData?.teamGroups || [], uploads: uploads?.rows || [] };
  },
  render(data, { state } = {}) {
    currentIds = currentInstructorIds(state);
    teamMap = contactGroupsByDateSchool(data?.teamGroups || []);
    renderRows = (Array.isArray(data?.rows) ? data.rows : []).filter((r) => assignedToCurrentInstructor(r, currentIds));
    const uMap = uploadMap(data?.uploads || []);
    return dsScreenStack(
      `<section class="instructor-area">${dsPageHeader('לוח השנה שלי')}${calendarHtml(renderRows, uMap, selectedMonth)}</section>`
    );
  },
  bind({ root, data, ui, state, rerender }) {
    currentIds = currentInstructorIds(state);
    teamMap = contactGroupsByDateSchool(data?.teamGroups || []);
    const uMap = uploadMap(data?.uploads || []);

    root.querySelector('[data-cal-prev]')?.addEventListener('click', () => { selectedMonth = addMonths(selectedMonth, -1); rerender?.(); });
    root.querySelector('[data-cal-next]')?.addEventListener('click', () => { selectedMonth = addMonths(selectedMonth, 1); rerender?.(); });
    root.querySelector('[data-cal-today]')?.addEventListener('click', () => { selectedMonth = new Date(); rerender?.(); });

    const openActivityDetail = (row) => {
      if (!row || !ui) return;
      try {
        ui.openDrawer({
          title: 'פירוט פעילות',
          content: activityDetailHtml(row, { ids: currentIds, teamMap, upload: uploadFor(row, uMap) }),
          onOpen: (contentNode) => {
            bindActivityDetailActions(contentNode, { ui, row, state });
          }
        });
      } catch (err) {
        console.error('[instructorCalendar] openActivityDetail error', err);
        alert('שגיאה בפתיחת פירוט הפעילות.');
      }
    };

    root.querySelectorAll('[data-calendar-day]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const iso = btn.dataset.calendarDay;
        try {
          ui?.openDrawer({
            title: `פעילויות בתאריך ${formatDateHe(iso) || iso}`,
            subtitle: weekdayNameHe(iso),
            content: dayDrawerHtml(iso, renderRows, uMap),
            onOpen: (contentNode) => {
              contentNode.querySelectorAll('[data-activity-detail]').forEach((detailBtn) => {
                detailBtn.addEventListener('click', () => {
                  const row = renderRows.find((r) => String(r.RowID || '') === String(detailBtn.dataset.activityDetail));
                  if (row) openActivityDetail(row);
                });
              });
            }
          });
        } catch (err) {
          console.error('[instructorCalendar] openDrawer error', err);
        }
      });
    });
  }
};

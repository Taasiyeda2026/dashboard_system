import { escapeHtml } from './shared/html.js';
import { dsCard, dsScreenStack, dsEmptyState } from './shared/layout.js';
import { showToast } from './shared/toast.js';
import { activityWorkDrawerHtml, patchDrawerDatesSection } from './shared/activity-detail-html.js';
import {
  loadInstructorSchedulingData,
  saveInstructorSchedulingProfile,
  saveInstructorWeeklyRules,
  saveInstructorAvailabilityException,
  deleteInstructorAvailabilityException
} from './instructor-scheduling-data.js';
import {
  text, activeFlag, assigned, instructorCard, profileHtml, contactForm, constraintsForm, matchingForm
} from './instructor-workspace-ui.js';

const ACTIVE_FILTERS = [{ value: 'yes', label: 'פעילים' }, { value: '', label: 'הכול' }, { value: 'no', label: 'לא פעילים' }];
const ASSIGNMENT_FILTERS = [{ value: '', label: 'כל השיבוצים' }, { value: 'assigned', label: 'משובצים' }, { value: 'unassigned', label: 'לא משובצים' }];

export function buildInstructorActivityDetailsForMonth(allRows, { empId, instrName, targetYm } = {}) {
  const targets = [empId, instrName].map((value) => text(value).toLowerCase()).filter(Boolean);
  const seen = new Set();
  const items = [];
  (Array.isArray(allRows) ? allRows : []).forEach((row) => {
    if (['סגור', 'נמחק'].includes(text(row?.status))) return;
    const identities = [row?.emp_id, row?.emp_id_2, row?.instructor_name, row?.instructor_name_2].map((value) => text(value).toLowerCase()).filter(Boolean);
    if (!identities.some((value) => targets.includes(value))) return;
    let hasMeeting = false;
    let inMonth = false;
    for (let i = 1; i <= 35; i += 1) {
      const date = text(row?.[`date_${i}`] || row?.[`Date${i}`]);
      if (!date) continue;
      hasMeeting = true;
      if (!targetYm || date.startsWith(targetYm)) inMonth = true;
    }
    if (targetYm && hasMeeting && !inMonth) return;
    if (targetYm && !hasMeeting) {
      const start = text(row?.start_date).slice(0, 7) || text(row?.end_date).slice(0, 7);
      const end = text(row?.end_date).slice(0, 7) || text(row?.start_date).slice(0, 7);
      if (!start || targetYm < start || targetYm > end) return;
    }
    const id = text(row?.row_id || row?.RowID);
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    items.push({
      RowID: text(row?.RowID || row?.row_id || row?.source_row_id), row_id: text(row?.row_id || row?.RowID),
      source_row_id: text(row?.source_row_id || row?.RowID || row?.row_id), source_sheet: text(row?.source_sheet || row?.source_table || 'activities'),
      source_table: text(row?.source_table || 'activities'), activity_name: text(row?.activity_name) || '—', school: text(row?.school) || '—',
      authority: text(row?.authority) || '—', start_date: text(row?.start_date), end_date: text(row?.end_date || row?.date_end)
    });
  });
  return items;
}

function canEditScheduling(state) {
  return ['admin', 'operation_manager'].includes(text(state?.user?.role || state?.user?.display_role));
}

function mergeRows(base, contacts, scheduling) {
  const map = new Map();
  const ensure = (id, name = '') => {
    const key = text(id || name);
    if (!key) return null;
    if (!map.has(key)) map.set(key, { emp_id: key, full_name: text(name || key), programs_count: 0, one_day_count: 0, activity_type_counts: {}, activity_managers: [], authorities: [], schools: [], activity_names: [] });
    return map.get(key);
  };
  (base?.rows || []).forEach((row) => Object.assign(ensure(row.emp_id || row.full_name, row.full_name || row.instructor_name), row));
  (contacts?.rows || []).forEach((row) => Object.assign(ensure(row.emp_id || row.full_name, row.full_name), row));
  const profiles = new Map((scheduling?.profiles || []).map((row) => [text(row.emp_id), row]));
  return [...map.values()].map((row) => ({
    ...row,
    active: activeFlag(row.active),
    scheduling_profile: profiles.get(text(row.emp_id)) || null,
    availability_rules: (scheduling?.rules || []).filter((item) => text(item.emp_id) === text(row.emp_id)),
    availability_exceptions: (scheduling?.exceptions || []).filter((item) => text(item.emp_id) === text(row.emp_id))
  })).sort((a, b) => text(a.full_name).localeCompare(text(b.full_name), 'he'));
}

function activitiesFor(data, row) {
  return (data?.detail_rows || []).filter((activity) => {
    const targets = [row.emp_id, row.full_name].map((value) => text(value).toLowerCase());
    return [activity.emp_id, activity.emp_id_2, activity.instructor_name, activity.instructor_name_2].map((value) => text(value).toLowerCase()).some((value) => value && targets.includes(value));
  }).filter((activity) => !['סגור', 'נמחק', 'מבוטל'].includes(text(activity.status))).sort((a, b) => text(a.start_date).localeCompare(text(b.start_date)));
}

function searchText(row) {
  return [row.full_name, row.emp_id, row.mobile, row.email, row.address, row.employment_type, row.direct_manager, ...(row.activity_managers || []), ...(row.authorities || []), ...(row.schools || []), ...(row.activity_names || [])].map(text).join(' ').toLowerCase();
}

function chips(items, selected, attr) {
  return items.map((item) => `<button type="button" class="ds-chip${item.value === selected ? ' is-active' : ''}" ${attr}="${escapeHtml(item.value)}">${escapeHtml(item.label)}</button>`).join('');
}

function replaceScheduling(row, scheduling) {
  row.scheduling_profile = (scheduling.profiles || []).find((item) => text(item.emp_id) === text(row.emp_id)) || null;
  row.availability_rules = (scheduling.rules || []).filter((item) => text(item.emp_id) === text(row.emp_id));
  row.availability_exceptions = (scheduling.exceptions || []).filter((item) => text(item.emp_id) === text(row.emp_id));
}

export const instructorsScreen = {
  async load({ api }) {
    const [base, contacts, scheduling] = await Promise.all([api.instructors(), api.instructorContacts(), loadInstructorSchedulingData()]);
    return { ...base, rows: mergeRows(base, contacts, scheduling), scheduling };
  },

  render(data, { state } = {}) {
    state.instructorsWorkspace = state.instructorsWorkspace || { q: '', active: 'yes', assignment: '' };
    const filters = state.instructorsWorkspace;
    const query = text(filters.q).toLowerCase();
    const rows = (data?.rows || []).filter((row) => {
      if (filters.active && activeFlag(row.active) !== filters.active) return false;
      if (filters.assignment === 'assigned' && !assigned(row)) return false;
      if (filters.assignment === 'unassigned' && assigned(row)) return false;
      return !query || searchText(row).includes(query);
    });
    const missingAddress = (data?.rows || []).filter((row) => activeFlag(row.active) === 'yes' && !text(row.address)).length;
    const body = rows.length ? `<div class="instructors-workspace-grid">${rows.map(instructorCard).join('')}</div>` : dsEmptyState('לא נמצאו מדריכים בהתאם לסינון');
    return dsScreenStack(`<style>.instructors-workspace-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px}.instructors-workspace-grid>.ds-card:hover{border-color:#9db9d8!important;box-shadow:0 5px 16px rgba(15,23,42,.08)}@media(max-width:720px){.instructors-workspace-grid{grid-template-columns:1fr}}</style>
      <header class="ds-page-header"><div><h1 class="ds-page-header__title">מדריכים</h1><p class="ds-page-header__subtitle">פרטי מדריכים, פעילויות, זמינות ואילוצים במקום אחד</p></div>${canEditScheduling(state) ? '<button type="button" class="ds-btn ds-btn--primary" data-route="course-scheduling">שיבוץ קורסים</button>' : ''}</header>
      <div class="ds-screen-top-row" style="display:grid;gap:10px"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><input class="ds-search-input" data-instructors-search type="search" placeholder="חיפוש לפי שם, מזהה, רשות, בית ספר או מנהל…" value="${escapeHtml(filters.q || '')}" style="flex:1 1 330px;max-width:620px"><span class="ds-badge">${rows.length} מדריכים</span>${missingAddress ? `<span class="ds-status-chip ds-status-chip--warning">${missingAddress} פעילים ללא כתובת</span>` : ''}</div><div style="display:flex;gap:8px;flex-wrap:wrap"><span class="ds-muted">סטטוס:</span>${chips(ACTIVE_FILTERS, filters.active, 'data-instructors-active')}<span class="ds-muted" style="margin-inline-start:10px">שיבוץ:</span>${chips(ASSIGNMENT_FILTERS, filters.assignment, 'data-instructors-assignment')}</div></div>
      ${dsCard({ title: '', body, padded: rows.length === 0 })}<p class="ds-muted">ניהול האילוצים וחישוב הצעות השיבוץ פתוחים לאדמין ולתפעול בלבד.</p>`);
  },

  bind({ root, data, state, rerender, api, ui, clearScreenDataCache }) {
    const rows = data?.rows || [];
    const canEdit = canEditScheduling(state);
    state.instructorsWorkspace = state.instructorsWorkspace || { q: '', active: 'yes', assignment: '' };
    let timer;
    root.querySelector('[data-instructors-search]')?.addEventListener('input', (event) => { state.instructorsWorkspace.q = event.target.value || ''; clearTimeout(timer); timer = setTimeout(rerender, 180); });
    root.querySelectorAll('[data-instructors-active]').forEach((button) => button.addEventListener('click', () => { state.instructorsWorkspace.active = button.dataset.instructorsActive || ''; rerender(); }));
    root.querySelectorAll('[data-instructors-assignment]').forEach((button) => button.addEventListener('click', () => { state.instructorsWorkspace.assignment = button.dataset.instructorsAssignment || ''; rerender(); }));
    // Compatibility for older cached markup that still contains the former "אנשי קשר מדריכים" route button.
    root.querySelector('[data-route="instructor-contacts"]')?.addEventListener('click', (event) => {
      event.preventDefault();
      document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'instructor-contacts' } }));
    });

    const refresh = async (row) => { const scheduling = await loadInstructorSchedulingData(); data.scheduling = scheduling; replaceScheduling(row, scheduling); };
    const openActivity = async (activity) => {
      if (!ui) return;
      const id = activity.row_id || activity.RowID || activity.source_row_id;
      ui.closeDrawer?.();
      let row = activity;
      try { row = (await api.activityDetail(id, activity.source_sheet || 'activities'))?.row || activity; } catch (_) {}
      ui.openDrawer({ title: '', content: activityWorkDrawerHtml(row, { canEdit: false, canDirectEdit: false, canRequestEdit: false, showFinance: false, datesLoading: true, settings: state?.clientSettings || {} }) });
      api.activityDates(id, activity.source_sheet || 'activities').then((dates) => { const section = document.querySelector('[data-dates-section]'); if (section) patchDrawerDatesSection(section, dates); }).catch(() => {});
    };

    const openProfile = (row) => {
      if (!row || !ui) return;
      const activities = activitiesFor(data, row);
      const reopen = () => requestAnimationFrame(() => openProfile(row));
      ui.openDrawer({ title: row.full_name || row.emp_id, content: profileHtml(row, activities, canEdit, !!data?.scheduling?.loaded) });
      requestAnimationFrame(() => {
        document.querySelector('[data-edit-instructor-contact]')?.addEventListener('click', () => openContact(row, reopen));
        document.querySelector('[data-edit-instructor-constraints]')?.addEventListener('click', () => openConstraints(row, reopen));
        document.querySelector('[data-edit-instructor-matching]')?.addEventListener('click', () => openMatching(row, reopen));
        document.querySelectorAll('[data-open-instructor-activity]').forEach((button) => button.addEventListener('click', () => { const hit = activities.find((item) => text(item.row_id || item.RowID || item.source_row_id) === text(button.dataset.openInstructorActivity)); if (hit) openActivity(hit); }));
      });
    };

    const openMatching = (row, reopen) => {
      if (!canEdit || !data?.scheduling?.loaded) return;
      ui.closeDrawer?.();
      const uniqueOptions = (items) => [...new Map(items.filter(item => item.value).map(item => [item.value, item])).values()].sort((a,b) => a.label.localeCompare(b.label, 'he'));
      const activityRows = data?.detail_rows || [];
      const options = {
        courses: uniqueOptions(activityRows.filter(item => text(item.activity_type).toLowerCase() === 'course' || text(item.activity_type) === 'קורס').map(item => ({ value: text(item.activity_no || item.course_id || item.activity_name), label: `${text(item.activity_name)}${text(item.activity_no) ? ` · ${text(item.activity_no)}` : ''}` }))),
        authorities: uniqueOptions(activityRows.map(item => ({ value: text(item.authority_id || item.authority), label: text(item.authority) }))),
        schools: uniqueOptions(activityRows.map(item => ({ value: text(item.school_id || item.school), label: `${text(item.school)}${text(item.authority) ? ` · ${text(item.authority)}` : ''}` })))
      };
      ui.openModal({ title: `התאמה לשיבוץ — ${row.full_name || row.emp_id}`, content: matchingForm(row, options), actions: '<button type="button" class="ds-btn ds-btn--primary" data-save-instructor-matching>שמירה</button><button type="button" class="ds-btn" data-ui-close-modal>ביטול</button>' });
      const modal = document.querySelector('.ds-modal__content');
      const selected = name => [...(modal?.querySelector(`[name="${name}"]`)?.selectedOptions || [])].map(option => option.value).filter(Boolean);
      const save = modal?.querySelector('[data-save-instructor-matching]');
      save.onclick = async () => { try { save.disabled = true; await saveInstructorSchedulingProfile({ ...(row.scheduling_profile || {}), emp_id: row.emp_id, gender: modal.querySelector('[name="gender"]')?.value, instruction_languages: [...modal.querySelectorAll('[name="language"]:checked')].map(x=>x.value), education_levels: [...modal.querySelectorAll('[name="education"]:checked')].map(x=>x.value), course_restriction_mode: modal.querySelector('[name="course_restriction_mode"]')?.value, course_ids: selected('course_ids'), blocked_authorities: selected('blocked_authorities'), blocked_schools: selected('blocked_schools'), matching_note: modal.querySelector('[name="matching_note"]')?.value }); await refresh(row); ui.closeModal(); showToast('ההתאמה לשיבוץ נשמרה','success'); rerender(); reopen?.(); } catch(error) { modal.querySelector('[data-matching-status]').textContent = `שגיאה: ${error.message}`; } finally { save.disabled=false; } };
    };

    const openContact = (row, reopen) => {
      if (!canEdit) return;
      ui.closeDrawer?.();
      ui.openModal({ title: `עריכת פרטי מדריך — ${row.full_name || row.emp_id}`, content: contactForm(row), actions: '<button type="button" class="ds-btn ds-btn--primary" data-save-instructor-contact>שמירה</button><button type="button" class="ds-btn" data-ui-close-modal>ביטול</button>' });
      const button = document.querySelector('[data-save-instructor-contact]');
      button.onclick = async () => {
        const modal = document.querySelector('.ds-modal__content');
        const get = (name) => text(modal?.querySelector(`[name="${name}"]`)?.value);
        const payload = { emp_id: row.emp_id, full_name: get('full_name'), mobile: get('mobile'), email: get('email'), address: get('address'), employment_type: get('employment_type'), direct_manager: get('direct_manager') || 'ללא', active: get('active') || 'yes' };
        const status = modal?.querySelector('[data-instructor-form-status]');
        if (!payload.full_name) { status.textContent = 'יש להזין שם מלא.'; return; }
        try { button.disabled = true; await api.saveContact({ kind: 'instructor', row: payload }); Object.assign(row, payload); clearScreenDataCache?.(); ui.closeModal(); showToast('פרטי המדריך נשמרו', 'success', 1800); rerender(); reopen?.(); } catch (error) { status.textContent = `שגיאה: ${String(error?.message || '')}`; } finally { button.disabled = false; }
      };
    };

    const openConstraints = (row, reopen) => {
      if (!canEdit || !data?.scheduling?.loaded) return;
      ui.closeDrawer?.();
      ui.openModal({ title: `זמינות ואילוצים — ${row.full_name || row.emp_id}`, content: constraintsForm(row), actions: '<button type="button" class="ds-btn ds-btn--primary" data-save-instructor-constraints>שמירת זמינות</button><button type="button" class="ds-btn" data-ui-close-modal>סגירה</button>' });
      const modal = document.querySelector('.ds-modal__content');
      const status = modal?.querySelector('[data-constraints-status]');
      modal?.querySelector('[data-add-availability-exception]')?.addEventListener('click', async (event) => {
        const get = (name) => text(modal.querySelector(`[name="${name}"]`)?.value);
        try { event.currentTarget.disabled = true; await saveInstructorAvailabilityException({ emp_id: row.emp_id, exception_date: get('exception_date'), available: get('exception_available') === 'yes', start_time: get('exception_start_time'), end_time: get('exception_end_time'), notes: get('exception_notes') }); await refresh(row); ui.closeModal(); showToast('החריג נשמר', 'success', 1600); openConstraints(row, reopen); } catch (error) { status.textContent = `שגיאה: ${String(error?.message || '')}`; } finally { event.currentTarget.disabled = false; }
      });
      modal?.querySelectorAll('[data-delete-availability-exception]').forEach((button) => button.addEventListener('click', async () => { try { button.disabled = true; await deleteInstructorAvailabilityException(button.dataset.deleteAvailabilityException); await refresh(row); ui.closeModal(); showToast('החריג נמחק', 'success', 1400); openConstraints(row, reopen); } catch (error) { status.textContent = `שגיאה: ${String(error?.message || '')}`; button.disabled = false; } }));
      const save = modal?.querySelector('[data-save-instructor-constraints]');
      save.onclick = async () => {
        const get = (name) => modal.querySelector(`[name="${name}"]`);
        const rules = [...modal.querySelectorAll('[data-weekday-row]')].map((line) => ({ weekday: Number(line.dataset.weekdayRow), available: !!line.querySelector('[name="available"]')?.checked, start_time: line.querySelector('[name="start_time"]')?.value, end_time: line.querySelector('[name="end_time"]')?.value }));
        try { save.disabled = true; await Promise.all([saveInstructorSchedulingProfile({ emp_id: row.emp_id, default_start_time: get('default_start_time')?.value, default_end_time: get('default_end_time')?.value, friday_allowed: !!get('friday_allowed')?.checked, notes: get('notes')?.value }), saveInstructorWeeklyRules(row.emp_id, rules)]); await refresh(row); ui.closeModal(); showToast('הזמינות והאילוצים נשמרו', 'success', 1800); rerender(); reopen?.(); } catch (error) { status.textContent = `שגיאה: ${String(error?.message || '')}`; } finally { save.disabled = false; }
      };
    };

    root.querySelectorAll('[data-instructor-profile]').forEach((button) => button.addEventListener('click', async () => {
      const empId = text(button.dataset.instructorProfile || button.dataset.instructorCard);
      const row = rows.find((item) => text(item.emp_id) === empId);
      if (ui) { openProfile(row); return; }
      const month = text(state?._instrDateFilter?.from).slice(0, 7) || new Date().toISOString().slice(0, 7);
      state.instructorsActivityDetailsCache = state.instructorsActivityDetailsCache || {};
      const key = `${empId}:${month}`;
      if (Array.isArray(state.instructorsActivityDetailsCache[key])) return;
      const detailRows = Array.isArray(data?.detail_rows) ? data.detail_rows : null;
      const shared = state?.screenDataCache?.['activities:periods']?.data;
      const response = detailRows ? { rows: detailRows } : (shared || await api.activities({ activity_type: 'all' }));
      state.instructorsActivityDetailsCache[key] = buildInstructorActivityDetailsForMonth(response?.rows || [], { empId, instrName: row?.full_name || row?.instructor_name, targetYm: month });
    }));
  }
};

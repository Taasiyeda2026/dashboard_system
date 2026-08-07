import { escapeHtml } from './shared/html.js';
import { dsScreenStack, dsEmptyState } from './shared/layout.js';
import { showToast } from './shared/toast.js';
import { activityWorkDrawerHtml, patchDrawerDatesSection } from './shared/activity-detail-html.js';
import {
  loadInstructorSchedulingData,
  saveInstructorSchedulingProfile,
  saveInstructorWeeklyRules,
  saveInstructorAvailabilityException,
  deleteInstructorAvailabilityException
} from './instructor-scheduling-data.js';
import { loadInstructorSeniorityData, saveInstructorContactDetails } from './instructor-contact-data.js';
import {
  text, activeFlag, assigned, instructorCard, profileHtml, contactForm, constraintsForm, matchingForm
} from './instructor-workspace-ui.js?v=20260807-guides-card-redesign-v1';
import {
  bindInstructorsWorkspaceNav,
  instructorsWorkspaceHeaderHtml,
  instructorsWorkspaceNavStylesHtml
} from './shared/instructors-workspace-nav.js';

const ACTIVE_FILTERS = [{ value: 'yes', label: 'פעילים' }, { value: '', label: 'הכול' }, { value: 'no', label: 'לא פעילים' }];
const ASSIGNMENT_FILTERS = [{ value: '', label: 'כל השיבוצים' }, { value: 'assigned', label: 'משובצים' }, { value: 'unassigned', label: 'לא משובצים' }];

const INSTRUCTORS_LIST_STYLES = `.instructors-list{display:flex;flex-direction:column;gap:8px}
.instructors-list__toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:8px;border-bottom:1px solid #edeff2}
.instructors-list__toolbar .ds-chip{min-width:72px;justify-content:center}
.instructors-list__label{margin-inline-start:6px}
.instructors-workspace-grid{display:flex;flex-wrap:wrap;gap:10px}
.instructor-card{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;flex:0 0 auto;min-width:132px;max-width:100%;min-height:86px;padding:10px 16px;box-sizing:border-box;text-align:center;background:#fff;border:1px solid #d9e1e8;border-radius:10px;cursor:pointer;overflow:visible;box-shadow:0 2px 6px rgba(15,23,42,.08);transition:box-shadow .15s ease,transform .15s ease}
.instructor-card:hover{box-shadow:0 3px 8px rgba(15,23,42,.11);transform:translateY(-1px)}
.instructor-card:focus-visible{outline:none;box-shadow:0 0 0 2px rgba(26,51,88,.22)}
.instructor-card__name{white-space:nowrap;font-weight:700;color:#172235;line-height:1.25}
.instructor-card__id{white-space:nowrap;font-size:.72rem;color:#78828f}
.instructor-card__stats{display:flex;align-items:center;gap:9px;white-space:nowrap;margin-top:2px}
.instructor-card__stat{display:inline-flex;align-items:center;gap:3px;color:#66707d;font-size:.72rem}
.instructor-card__stat strong{font-size:.74rem;color:#3d4552;font-weight:700}
@media(max-width:720px){.instructor-card{width:100%}}`;

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

function mergeRows(base, contacts, scheduling, seniorityRows = []) {
  const map = new Map();
  const ensure = (id, name = '') => {
    const key = text(id || name);
    if (!key) return null;
    if (!map.has(key)) map.set(key, { emp_id: key, full_name: text(name || key), programs_count: 0, one_day_count: 0, activity_type_counts: {}, activity_managers: [], authorities: [], schools: [], activity_names: [] });
    return map.get(key);
  };
  (base?.rows || []).forEach((row) => Object.assign(ensure(row.emp_id || row.full_name, row.full_name || row.instructor_name), row));
  (contacts?.rows || []).forEach((row) => Object.assign(ensure(row.emp_id || row.full_name, row.full_name), row));
  (seniorityRows || []).forEach((row) => Object.assign(ensure(row.emp_id), { seniority_years: row.seniority_years ?? null }));
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

function chips(items, selected, attr) {
  return items.map((item) => `<button type="button" class="ds-chip${item.value === selected ? ' is-active' : ''}" ${attr}="${escapeHtml(item.value)}">${escapeHtml(item.label)}</button>`).join('');
}

function replaceScheduling(row, scheduling) {
  row.scheduling_profile = (scheduling.profiles || []).find((item) => text(item.emp_id) === text(row.emp_id)) || null;
  row.availability_rules = (scheduling.rules || []).filter((item) => text(item.emp_id) === text(row.emp_id));
  row.availability_exceptions = (scheduling.exceptions || []).filter((item) => text(item.emp_id) === text(row.emp_id));
}

export function bindInstructorMatchingModal(modalRoot, { row, saveProfile, onSuccess } = {}) {
  const form = modalRoot?.querySelector('.ds-modal__content [data-instructor-matching-form]');
  const saveButton = modalRoot?.querySelector('.ds-modal__footer [data-save-instructor-matching]');
  if (!form || !saveButton || saveButton.dataset.matchingSaveBound === '1') return;
  saveButton.dataset.matchingSaveBound = '1';
  saveButton.addEventListener('click', async () => {
    if (saveButton.disabled) return;
    const status = form.querySelector('[data-matching-status]');
    const originalText = saveButton.textContent;
    saveButton.disabled = true;
    saveButton.classList.add('is-loading');
    saveButton.setAttribute('aria-busy', 'true');
    saveButton.textContent = 'שומר...';
    status.hidden = true;
    status.textContent = '';
    const selected = (name) => [...form.querySelectorAll(`[name="${name}"]:checked`)].map((input) => input.value).filter(Boolean);
    try {
      await saveProfile({
        ...(row.scheduling_profile || {}), emp_id: row.emp_id,
        gender: form.querySelector('[name="gender"]:checked')?.value || '',
        instruction_languages: selected('language'),
        matching_note: form.querySelector('[name="matching_note"]')?.value || ''
      });
      await onSuccess?.();
    } catch (error) {
      status.textContent = `לא ניתן לשמור את ההתאמה. ${String(error?.message || 'יש לנסות שוב.')}`;
      status.hidden = false;
      saveButton.disabled = false;
      saveButton.classList.remove('is-loading');
      saveButton.removeAttribute('aria-busy');
      saveButton.textContent = originalText;
    }
  });
}

export function bindInstructorConstraintsModal(modalRoot, {
  row, saveProfile, saveWeeklyRules, saveException, deleteException, onExceptionChange, onSuccess
} = {}) {
  const form = modalRoot?.querySelector('.ds-modal__content [data-instructor-constraints-form]');
  const saveButton = modalRoot?.querySelector('.ds-modal__footer [data-save-instructor-constraints]');
  if (!form || !saveButton || saveButton.dataset.constraintsSaveBound === '1') return;
  saveButton.dataset.constraintsSaveBound = '1';

  const status = form.querySelector('[data-constraints-status]');
  const showError = (error) => {
    status.textContent = `שגיאה: ${String(error?.message || 'לא ניתן להשלים את הפעולה.')}`;
    status.hidden = false;
  };
  const syncWeekday = (line) => {
    const available = line.querySelector('[name="available"]');
    const disabled = Number(line.dataset.weekdayRow) === 6 || !available?.checked;
    line.querySelectorAll('[name="start_time"], [name="end_time"]').forEach((input) => { input.disabled = disabled; });
  };
  form.querySelectorAll('[data-weekday-row]').forEach((line) => {
    syncWeekday(line);
    line.querySelector('[name="available"]')?.addEventListener('change', () => syncWeekday(line));
  });

  form.querySelector('[data-add-availability-exception]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const value = (name) => text(form.querySelector(`[name="${name}"]`)?.value);
    try {
      button.disabled = true;
      status.hidden = true;
      await saveException({ emp_id: row.emp_id, exception_date: value('exception_date'), available: value('exception_available') === 'yes', start_time: value('exception_start_time'), end_time: value('exception_end_time'), notes: value('exception_notes') });
      await onExceptionChange?.('add');
    } catch (error) {
      showError(error);
      button.disabled = false;
    }
  });
  form.querySelectorAll('[data-delete-availability-exception]').forEach((button) => button.addEventListener('click', async () => {
    try {
      button.disabled = true;
      status.hidden = true;
      await deleteException(button.dataset.deleteAvailabilityException);
      await onExceptionChange?.('delete');
    } catch (error) {
      showError(error);
      button.disabled = false;
    }
  }));

  saveButton.addEventListener('click', async () => {
    if (saveButton.disabled) return;
    const originalText = saveButton.textContent;
    const input = (name) => form.querySelector(`[name="${name}"]`);
    const rules = [...form.querySelectorAll('[data-weekday-row]')].map((line) => ({
      weekday: Number(line.dataset.weekdayRow),
      available: Number(line.dataset.weekdayRow) !== 6 && !!line.querySelector('[name="available"]')?.checked,
      start_time: line.querySelector('[name="start_time"]')?.value,
      end_time: line.querySelector('[name="end_time"]')?.value
    }));
    saveButton.disabled = true;
    saveButton.classList.add('is-loading');
    saveButton.setAttribute('aria-busy', 'true');
    saveButton.textContent = 'שומר...';
    status.hidden = true;
    status.textContent = '';
    try {
      await Promise.all([
        saveProfile({
          ...(row.scheduling_profile || {}), emp_id: row.emp_id,
          default_start_time: input('default_start_time')?.value,
          default_end_time: input('default_end_time')?.value,
          friday_allowed: !!input('friday_allowed')?.checked,
          notes: input('notes')?.value
        }),
        saveWeeklyRules(row.emp_id, rules)
      ]);
      await onSuccess?.();
    } catch (error) {
      showError(error);
      saveButton.disabled = false;
      saveButton.classList.remove('is-loading');
      saveButton.removeAttribute('aria-busy');
      saveButton.textContent = originalText;
    }
  });
}

export const instructorsScreen = {
  async load({ api }) {
    // List entry: instructor cards + contacts only. Scheduling rules/exceptions load on open.
    const [base, contacts, seniorityRows] = await Promise.all([api.instructors(), api.instructorContacts(), loadInstructorSeniorityData()]);
    return { ...base, rows: mergeRows(base, contacts, null, seniorityRows), scheduling: null, _schedulingLoaded: false };
  },

  render(data, { state } = {}) {
    state.instructorsWorkspace = state.instructorsWorkspace || { active: 'yes', assignment: '' };
    const filters = state.instructorsWorkspace;
    const rows = (data?.rows || []).filter((row) => {
      if (filters.active && activeFlag(row.active) !== filters.active) return false;
      if (filters.assignment === 'assigned' && !assigned(row)) return false;
      if (filters.assignment === 'unassigned' && assigned(row)) return false;
      return true;
    });
    const missingAddress = (data?.rows || []).filter((row) => activeFlag(row.active) === 'yes' && !text(row.address)).length;
    const body = rows.length ? `<div class="instructors-workspace-grid">${rows.map(instructorCard).join('')}</div>` : dsEmptyState('לא נמצאו מדריכים בהתאם לסינון');
    return dsScreenStack(`${instructorsWorkspaceNavStylesHtml()}<style>${INSTRUCTORS_LIST_STYLES}</style>
      <div class="instructors-list">
        ${instructorsWorkspaceHeaderHtml({ activeTab: 'list', state })}
        <h2 class="instructors-workspace-content-title">רשימת מדריכים</h2>
        <div class="instructors-list__toolbar">
          <span class="ds-badge">${rows.length} מדריכים</span>${missingAddress ? `<span class="ds-status-chip ds-status-chip--warning">${missingAddress} פעילים ללא כתובת</span>` : ''}
          <span class="ds-muted">סטטוס:</span>${chips(ACTIVE_FILTERS, filters.active, 'data-instructors-active')}<span class="ds-muted instructors-list__label">שיבוץ:</span>${chips(ASSIGNMENT_FILTERS, filters.assignment, 'data-instructors-assignment')}
        </div>
        ${body}
        <p class="ds-muted">ניהול האילוצים וחישוב הצעות השיבוץ פתוחים לאדמין ולתפעול בלבד.</p>
      </div>`);
  },

  bind({ root, data, state, rerender, api, ui, clearScreenDataCache }) {
    const rows = data?.rows || [];
    const canEdit = ['admin', 'operation_manager'].includes(text(state?.user?.role || state?.user?.display_role));
    state.instructorsWorkspace = state.instructorsWorkspace || { active: 'yes', assignment: '' };
    bindInstructorsWorkspaceNav(root, { state, rerender });
    root.querySelectorAll('[data-instructors-active]').forEach((button) => button.addEventListener('click', () => { state.instructorsWorkspace.active = button.dataset.instructorsActive || ''; rerender(); }));
    root.querySelectorAll('[data-instructors-assignment]').forEach((button) => button.addEventListener('click', () => { state.instructorsWorkspace.assignment = button.dataset.instructorsAssignment || ''; rerender(); }));
    // Compatibility for older cached markup that still contains the former "אנשי קשר מדריכים" route button.
    root.querySelector('[data-route="instructor-contacts"]')?.addEventListener('click', (event) => {
      event.preventDefault();
      document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'instructor-contacts' } }));
    });

    const ensureScheduling = async () => {
      if (data?._schedulingLoaded && data?.scheduling?.loaded) return data.scheduling;
      const scheduling = await loadInstructorSchedulingData();
      data.scheduling = scheduling;
      data._schedulingLoaded = true;
      (data.rows || []).forEach((row) => replaceScheduling(row, scheduling));
      return scheduling;
    };
    const refresh = async (row) => { const scheduling = await loadInstructorSchedulingData(); data.scheduling = scheduling; data._schedulingLoaded = true; replaceScheduling(row, scheduling); };
    const openActivity = async (activity) => {
      if (!ui) return;
      const id = activity.row_id || activity.RowID || activity.source_row_id;
      ui.closeDrawer?.();
      let row = activity;
      try { row = (await api.activityDetail(id, activity.source_sheet || 'activities'))?.row || activity; } catch (_) {}
      ui.openDrawer({ title: '', content: activityWorkDrawerHtml(row, { canEdit: false, canDirectEdit: false, canRequestEdit: false, showFinance: false, datesLoading: true, settings: state?.clientSettings || {} }) });
      api.activityDates(id, activity.source_sheet || 'activities').then((dates) => { const section = document.querySelector('[data-dates-section]'); if (section) patchDrawerDatesSection(section, dates); }).catch(() => {});
    };

    const openProfile = async (row) => {
      if (!row || !ui) return;
      await ensureScheduling();
      const historyKey = text(row.emp_id || row.full_name);
      if (data._historyEmpId !== historyKey || !Array.isArray(data.detail_rows) || !data.detail_rows.length) {
        try {
          const history = typeof api.instructorActivityHistory === 'function'
            ? await api.instructorActivityHistory({ empId: row.emp_id, instructorName: row.full_name || row.instructor_name })
            : await api.activities({ activity_type: 'all' });
          data.detail_rows = Array.isArray(history?.rows) ? history.rows : [];
          data._historyEmpId = historyKey;
          data.activities_loaded = true;
        } catch {
          data.detail_rows = [];
          data._historyEmpId = historyKey;
        }
      }
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

    const openMatching = async (row, reopen) => {
      await ensureScheduling();
      if (!canEdit || !data?.scheduling?.loaded) return;
      ui.closeDrawer?.();
      const uniqueOptions = (items) => [...new Map(items.filter(item => item.value).map(item => [item.value, item])).values()].sort((a,b) => a.label.localeCompare(b.label, 'he'));
      const activityRows = data?.detail_rows || [];
      const options = {
        courses: uniqueOptions(activityRows.filter(item => text(item.activity_type).toLowerCase() === 'course' || text(item.activity_type) === 'קורס').map(item => ({ value: text(item.activity_no || item.course_id || item.activity_name), label: `${text(item.activity_name)}${text(item.activity_no) ? ` · ${text(item.activity_no)}` : ''}` }))),
        authorities: uniqueOptions(activityRows.map(item => ({ value: text(item.authority_id || item.authority), label: text(item.authority) }))),
        schools: uniqueOptions(activityRows.map(item => ({ value: text(item.school_id || item.school), label: `${text(item.school)}${text(item.authority) ? ` · ${text(item.authority)}` : ''}` })))
      };
      ui.openModal({ title: `התאמה לשיבוץ — ${row.full_name || row.emp_id}`, modalClass: 'ds-modal--instructor-matching', content: matchingForm(row, options), actions: '<button type="button" class="ds-btn" data-ui-close-modal>ביטול</button><button type="button" class="ds-btn ds-btn--primary" data-save-instructor-matching>שמירה</button>' });
      const modalRoot = document.querySelector('.ds-modal.ds-modal--instructor-matching');
      bindInstructorMatchingModal(modalRoot, {
        row,
        saveProfile: saveInstructorSchedulingProfile,
        onSuccess: async () => { await refresh(row); ui.closeModal(); showToast('ההתאמה לשיבוץ נשמרה','success'); rerender(); reopen?.(); }
      });
    };

    const openContact = (row, reopen) => {
      if (!canEdit) return;
      ui.closeDrawer?.();
      ui.openModal({ title: `עריכת פרטי מדריך — ${row.full_name || row.emp_id}`, content: contactForm(row), actions: '<button type="button" class="ds-btn ds-btn--primary" data-save-instructor-contact>שמירה</button><button type="button" class="ds-btn" data-ui-close-modal>ביטול</button>' });
      const button = document.querySelector('[data-save-instructor-contact]');
      button.onclick = async () => {
        const modal = document.querySelector('.ds-modal__content');
        const get = (name) => text(modal?.querySelector(`[name="${name}"]`)?.value);
        const payload = { emp_id: row.emp_id, full_name: get('full_name'), mobile: get('mobile'), email: get('email'), address: get('address'), employment_type: get('employment_type'), seniority_years: get('seniority_years'), direct_manager: get('direct_manager') || 'ללא', active: get('active') || 'yes' };
        const status = modal?.querySelector('[data-instructor-form-status]');
        if (!payload.full_name) { status.textContent = 'יש להזין שם מלא.'; return; }
        try { button.disabled = true; const saved = await saveInstructorContactDetails(payload); Object.assign(row, payload, saved || {}); clearScreenDataCache?.(); ui.closeModal(); showToast('פרטי המדריך נשמרו', 'success', 1800); rerender(); reopen?.(); } catch (error) { status.textContent = `שגיאה: ${String(error?.message || '')}`; } finally { button.disabled = false; }
      };
    };

    const openConstraints = async (row, reopen) => {
      await ensureScheduling();
      if (!canEdit || !data?.scheduling?.loaded) return;
      ui.closeDrawer?.();
      ui.openModal({ title: `זמינות ואילוצים — ${row.full_name || row.emp_id}`, modalClass: 'ds-modal--instructor-constraints', content: constraintsForm(row), actions: '<button type="button" class="ds-btn" data-ui-close-modal>סגירה</button><button type="button" class="ds-btn ds-btn--primary" data-save-instructor-constraints>שמירת זמינות</button>' });
      const modalRoot = document.querySelector('.ds-modal.ds-modal--instructor-constraints');
      bindInstructorConstraintsModal(modalRoot, {
        row, saveProfile: saveInstructorSchedulingProfile, saveWeeklyRules: saveInstructorWeeklyRules,
        saveException: saveInstructorAvailabilityException, deleteException: deleteInstructorAvailabilityException,
        onExceptionChange: async (action) => { await refresh(row); ui.closeModal(); showToast(action === 'add' ? 'החריג נשמר' : 'החריג נמחק', 'success', 1600); openConstraints(row, reopen); },
        onSuccess: async () => { await refresh(row); ui.closeModal(); showToast('הזמינות והאילוצים נשמרו', 'success', 1800); rerender(); reopen?.(); }
      });
    };

    if (state.pendingInstructorEmpId && ui) {
      const pendingRow = rows.find((item) => text(item.emp_id) === text(state.pendingInstructorEmpId));
      const pendingEdit = state.pendingInstructorEdit;
      state.pendingInstructorEmpId = '';
      state.pendingInstructorEdit = '';
      if (pendingRow) requestAnimationFrame(() => {
        if (pendingEdit === 'constraints') openConstraints(pendingRow);
        else openMatching(pendingRow);
      });
    }

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

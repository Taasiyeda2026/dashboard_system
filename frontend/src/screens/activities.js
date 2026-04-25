import { escapeHtml } from './shared/html.js';
import { formatDateHe } from './shared/format-date.js';
import {
  hebrewColumn,
  visibleActivityCategoryLabel,
  ACTIVITY_TAB_ORDER
} from './shared/ui-hebrew.js';
import { bindActivityEditForm as bindActivityEditFormShared } from './shared/bind-activity-edit-form.js';
import {
  dsToolbar,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState,
  dsInteractiveCard
} from './shared/layout.js';
import { activityWorkDrawerHtml } from './shared/activity-detail-html.js';
import { actNavGridHtml, bindActNavGrid } from './shared/act-nav-grid.js';

const ACTIVITY_VIEW_LS = 'dashboard_activity_view_v2';
const inflightActivityDetailRequests = new Map();

function hasRowException(row) {
  const noInstructor = !String(row.emp_id || '').trim() && !String(row.emp_id_2 || '').trim();
  const noStartDate  = !String(row.start_date || '').trim();
  return noInstructor || noStartDate;
}

const DEFAULT_ONE_DAY_TYPES = ['workshop', 'tour', 'escape_room'];
const DEFAULT_PROGRAM_TYPES = ['course', 'after_school'];

const FAMILY_LABEL_SHORT = 'חד-יומיות';
const FAMILY_LABEL_LONG  = 'תוכניות';
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});

function parseRosterUsers(settings) {
  const raw = Array.isArray(settings?.dropdown_options?.instructor_users)
    ? settings.dropdown_options.instructor_users
    : [];
  const out = [];
  const seen = new Set();
  raw.forEach((item) => {
    const name = String(item?.name || '').trim();
    const empId = String(item?.emp_id || '').trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({ name, emp_id: empId });
  });
  return out;
}

function optionsHtml(values, selected = '', placeholder = '—') {
  const safeSelected = String(selected || '');
  const uniq = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((v) => {
    const s = String(v || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    uniq.push(s);
  });
  if (safeSelected && !seen.has(safeSelected)) uniq.unshift(safeSelected);
  return [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat(
      uniq.map((v) => `<option value="${escapeHtml(v)}"${v === safeSelected ? ' selected' : ''}>${escapeHtml(v)}</option>`)
    )
    .join('');
}

function activityNameOptionsByType(settings, activityType) {
  const all = Array.isArray(settings?.dropdown_options?.activity_names) ? settings.dropdown_options.activity_names : [];
  const byType = all.filter((o) => {
    const parent = String(o?.parent_value || o?.activity_type || '').trim();
    return !parent || parent === activityType;
  });
  return byType.map((o) => ({
    label: String(o?.label || '').trim(),
    activity_no: String(o?.activity_no || '').trim()
  })).filter((o) => o.label);
}

function decodeJsonAttr(raw, fallback = []) {
  try {
    const decoded = decodeURIComponent(String(raw || ''));
    const parsed = JSON.parse(decoded || '[]');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function mergeOptions(settings, keys) {
  const map = settings?.dropdown_options || {};
  const out = [];
  const seen = new Set();
  keys.forEach((k) => {
    const arr = Array.isArray(map[k]) ? map[k] : [];
    arr.forEach((v) => {
      const s = String(v || '').trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push(s);
    });
  });
  return out;
}

function addActivityModalHtml(settings) {
  const oneDayTypes = resolveOneDayTypes(settings);
  const programTypes = Array.isArray(settings?.program_activity_types) && settings.program_activity_types.length
    ? settings.program_activity_types
    : DEFAULT_PROGRAM_TYPES;
  const allTypes = mergeOptions(settings, ['activity_type', 'activity_types']);
  const allActivityNames = Array.isArray(settings?.dropdown_options?.activity_names)
    ? settings.dropdown_options.activity_names
    : [];
  const rosterUsers = parseRosterUsers(settings);
  const rosterNames = rosterUsers.map((u) => u.name);
  const managerRoleUsers = Array.isArray(settings?.dropdown_options?.activities_manager_users)
    ? settings.dropdown_options.activities_manager_users
    : [];
  const managerRoleNames = managerRoleUsers
    .map((u) => String(u?.name || '').trim())
    .filter(Boolean);
  const fundingOptions = mergeOptions(settings, ['funding', 'fundings']);
  const gradeOptions = mergeOptions(settings, ['grade', 'grades']);
  const managerOptions = managerRoleNames.length
    ? managerRoleNames
    : mergeOptions(settings, ['activity_manager', 'activity_managers']);
  const instructorOptions = rosterNames.length ? rosterNames : mergeOptions(settings, ['instructor_name', 'instructor_names']);
  const initialFamily = 'long';
  const initialTypes = programTypes.length ? programTypes : allTypes;
  const initialType = initialTypes[0] || '';
  const initialActivityNames = activityNameOptionsByType(settings, initialType);
  const sessionsList = Array.from({ length: 35 }, (_, i) => String(i + 1));

  return `
    <form class="ds-activity-add-form" dir="rtl" data-add-activity-form
      data-add-activity-names="${escapeHtml(encodeURIComponent(JSON.stringify(allActivityNames)))}"
      data-add-roster-users="${escapeHtml(encodeURIComponent(JSON.stringify(rosterUsers)))}">
      <div class="ds-toolbar" style="justify-content:flex-start">
        <button type="button" class="ds-chip--tab is-active" data-add-family="long">תוכניות</button>
        <button type="button" class="ds-chip--tab" data-add-family="short">חד-יומיות</button>
      </div>
      <input type="hidden" name="source" value="long">
      <div class="ds-activity-add-grid">
        <label class="ds-activity-add-field"><span>מנהל פעילות</span><select class="ds-input" name="activity_manager">${optionsHtml(managerOptions)}</select></label>
        <label class="ds-activity-add-field"><span>רשות</span><input class="ds-input" name="authority" type="text"></label>
        <label class="ds-activity-add-field"><span>בית ספר</span><input class="ds-input" name="school" type="text"></label>
        <label class="ds-activity-add-field"><span>שכבה</span><select class="ds-input" name="grade">${optionsHtml(gradeOptions)}</select></label>
        <label class="ds-activity-add-field"><span>קבוצה / כיתה</span><input class="ds-input" name="class_group" type="text"></label>
        <label class="ds-activity-add-field"><span>סוג פעילות</span>
          <select class="ds-input" name="activity_type" data-add-activity-type
            data-one-day-types="${escapeHtml(JSON.stringify(oneDayTypes))}"
            data-program-types="${escapeHtml(JSON.stringify(programTypes))}"
            data-all-types="${escapeHtml(JSON.stringify(allTypes))}">
            ${optionsHtml(initialTypes, initialType)}
          </select>
        </label>
        <label class="ds-activity-add-field"><span>שם פעילות</span>
          <select class="ds-input" name="activity_name" data-add-activity-name>
            ${optionsHtml(initialActivityNames.map((o) => o.label), '', 'בחרו שם פעילות')}
          </select>
        </label>
        <input type="hidden" name="activity_no" value="" data-add-activity-no>
        <label class="ds-activity-add-field" data-field-sessions><span>מספר מפגשים</span><select class="ds-input" name="sessions" data-add-sessions>${optionsHtml(sessionsList, '1')}</select></label>
        <label class="ds-activity-add-field"><span>מחיר</span><input class="ds-input" name="price" type="number" min="0" step="1"></label>
        <label class="ds-activity-add-field"><span>מימון</span><select class="ds-input" name="funding">${optionsHtml(fundingOptions)}</select></label>
        <label class="ds-activity-add-field"><span>שעת התחלה</span><select class="ds-input" name="start_time">${optionsHtml(TIME_OPTIONS)}</select></label>
        <label class="ds-activity-add-field"><span>שעת סיום</span><select class="ds-input" name="end_time">${optionsHtml(TIME_OPTIONS)}</select></label>
        <label class="ds-activity-add-field"><span>מדריך/ה</span><select class="ds-input" name="instructor_name" data-add-instructor>${optionsHtml(instructorOptions)}</select></label>
        <input type="hidden" name="emp_id" value="">
        <label class="ds-activity-add-field" data-field-instructor2 style="display:none"><span>מדריך/ה 2</span><select class="ds-input" name="instructor_name_2" data-add-instructor-2>${optionsHtml(instructorOptions)}</select></label>
        <input type="hidden" name="emp_id_2" value="">
        <label class="ds-activity-add-field"><span>תאריך התחלה</span><input class="ds-input" name="start_date" type="date"></label>
        <label class="ds-activity-add-field"><span>הערות</span><textarea class="ds-input" name="notes" rows="2"></textarea></label>
      </div>
      <p class="ds-muted" role="status" data-add-activity-status></p>
    </form>
  `;
}

function resolveOneDayTypes(settings) {
  return Array.isArray(settings?.one_day_activity_types) && settings.one_day_activity_types.length
    ? settings.one_day_activity_types
    : DEFAULT_ONE_DAY_TYPES;
}

function isShortFamily(row, oneDayTypes) {
  return oneDayTypes.includes(String(row?.activity_type || '').trim());
}

function applyClientFilters(rows, state, settings) {
  let out = Array.isArray(rows) ? rows.slice() : [];
  const oneDayTypes = resolveOneDayTypes(settings);
  if (state.activityQuickFamily === 'short') {
    out = out.filter((row) => isShortFamily(row, oneDayTypes));
  } else if (state.activityQuickFamily === 'long') {
    out = out.filter((row) => !isShortFamily(row, oneDayTypes));
  }
  return out;
}

function activityDrawerContent(row, canSeePrivateNotes, canEdit, hideEmpIds, hideRowId, hideActivityNo, settings) {
  const privateNote = canSeePrivateNotes ? row.private_note || '—' : null;
  return activityWorkDrawerHtml(row, {
    privateNote,
    canEdit,
    hideEmpIds: !!hideEmpIds,
    hideRowId,
    hideActivityNo,
    settings,
    showFinance: false,
    showFinanceFields: false
  });
}

function activityDetailCacheKey(summaryRow) {
  return `activityDetail:${summaryRow.source_sheet || ''}:${summaryRow.RowID || ''}`;
}

function getCachedActivityDetail(summaryRow, s) {
  const entry = s?.screenDataCache?.[activityDetailCacheKey(summaryRow)];
  return entry ? entry.data : null;
}

function putCachedActivityDetail(summaryRow, row, s) {
  if (s?.screenDataCache) {
    s.screenDataCache[activityDetailCacheKey(summaryRow)] = { data: row, t: Date.now() };
  }
}

export const activitiesScreen = {
  async load({ api, state }) {
    console.time('activities:load');
    try {
      const v = typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVITY_VIEW_LS) : null;
      if (v === 'table' || v === 'compact') state.activityView = v;
    } catch (_e) {
      /* ignore */
    }
    return api.activities({ activity_type: 'all' }).finally(() => console.timeEnd('activities:load'));
  },

  render(data, { state }) {
    console.time('activities:render');
    const allRows       = Array.isArray(data?.rows) ? data.rows : [];
    const safeRows      = applyClientFilters(allRows, state, state?.clientSettings);
    const canSeePrivateNotes = state?.user?.display_role === 'operations_reviewer';
    const hideEmpIds    = !!state?.clientSettings?.hide_emp_id_on_screens;
    const hideRowId     = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;
    const forceCompact  = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
    const compactView   = forceCompact || state?.activityView === 'compact';

    const tableRows = safeRows
      .map((row) => {
        const emp1 = hideEmpIds ? '' : `<td>${escapeHtml(row.emp_id || '—')}</td>`;
        const emp2 = hideEmpIds ? '' : `<td>${escapeHtml(row.emp_id_2 || '—')}</td>`;
        const rowSearch = [
          hideRowId ? '' : row.RowID,
          row.activity_name,
          row.start_date,
          row.end_date,
          row.school,
          row.authority,
          row.activity_manager,
          visibleActivityCategoryLabel(row.activity_type),
          hideEmpIds ? '' : row.emp_id,
          hideEmpIds ? '' : row.emp_id_2,
          canSeePrivateNotes ? row.private_note : ''
        ]
          .filter(Boolean)
          .join(' ');
        return `
      <tr class="ds-data-row" data-list-item data-search="${escapeHtml(rowSearch)}" data-filter="" data-row-id="${escapeHtml(row.RowID)}">
        <td>${escapeHtml(visibleActivityCategoryLabel(row.activity_type))}</td>
        <td>${escapeHtml(row.activity_name || '—')}</td>
        <td>${escapeHtml(row.school || '—')}</td>
        <td>${escapeHtml(row.authority || '—')}</td>
        <td>${escapeHtml(formatDateHe(row.start_date) || '—')}</td>
        <td>${escapeHtml(formatDateHe(row.end_date) || '—')}</td>
        ${emp1}${emp2}
        ${canSeePrivateNotes ? `<td>${escapeHtml(row.private_note || '')}</td>` : ''}
      </tr>
    `;
      })
      .join('');

    const compactRows = safeRows
      .map((row) => {
        const rowSearch = [
          hideRowId ? '' : row.RowID,
          row.activity_name,
          row.school,
          row.authority,
          row.start_date,
          row.end_date
        ]
          .filter(Boolean)
          .join(' ');
        const excBadge = hasRowException(row) ? '<span class="ds-exc-dot" title="חריגה">⚠️</span>' : '';
        return `<div data-list-item data-search="${escapeHtml(rowSearch)}" data-filter="">
        ${excBadge}${dsInteractiveCard({
          action: `activity:${row.RowID}`,
          title: row.activity_name || 'פעילות ללא שם',
          subtitle: row.school || 'ללא בית ספר',
          meta: row.authority || 'ללא רשות',
          variant: 'session'
        })}
      </div>`;
      })
      .join('');

    const thPrivate = canSeePrivateNotes ? `<th>${hebrewColumn('private_note')}</th>` : '';
    const thEmp     = hideEmpIds ? '' : '<th>מדריך/ה 1 (מזהה)</th><th>מדריך/ה 2 (מזהה)</th>';

    const familyChips = [
      { key: '',      label: 'הכל' },
      { key: 'short', label: FAMILY_LABEL_SHORT },
      { key: 'long',  label: FAMILY_LABEL_LONG }
    ]
      .map(
        (f) =>
          `<button type="button" class="ds-chip--tab ${f.key === (state.activityQuickFamily || '') ? 'is-active' : ''}" data-family="${f.key}">${escapeHtml(f.label)}</button>`
      )
      .join('');

    const tableSection =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו פעילויות')
        : dsTableWrap(`<table class="ds-table ds-table--interactive ds-table--equal-cols">
                <thead><tr><th>${hebrewColumn('activity_type')}</th><th>שם</th><th>בית ספר</th><th>רשות</th><th>התחלה</th><th>סיום</th>${thEmp}${thPrivate}</tr></thead>
                <tbody>${tableRows}</tbody>
              </table>`);

    const compactSection =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו פעילויות')
        : `<div class="ds-compact-list">${compactRows}</div>`;

    const html = dsScreenStack(`
      ${actNavGridHtml(state)}
      ${dsToolbar(`
        <div class="ds-view-toggle" dir="rtl" role="group" aria-label="בחירת תצוגת רשימה">
          <button type="button" class="ds-view-toggle__btn ${!compactView ? 'is-active' : ''}" data-activity-view="table" ${
            forceCompact ? 'disabled title="במסך צר מוצגות תיבות קומפקטיות"' : ''
          }>☰ טבלה</button>
          <button type="button" class="ds-view-toggle__btn ${compactView ? 'is-active' : ''}" data-activity-view="compact">⊞ תיבות</button>
        </div>
        <div class="ds-chip-group" dir="rtl">${familyChips}</div>
      `)}
      ${compactView
        ? dsCard({ title: 'רשימת פעילויות', body: compactSection, padded: true })
        : dsCard({ title: 'רשימת פעילויות', body: tableSection,   padded: false })}
    `);
    console.timeEnd('activities:render');
    return html;
  },

  bind({ root, data, state, rerender, rerenderActivitiesView, ui, api, clearScreenDataCache }) {
    bindActNavGrid(root, { state, rerender });

    const filteredRows      = applyClientFilters(Array.isArray(data?.rows) ? data.rows : [], state, state?.clientSettings);
    const canSeePrivateNotes = state?.user?.display_role === 'operations_reviewer';
    const canEditActivity   = state?.user?.display_role !== 'instructor';
    const hideEmpIds        = !!state?.clientSettings?.hide_emp_id_on_screens;
    const hideRowId         = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo    = !!state?.clientSettings?.hide_activity_no_on_screens;
    const canAddActivity = !!state?.user?.can_add_activity;

    const bindActivityEditForm = (contentRoot) =>
      bindActivityEditFormShared(contentRoot, { api, ui, clearScreenDataCache, rerender });

    async function loadDetailRow(summaryRow) {
      const key = activityDetailCacheKey(summaryRow);
      let request = inflightActivityDetailRequests.get(key);
      if (!request) {
        console.time('activityDetail:load');
        request = api.activityDetail(summaryRow.RowID, summaryRow.source_sheet)
          .finally(() => {
            console.timeEnd('activityDetail:load');
            inflightActivityDetailRequests.delete(key);
          });
        inflightActivityDetailRequests.set(key, request);
      }
      const rsp = await request;
      const row = rsp?.row || summaryRow;
      putCachedActivityDetail(summaryRow, row, state);
      return row;
    }

    function hideShellHeader(contentRoot) {
      const shellHdr = contentRoot.closest('.ds-drawer')?.querySelector(':scope > header');
      if (shellHdr) shellHdr.hidden = true;
    }

    function makeOnOpen(contentRoot) {
      hideShellHeader(contentRoot);
      bindActivityEditForm(contentRoot);
    }

    async function openActivityDetail(summaryRow) {
      if (!summaryRow || !ui) return;
      const cached = getCachedActivityDetail(summaryRow, state);
      const initialRow = cached || summaryRow;
      ui.openDrawer({
        title: '',
        content: activityDrawerContent(
          initialRow,
          canSeePrivateNotes,
          canEditActivity,
          hideEmpIds,
          hideRowId,
          hideActivityNo,
          state?.clientSettings || {}
        ),
        onOpen: makeOnOpen,
        onClose: () => {
          const shellHdr = document.querySelector('.ds-drawer > header');
          if (shellHdr) shellHdr.hidden = false;
        }
      });
      if (cached) return;
      try {
        const row = await loadDetailRow(summaryRow);
        ui.openDrawer({
          title: '',
          content: activityDrawerContent(
            row,
            canSeePrivateNotes,
            canEditActivity,
            hideEmpIds,
            hideRowId,
            hideActivityNo,
            state?.clientSettings || {}
          ),
          onOpen: makeOnOpen,
          onClose: () => {
            const shellHdr = document.querySelector('.ds-drawer > header');
            if (shellHdr) shellHdr.hidden = false;
          }
        });
      } catch {}
    }

    root.querySelectorAll('[data-family]').forEach((node) => {
      node.addEventListener('click', () => {
        state.activityQuickFamily = node.dataset.family || '';
        rerender();
      });
    });

    if (root._addActivityAbort) root._addActivityAbort.abort();
    root._addActivityAbort = new AbortController();
    const addActivitySig = { signal: root._addActivityAbort.signal };

    function refreshActivityNameSelect(form) {
      const typeSel = form.querySelector('[data-add-activity-type]');
      const nameSel = form.querySelector('[data-add-activity-name]');
      const noInput = form.querySelector('[data-add-activity-no]');
      if (!typeSel || !nameSel || !noInput) return;
      const all = decodeJsonAttr(form.dataset.addActivityNames, []);
      const type = String(typeSel.value || '').trim();
      const list = all.filter((o) => {
        const parent = String(o?.parent_value || o?.activity_type || '').trim();
        return !parent || parent === type;
      });
      const current = String(nameSel.value || '').trim();
      nameSel.innerHTML = optionsHtml(list.map((o) => o.label), current, 'בחרו שם פעילות');
      const hit = list.find((o) => String(o?.label || '').trim() === String(nameSel.value || '').trim());
      noInput.value = String(hit?.activity_no || '');
    }

    function updateAddFormByFamily(form) {
      const sourceInput = form.querySelector('input[name="source"]');
      const familyBtns = Array.from(form.querySelectorAll('[data-add-family]'));
      const activeBtn = familyBtns.find((b) => b.classList.contains('is-active'));
      const family = String(activeBtn?.dataset.addFamily || 'long');
      const isShort = family === 'short';
      if (sourceInput) sourceInput.value = isShort ? 'short' : 'long';

      const sessionsSel = form.querySelector('[data-add-sessions]');
      if (sessionsSel) {
        sessionsSel.value = isShort ? '1' : (String(sessionsSel.value || '1') || '1');
        sessionsSel.disabled = isShort;
      }

      const secondInstructorField = form.querySelector('[data-field-instructor2]');
      if (secondInstructorField) secondInstructorField.style.display = isShort ? '' : 'none';

      const typeSel = form.querySelector('[data-add-activity-type]');
      if (typeSel) {
        let oneDayTypes = [];
        let programTypes = [];
        let allTypes = [];
        try { oneDayTypes = JSON.parse(typeSel.dataset.oneDayTypes || '[]'); } catch {}
        try { programTypes = JSON.parse(typeSel.dataset.programTypes || '[]'); } catch {}
        try { allTypes = JSON.parse(typeSel.dataset.allTypes || '[]'); } catch {}
        const nextTypes = (isShort ? oneDayTypes : programTypes).length ? (isShort ? oneDayTypes : programTypes) : allTypes;
        typeSel.innerHTML = optionsHtml(nextTypes, nextTypes[0] || '');
      }
      refreshActivityNameSelect(form);
    }

    function bindAddActivityForm() {
      const modalContent = document.querySelector('.ds-modal__content');
      const form = modalContent?.querySelector('[data-add-activity-form]');
      if (!form || form.dataset.boundAddActivity === 'yes') return;
      form.dataset.boundAddActivity = 'yes';

      updateAddFormByFamily(form);
      form.querySelectorAll('[data-add-family]').forEach((btn) => {
        btn.addEventListener('click', () => {
          form.querySelectorAll('[data-add-family]').forEach((b) => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          updateAddFormByFamily(form);
        }, addActivitySig);
      });

      form.querySelector('[data-add-activity-type]')?.addEventListener('change', () => {
        refreshActivityNameSelect(form);
      }, addActivitySig);

      form.querySelector('[data-add-activity-name]')?.addEventListener('change', () => {
        refreshActivityNameSelect(form);
      }, addActivitySig);
    }

    document.addEventListener('click', async (ev) => {
      const submit = ev.target.closest('[data-add-activity-submit]');
      if (!submit) return;
      const modal = document.querySelector('.ds-modal__content');
      const form = modal?.querySelector('[data-add-activity-form]');
      if (!form) return;
      const statusEl = form.querySelector('[data-add-activity-status]');
      const activityMap = decodeJsonAttr(form.dataset.addActivityNames, []);
      const roster = decodeJsonAttr(form.dataset.addRosterUsers, []);
      const fd = new FormData(form);
      const get = (k) => String(fd.get(k) || '').trim();
      const familySource = get('source') || 'long';
      const selectedName = get('activity_name');
      const hit = activityMap.find((x) => {
        const label = String(x?.label || '').trim();
        const parent = String(x?.parent_value || x?.activity_type || '').trim();
        return label === selectedName && (!parent || parent === get('activity_type'));
      });
      const pickEmp = (name) => {
        const u = roster.find((r) => String(r?.name || '').trim() === name);
        return String(u?.emp_id || '').trim();
      };
      const isShort = familySource === 'short';
      const sessionsValue = isShort ? '1' : get('sessions') || '1';
      const payload = {
        source: familySource,
        activity_manager: get('activity_manager'),
        authority: get('authority'),
        school: get('school'),
        grade: get('grade'),
        class_group: get('class_group'),
        activity_type: get('activity_type'),
        activity_name: selectedName,
        activity_no: String(hit?.activity_no || get('activity_no') || ''),
        sessions: sessionsValue,
        price: get('price'),
        funding: get('funding'),
        start_time: get('start_time'),
        end_time: get('end_time'),
        instructor_name: get('instructor_name'),
        emp_id: pickEmp(get('instructor_name')),
        instructor_name_2: isShort ? get('instructor_name_2') : '',
        emp_id_2: isShort ? pickEmp(get('instructor_name_2')) : '',
        start_date: get('start_date'),
        status: 'פעיל',
        notes: get('notes')
      };
      if (!payload.activity_type || !payload.activity_name || !payload.start_date) {
        if (statusEl) statusEl.textContent = 'יש למלא לפחות סוג פעילות, שם פעילות ותאריך התחלה';
        return;
      }
      try {
        submit.disabled = true;
        if (statusEl) statusEl.textContent = 'שומר...';
        await api.addActivity(payload);
        if (statusEl) statusEl.textContent = 'נשמר בהצלחה';
        clearScreenDataCache?.();
        ui?.closeModal?.();
        rerender?.();
      } catch (err) {
        if (statusEl) statusEl.textContent = `שגיאה: ${String(err?.message || '')}`;
      } finally {
        submit.disabled = false;
      }
    }, addActivitySig);

    if (canAddActivity && ui) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'ds-btn ds-btn--primary ds-btn--sm ds-btn--compact';
      addBtn.textContent = '➕ הוספת פעילות';
      const toolbar = root.querySelector('.ds-toolbar');
      if (toolbar) toolbar.appendChild(addBtn);

      addBtn.addEventListener('click', () => {
        ui.openModal({
          title: 'הוספת פעילות',
          content: addActivityModalHtml(state?.clientSettings || {}),
          actions: `
            <button type="button" class="ds-btn ds-btn--primary" data-add-activity-submit>שמור</button>
            <button type="button" class="ds-btn" data-ui-close-modal>ביטול</button>
          `
        });
        bindAddActivityForm();
      }, addActivitySig);
    }

    root.querySelectorAll('[data-activity-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const next = btn.getAttribute('data-activity-view');
        if (next !== 'table' && next !== 'compact') return;
        state.activityView = next;
        try {
          localStorage.setItem(ACTIVITY_VIEW_LS, state.activityView);
        } catch (_e) {
          /* ignore */
        }
        if (typeof rerenderActivitiesView === 'function') rerenderActivitiesView();
        else rerender();
      });
    });

    root.querySelectorAll('.ds-data-row').forEach((n) => {
      n.tabIndex = 0;
      n.setAttribute('role', 'button');
    });
    if (root._rowAbort) root._rowAbort.abort();
    root._rowAbort = new AbortController();
    const rowSig = { signal: root._rowAbort.signal };
    root.addEventListener('click', (ev) => {
      const rowNode = ev.target.closest('.ds-data-row');
      if (!rowNode) return;
      ev.stopPropagation();
      const rowId = rowNode.dataset.rowId;
      const hit = filteredRows.find((row) => row.RowID === rowId);
      if (!hit || !ui) return;
      openActivityDetail(hit).catch(() => {});
    }, rowSig);
    root.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const rowNode = ev.target.closest('.ds-data-row');
      if (!rowNode) return;
      ev.preventDefault();
      rowNode.click();
    }, rowSig);

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('activity:')) return;
      const rowId = action.replace('activity:', '');
      const row = filteredRows.find((r) => r.RowID === rowId);
      if (!row) return;
      openActivityDetail(row).catch(() => {});
    });
  }
};

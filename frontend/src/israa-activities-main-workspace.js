import { activitiesScreen } from './screens/activities.js';
import { api } from './api.js';
import { state, clearScreenDataCache } from './state.js';

const PANEL_SELECTOR = '.israa-mgmt .israa-activities-panel';
const ACTIVE_TAB_SELECTOR = '.israa-mgmt [data-israa-tab="activities"].is-active';
const WORKSPACE_MARK = 'israaMainActivitiesWorkspace';
const workspaceState = {};
let workspaceRows = [];
let workspaceTracking = [];
let running = false;
let timer = null;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function draftRowId(trackingId, proposalItemId) {
  return `israa-draft|${trackingId}|${proposalItemId}`;
}

function parseDraftRowId(value) {
  const parts = clean(value).split('|');
  if (parts.length !== 3 || parts[0] !== 'israa-draft') return null;
  return { trackingId: parts[1], proposalItemId: parts[2] };
}

function normalizeSharedRow(row = {}) {
  const rowId = clean(row.RowID || row.row_id || row.id);
  return {
    ...row,
    RowID: rowId,
    row_id: rowId,
    source_row_id: rowId,
    source_sheet: row.source_sheet || 'activities',
    activity_season: row.activity_season || 'school_2027',
    activity_domain: 'E'
  };
}

function normalizeDraftRow(tracking = {}, draft = {}) {
  const proposalItemId = clean(draft.proposal_item_id);
  const id = draftRowId(tracking.id, proposalItemId);
  const row = {
    ...draft,
    RowID: id,
    row_id: id,
    source_row_id: id,
    source_sheet: 'activities',
    activity_name: draft.activity_name || draft.program_name || 'פעילות',
    activity_no: draft.activity_no || draft.gefen_number || '',
    activity_type: draft.activity_type || draft.item_type || '',
    item_type: draft.item_type || draft.activity_type || '',
    authority: draft.authority || tracking.authority || '',
    authority_id: draft.authority_id || tracking.authority_id || null,
    school: draft.school || tracking.school_name || '',
    school_id: draft.school_id || tracking.school_id || null,
    grade: draft.grade || tracking.grade || '',
    class_group: draft.class_group || draft.group || '',
    sessions: draft.sessions ?? draft.meetings_count ?? '',
    funding: draft.funding || tracking.funding || '',
    start_date: draft.start_date || draft.activity_date || '',
    end_date: draft.end_date || '',
    start_time: draft.start_time || '',
    end_time: draft.end_time || '',
    emp_id: draft.emp_id || '',
    instructor_name: draft.instructor_name || '',
    emp_id_2: draft.emp_id_2 || '',
    instructor_name_2: draft.instructor_name_2 || '',
    activity_manager: draft.activity_manager || '',
    status: draft.status || 'פתוח',
    notes: draft.notes || '',
    activity_season: 'school_2027',
    activity_domain: 'E',
    israaa_private_draft: true,
    israaa_tracking_id: tracking.id,
    israaa_source_item_id: proposalItemId
  };
  for (let i = 1; i <= 35; i += 1) {
    const key = `date_${i}`;
    if (draft[key]) row[key] = draft[key];
  }
  return row;
}

function syncWorkspaceState() {
  if (!workspaceState.__initialized) {
    Object.assign(workspaceState, state || {});
    workspaceState.__initialized = true;
    workspaceState.activityListFilters = { ...(state?.activityListFilters || {}) };
    workspaceState.screenDataCache = {};
  }
  workspaceState.clientSettings = state?.clientSettings || {};
  workspaceState.activityPeriodTab = 'school_2027';
  if (!workspaceState.activitiesInnerTab || workspaceState.activitiesInnerTab === 'regular_2026' || workspaceState.activitiesInnerTab === 'summer_2026') {
    workspaceState.activitiesInnerTab = 'year_all';
  }
  const sourceUser = state?.user || {};
  workspaceState.user = {
    ...sourceUser,
    permissions: { ...(sourceUser.permissions || {}), view_activities: 'yes' },
    can_edit_direct: true,
    can_add_activity: false,
    can_request_edit: false,
    can_request_create_activity: false,
    can_review_requests: false
  };
}

async function loadWorkspaceRows() {
  const [trackingResult, sharedResult] = await Promise.all([
    api.israaProgramTracking(),
    api.israaSharedActivities()
  ]);
  workspaceTracking = Array.isArray(trackingResult?.rows) ? trackingResult.rows : [];
  const shared = (Array.isArray(sharedResult?.rows) ? sharedResult.rows : []).map(normalizeSharedRow);
  const sharedKeys = new Set(shared.map((row) => `${clean(row.israa_tracking_id)}|${clean(row.israa_source_item_id)}`));
  const drafts = [];
  workspaceTracking.forEach((tracking) => {
    const selected = Array.isArray(tracking?.selected_activity_drafts) ? tracking.selected_activity_drafts : [];
    selected.forEach((draft) => {
      const key = `${clean(tracking.id)}|${clean(draft?.proposal_item_id)}`;
      if (!draft?.proposal_item_id || sharedKeys.has(key)) return;
      drafts.push(normalizeDraftRow(tracking, draft));
    });
  });
  workspaceRows = [...drafts, ...shared];
  return workspaceRows;
}

function currentDraftRow(rowId) {
  return workspaceRows.find((row) => clean(row.RowID || row.row_id) === clean(rowId)) || null;
}

async function refreshWorkspace({ rerender = true } = {}) {
  await loadWorkspaceRows();
  if (rerender) renderWorkspace();
}

const workspaceApi = new Proxy(api, {
  get(target, prop) {
    if (prop === 'saveActivity') {
      return async (payload = {}) => {
        const rowId = clean(payload.source_row_id || payload.row_id || payload.RowID || payload.id);
        const changes = payload.changes && typeof payload.changes === 'object' ? payload.changes : payload;
        const draftRef = parseDraftRowId(rowId);
        if (draftRef) {
          const result = await api.saveIsraaActivityDraft(draftRef.trackingId, draftRef.proposalItemId, changes);
          await refreshWorkspace({ rerender: false });
          return { row: currentDraftRow(rowId) || { ...(result?.draft || {}), RowID: rowId, row_id: rowId, source_sheet: 'activities', activity_season: 'school_2027', activity_domain: 'E' } };
        }
        const result = await api.updateIsraaSharedActivity(rowId, changes);
        await refreshWorkspace({ rerender: false });
        return result;
      };
    }
    if (prop === 'activityDetail') {
      return async (rowId, sourceSheet = 'activities') => {
        const draftRef = parseDraftRowId(rowId);
        if (draftRef) return { row: currentDraftRow(rowId) };
        return api.activityDetail(rowId, sourceSheet);
      };
    }
    if (prop === 'activityDates') {
      return async (rowId, sourceSheet = 'activities') => {
        if (parseDraftRowId(rowId)) return { rows: [], dates: [], meeting_schedule: [] };
        return api.activityDates(rowId, sourceSheet);
      };
    }
    if (prop === 'deleteActivity' || prop === 'addActivity' || prop === 'submitCreateActivityRequest') {
      return async () => { throw new Error('israa_workspace_action_not_allowed'); };
    }
    return target[prop];
  }
});

function closeActivityDrawer() {
  const drawer = document.querySelector('.activity-drawer__form')?.closest('.ds-drawer');
  const close = drawer?.querySelector('[data-ui-close-drawer], .ds-drawer__close, [aria-label="סגירה"]');
  close?.click();
}

function injectWorkspaceStyle() {
  if (document.getElementById('israa-main-activities-workspace-style')) return;
  const style = document.createElement('style');
  style.id = 'israa-main-activities-workspace-style';
  style.textContent = `
    .israa-activities-panel[data-${WORKSPACE_MARK}="yes"]{display:block!important;min-width:0;width:100%}
    html.israa-main-activities-active [data-action="delete-activity"]{display:none!important}
    .israa-draft-special-actions{display:flex;gap:8px;flex-wrap:wrap;padding:10px 16px;margin:0 0 8px;border:1px solid #dbe3ee;border-radius:10px;background:#f8fafc}
    .israa-draft-special-actions button{min-height:34px}
  `;
  document.head.appendChild(style);
}

function decorateDraftDrawer() {
  if (!document.querySelector(ACTIVE_TAB_SELECTOR)) return;
  const form = document.querySelector('.activity-drawer__form[data-row-id^="israa-draft|"]');
  if (!form || form.querySelector('[data-israa-draft-special-actions]')) return;
  const ref = parseDraftRowId(form.dataset.rowId);
  if (!ref) return;
  const bar = document.createElement('div');
  bar.className = 'israa-draft-special-actions';
  bar.dataset.israaDraftSpecialActions = 'yes';
  bar.innerHTML = `
    <button type="button" class="ds-btn ds-btn--primary" data-israa-workspace-share>שתף לפעילויות</button>
    <button type="button" class="ds-btn" data-israa-workspace-remove>הסר מהפעילויות שלי</button>
  `;
  form.prepend(bar);
  bar.querySelector('[data-israa-workspace-share]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api.shareIsraaActivity(ref.trackingId, ref.proposalItemId);
      closeActivityDrawer();
      await refreshWorkspace();
    } catch (error) {
      console.error('[israa-workspace-share]', error);
      button.disabled = false;
      window.alert('לא ניתן לשתף את הפעילות כרגע.');
    }
  });
  bar.querySelector('[data-israa-workspace-remove]')?.addEventListener('click', async (event) => {
    if (!window.confirm('להסיר מהפעילויות שלי? הפעילות תישאר בהצעה וניתן יהיה לבחור אותה שוב.')) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api.removeIsraaActivityDraft(ref.trackingId, ref.proposalItemId);
      closeActivityDrawer();
      await refreshWorkspace();
      window.dispatchEvent(new CustomEvent('israa-activities-changed'));
    } catch (error) {
      console.error('[israa-workspace-remove]', error);
      button.disabled = false;
      window.alert('לא ניתן להסיר את הפעילות כרגע.');
    }
  });
}

function renderWorkspace() {
  const panel = document.querySelector(PANEL_SELECTOR);
  if (!panel || !document.querySelector(ACTIVE_TAB_SELECTOR)) return;
  syncWorkspaceState();
  panel.dataset[WORKSPACE_MARK] = 'yes';
  panel.style.display = 'block';
  const data = { rows: workspaceRows };
  const rerender = () => {
    if (!document.body.contains(panel) || !document.querySelector(ACTIVE_TAB_SELECTOR)) return;
    panel.innerHTML = activitiesScreen.render(data, { state: workspaceState });
    activitiesScreen.bind({
      root: panel,
      data,
      state: workspaceState,
      rerender,
      rerenderActivitiesView: rerender,
      api: workspaceApi,
      ui: { bindInteractiveCards() {} },
      clearScreenDataCache
    });
    requestAnimationFrame(decorateDraftDrawer);
  };
  rerender();
}

async function enhance(force = false) {
  if (running) return;
  const active = document.querySelector(ACTIVE_TAB_SELECTOR);
  if (!active) {
    document.documentElement.classList.remove('israa-main-activities-active');
    return;
  }
  document.documentElement.classList.add('israa-main-activities-active');
  injectWorkspaceStyle();
  const panel = document.querySelector(PANEL_SELECTOR);
  if (!panel) return;
  if (!force && panel.dataset[WORKSPACE_MARK] === 'yes') {
    decorateDraftDrawer();
    return;
  }
  running = true;
  try {
    await loadWorkspaceRows();
    renderWorkspace();
  } catch (error) {
    console.error('[israa-main-activities-workspace]', error);
    panel.innerHTML = '<div class="ds-empty" dir="rtl"><p class="ds-empty__msg">לא ניתן לטעון את הפעילויות כרגע.</p></div>';
  } finally {
    running = false;
  }
}

function schedule(force = false) {
  clearTimeout(timer);
  timer = setTimeout(() => enhance(force), 80);
}

window.addEventListener('israa-activities-changed', () => schedule(true));
window.addEventListener('israa-tracking-updated', () => schedule(true));
new MutationObserver(() => {
  schedule(false);
  decorateDraftDrawer();
}).observe(document.documentElement, { childList: true, subtree: true });

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => schedule(), { once: true });
else schedule();

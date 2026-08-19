import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { monthDayCardsHtml } from '../frontend/src/screens/shared/day-session-cards.js';

// manager-board-runtime.js / manager-board-workspace-runtime.js / manager-board-interactions-runtime.js
// bootstrap themselves against `document` at import time, so (like the existing
// tests/calendar-navigation.test.mjs convention for month.js/week.js/dashboard.js) their behaviour is
// verified via source-shape assertions here instead of importing them into a DOM-less node:test run.
const runtimeSrc = fs.readFileSync(new URL('../frontend/src/manager-board-runtime.js', import.meta.url), 'utf8');
const workspaceSrc = fs.readFileSync(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const interactionsSrc = fs.readFileSync(new URL('../frontend/src/manager-board-interactions-runtime.js', import.meta.url), 'utf8');
const monthSrc = fs.readFileSync(new URL('../frontend/src/screens/month.js', import.meta.url), 'utf8');

// Police-clearance SharePoint component + required onboarding gender.
const employeeFileLiveSrc = fs.readFileSync(new URL('../supabase/functions/instructor-employee-file-live/index.ts', import.meta.url), 'utf8');
const onboardingFolderSrc = fs.readFileSync(new URL('../supabase/functions/instructor-onboarding-folder/index.ts', import.meta.url), 'utf8');
const employeeFileUiSrc = fs.readFileSync(new URL('../frontend/src/screens/instructor-employee-file-ui.js', import.meta.url), 'utf8');
const employeeFileDataSrc = fs.readFileSync(new URL('../frontend/src/screens/instructor-employee-file-data.js', import.meta.url), 'utf8');
const onboardingSrc = fs.readFileSync(new URL('../frontend/src/screens/instructor-onboarding.js', import.meta.url), 'utf8');
const policeClearanceMigrationSrc = fs.readFileSync(new URL('../supabase/migrations/20260819180000_police_clearance_component.sql', import.meta.url), 'utf8');
const onboardingGenderMigrationSrc = fs.readFileSync(new URL('../supabase/migrations/20260819190000_instructor_onboarding_gender.sql', import.meta.url), 'utf8');

test('monthDayCardsHtml default behaviour matches the original month.js day drawer (no subtitle, instructor meta)', () => {
  const html = monthDayCardsHtml(
    [{ RowID: 'r1', activity_name: 'חוג רובוטיקה', instructor_name: 'דני כהן', instructor_name_2: '' }],
    '2026-09-10'
  );
  assert.ok(html.includes('monthsession|2026-09-10|r1'));
  assert.ok(html.includes('חוג רובוטיקה'));
  assert.ok(html.includes('דני כהן'));
  assert.ok(!html.includes('ds-interactive-card__subtitle'));
});

test('monthDayCardsHtml supports optional subtitle/meta builders for the manager board (school, time, instructor)', () => {
  const html = monthDayCardsHtml(
    [{ RowID: 'r2', activity_name: 'סדנת מדעים', instructor_name: 'רותי לוי' }],
    '2026-09-11',
    {
      subtitleText: () => 'בית ספר אורט',
      metaText: () => '10:00–11:00 · רותי לוי'
    }
  );
  assert.ok(html.includes('בית ספר אורט'));
  assert.ok(html.includes('10:00–11:00'));
  assert.ok(html.includes('ds-interactive-card__subtitle'));
});

test('monthDayCardsHtml empty state is unchanged', () => {
  const html = monthDayCardsHtml([], '2026-09-10');
  assert.ok(html.includes('אין פעילויות מתמשכות ביום זה'));
});

test('month.js reuses the shared day-session-cards module instead of a local copy', () => {
  assert.ok(monthSrc.includes("from './shared/day-session-cards.js'"));
  assert.ok(!monthSrc.includes('function monthDayCardsHtml'));
});

test('manager board shows a single title with no duplicated eyebrow', () => {
  assert.ok(!runtimeSrc.includes('manager-board-eyebrow'));
  assert.ok(runtimeSrc.includes('<h1>לוח מנהל פעילות</h1>'));
});

test('manager board KPI cards drop meetings-count and planned-hours, keep a stable-identity activity count', () => {
  const kpiBlock = runtimeSrc.slice(runtimeSrc.indexOf('manager-board-kpis">'), runtimeSrc.indexOf('manager-board-layout">'));
  assert.ok(!kpiBlock.includes('מפגשים בחודש'));
  assert.ok(!kpiBlock.includes('<span>שעות מתוכננות</span>'));
  assert.ok(runtimeSrc.includes('uniqueActivityRows.size'));
  assert.ok(runtimeSrc.includes('activity.row_id || activity.id'));
});

test('active team strip renders inside the workspace shell, filtered by manager and active flag', () => {
  assert.ok(runtimeSrc.includes('צוות המדריכים הפעיל'));
  assert.ok(runtimeSrc.includes('workspaceShellHtml(activeTeamStripHtml(activeTeamNames))'));
  assert.ok(runtimeSrc.includes('INACTIVE_INSTRUCTOR_VALUES'));
});

test('control points panel covers the selected month and the next month in one frame', () => {
  assert.ok(runtimeSrc.includes('נקודות בקרה – החודש'));
  assert.ok(runtimeSrc.includes('נקודות בקרה – חודש הבא'));
  assert.ok(runtimeSrc.includes('shiftMonth(ym, 1)'));
});

test('"תאריכים חשובים" replaces the ministry-calendar card and is not manager-filtered', () => {
  assert.ok(!runtimeSrc.includes('לוח משרד החינוך'));
  assert.ok(!runtimeSrc.includes('חגים ואירועים רלוונטיים לחודש'));
  assert.ok(runtimeSrc.includes('<h2>תאריכים חשובים</h2>'));
  assert.ok(runtimeSrc.includes('importantDateEntries(schoolEvents, data.birthdays, ym)'));
});

test('birthdays reuse the existing employee_birthdays loader instead of a new source', () => {
  assert.ok(runtimeSrc.includes("from './birthday-calendar.js'"));
  assert.ok(!runtimeSrc.includes('employee_birthdays'));
});

test('calendar day cell exposes a whole-cell click target with a clear activity count, not per-event handlers', () => {
  assert.ok(runtimeSrc.includes('data-manager-board-day'));
  assert.ok(runtimeSrc.includes('manager-board-calendar-day__count'));
});

test('active-instructor filter treats only explicit inactive markers as inactive', () => {
  assert.ok(runtimeSrc.includes("new Set(['no', 'false', '0', 'לא', 'לא פעיל', 'inactive', 'n'])"));
});

test('day cell click opens the month.js-style day drawer before any activity detail (no direct jump)', () => {
  assert.ok(interactionsSrc.includes('data-manager-board-day'));
  assert.ok(interactionsSrc.includes("from './screens/shared/day-session-cards.js'"));
  assert.ok(interactionsSrc.includes('monthsession|'));
  assert.ok(interactionsSrc.includes('activityWorkDrawerHtml'));
  assert.ok(!interactionsSrc.includes('resolveCalendarActivity'));
  assert.ok(!interactionsSrc.includes('eventDescriptor'));
});

test('management tab renders nothing async so tab round-trips cannot reflow it (layout-shift fix)', () => {
  assert.ok(workspaceSrc.includes("if (activeTab === 'management') return;"));
});

test('"דיווחים חשובים" moved to the attendance tab and is not duplicated in management', () => {
  const managementAlertsDefinitionCount = (workspaceSrc.match(/function managementAlertsHtml/g) || []).length;
  assert.equal(managementAlertsDefinitionCount, 1);
  assert.ok(!workspaceSrc.includes('function renderManagement('));
  assert.ok(workspaceSrc.includes('view.innerHTML = `${managementAlertsHtml(roster, summary)}'));
});

// "מעקב צוות" (team tracking) is now read-only: statuses come from the same roster row
// (get_manager_team_roster / manager_instructor_followup) that already powered the old checkboxes —
// no new source, no update RPC call, no change handler, no optimistic/rollback state.
const migrationSrc = fs.readFileSync(
  new URL('../supabase/migrations/20260819150000_manager_team_roster_gender.sql', import.meta.url),
  'utf8'
);

test('מעקב צוות no longer calls the update RPC or binds any change handler', () => {
  assert.ok(!workspaceSrc.includes('update_manager_instructor_followup'));
  assert.ok(!workspaceSrc.includes("addEventListener('change'"));
  assert.ok(!workspaceSrc.includes('data-manager-followup-field'));
  assert.ok(!workspaceSrc.includes('<input type="checkbox"'));
  assert.ok(!workspaceSrc.includes('function updateFollowupCheckbox'));
});

test('followup cell renders ✓ for a done status and stays empty for a missing one, straight from the roster row', () => {
  assert.ok(workspaceSrc.includes(
    "return `<td class=\"manager-workspace-followup-cell${row[field] ? ' is-done' : ''}\">${row[field] ? '<span aria-hidden=\"true\">✓</span>' : ''}</td>`;"
  ));
});

test('FEMALE + police clearance renders a blocked, content-free cell with no checkbox and no text', () => {
  assert.ok(workspaceSrc.includes("field === 'police_clearance_file_completed' && isFemaleInstructor(row)"));
  assert.ok(workspaceSrc.includes('manager-workspace-followup-cell--blocked'));
  assert.ok(workspaceSrc.includes(
    "return '<td class=\"manager-workspace-followup-cell manager-workspace-followup-cell--blocked\" aria-label=\"לא רלוונטי\"></td>';"
  ));
});

test('manager tracking reads police clearance from the SharePoint-derived roster column, not the manual followup table', () => {
  assert.ok(workspaceSrc.includes("['police_clearance_file_completed', 'אישור משטרה']"));
  assert.ok(!workspaceSrc.includes("row['police_clearance_confirmed']"));
});

test('gender check reads the real canonical field (instructor_scheduling_profiles.gender via the roster), never the instructor name', () => {
  assert.ok(workspaceSrc.includes("text(row?.gender).toLowerCase() === 'female'"));
  assert.ok(!workspaceSrc.includes('full_name.toLowerCase()'));
});

test('roster still reads through get_manager_team_roster only — no parallel data source was created for tracking', () => {
  const rpcCalls = (workspaceSrc.match(/supabase\.rpc\('([a-z_]+)'/g) || []);
  assert.deepEqual(rpcCalls, ["supabase.rpc('get_manager_team_roster'"]);
});

test('the gender migration only extends the existing roster RPC (adds a passthrough column via LEFT JOIN); no table schema changes', () => {
  assert.ok(migrationSrc.includes('create or replace function public.get_manager_team_roster'));
  assert.ok(migrationSrc.includes('left join public.instructor_scheduling_profiles sp'));
  assert.ok(migrationSrc.includes('sp.gender,'));
  assert.ok(!migrationSrc.includes('create table'));
  assert.ok(!migrationSrc.includes('alter table'));
  assert.ok(!migrationSrc.includes('add column'));
});

// 1-2) police_clearance is a canonical component at the exact SharePoint path, in every scanner/definition.
const POLICE_CLEARANCE_PATH = '01 הסכם ומסמכים/אישור משטרה';
test('police_clearance is a canonical component at 01 הסכם ומסמכים/אישור משטרה everywhere it is scanned or listed', () => {
  assert.ok(employeeFileLiveSrc.includes(`["police_clearance", "${POLICE_CLEARANCE_PATH}"]`));
  assert.ok(onboardingFolderSrc.includes(`POLICE_CLEARANCE_FOLDER_PATH = "${POLICE_CLEARANCE_PATH}"`));
  assert.ok(employeeFileUiSrc.includes("['police_clearance', 'אישור משטרה']"));
  assert.ok(employeeFileDataSrc.includes("'police_clearance',"));
  assert.ok(policeClearanceMigrationSrc.includes("'payroll_reports', 'police_clearance'"));
});

// 3-4) completion is generic itemCount>0 truth from SharePoint — police_clearance isn't special-cased away from it.
test('police_clearance completion is derived the same way as every other component: file count > 0', () => {
  assert.ok(employeeFileLiveSrc.includes('completed: itemCount > 0,'));
  assert.ok(!/police_clearance[\s\S]{0,80}completed:\s*(true|false)[,\s]/i.test(employeeFileLiveSrc));
});

// 5) FEMALE never renders as "missing" — the blocked card has no is-missing class and no ✓/text content.
test('FEMALE police_clearance card is blocked (no missing indicator, no checkmark, no status text)', () => {
  assert.ok(employeeFileUiSrc.includes("key === 'police_clearance' && isFemale"));
  // The whole blocked-branch markup is this one literal div: no is-missing class, no <span> for a ✓ mark, no status text.
  assert.ok(employeeFileUiSrc.includes('<div class="employee-file__card is-blocked" aria-label="${escapeHtml(label)}: לא רלוונטי" aria-disabled="true"></div>'));
});

// 6-7) onboarding-folder creates the SharePoint subfolder for non-female instructors only, from server-read gender.
test('onboarding-folder creates the police-clearance folder for non-female instructors, skips it for female', () => {
  assert.ok(onboardingFolderSrc.includes('const isFemale = clean(snapshot?.gender).toLowerCase() === "female";'));
  assert.ok(onboardingFolderSrc.includes('const folderPaths = isFemale ? FOLDER_PATHS : [...FOLDER_PATHS, POLICE_CLEARANCE_FOLDER_PATH];'));
  assert.ok(onboardingFolderSrc.includes('for (const relativePath of folderPaths) {'));
});

test('gender for onboarding-folder/employee-file comes from the server-side snapshot RPC, never a client value or the instructor name', () => {
  assert.ok(policeClearanceMigrationSrc.includes('select sp.gender into v_gender from public.instructor_scheduling_profiles sp where sp.emp_id = p_emp_id;'));
  assert.ok(policeClearanceMigrationSrc.includes("'gender', v_gender"));
  assert.ok(!onboardingFolderSrc.includes('body?.gender'));
});

// 8) Manager Tracking already covered above (police_clearance_file_completed roster column + isFemaleInstructor block).

// New required "מגדר" field in the onboarding modal, saved atomically into instructor_scheduling_profiles.gender.
test('onboarding modal has a required gender select with canonical male/female values (no Hebrew stored)', () => {
  assert.ok(onboardingSrc.includes('<label><span>מגדר</span><select class="ds-input" data-onboarding-gender required><option value="">בחירה</option><option value="male">זכר</option><option value="female">נקבה</option></select></label>'));
});

test('onboarding cannot complete ("שליחת מייל") without a gender selection', () => {
  assert.ok(onboardingSrc.includes('|| !gender.value || !employment.value'));
  assert.ok(onboardingSrc.includes("if (!fullName.value.trim() || !normalizedPhone || !email.value.trim() || !gender.value || !employment.value"));
});

test('the chosen gender value is passed to create_instructor_onboarding unchanged (male stays male, female stays female)', () => {
  assert.ok(onboardingSrc.includes("const gender = ['male', 'female'].includes(instructor?.gender) ? instructor.gender : '';"));
  assert.ok(onboardingSrc.includes('if (!phone || !gender) throw new Error'));
  assert.ok(onboardingSrc.includes('p_gender: gender'));
});

test('create_instructor_onboarding rejects any gender value other than male/female, server-side, and replaces the old signature', () => {
  assert.ok(onboardingGenderMigrationSrc.includes('drop function if exists public.create_instructor_onboarding(text, text, text, text, text);'));
  assert.ok(onboardingGenderMigrationSrc.includes("if v_gender not in ('male', 'female') then"));
  assert.ok(onboardingGenderMigrationSrc.includes("raise exception 'onboarding_gender_invalid'"));
});

test('gender is written into instructor_scheduling_profiles.gender for a new instructor only, not a new column on contacts_instructors', () => {
  assert.ok(onboardingGenderMigrationSrc.includes('insert into public.instructor_scheduling_profiles (emp_id, gender)'));
  assert.ok(onboardingGenderMigrationSrc.includes('values (v_emp_id, v_gender)'));
  assert.ok(!onboardingGenderMigrationSrc.includes('contacts_instructors add column'));
});

test('a duplicate onboarding attempt returns the existing instructor and never touches their stored gender', () => {
  const foundBranch = onboardingGenderMigrationSrc.indexOf('if found then');
  const genderInsert = onboardingGenderMigrationSrc.indexOf('insert into public.instructor_scheduling_profiles');
  assert.ok(foundBranch > -1 && genderInsert > -1 && foundBranch < genderInsert);
  assert.ok(onboardingGenderMigrationSrc.includes('return query select v_existing.emp_id::bigint, v_existing.full_name::text, true;\n    return;\n  end if;'));
});

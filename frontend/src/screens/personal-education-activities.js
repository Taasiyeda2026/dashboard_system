import { PERSONAL_EDUCATION_ROUTE, isPersonalEducationViewer } from '../personal-education-access.js';
import { activityRowsForPeriodAndMonth, displayActivityName, getActivitySchoolDisplayName, activityLayoutClassGroup, normalizedActivityStatus, normalizedActivityStartDate } from './activities.js';
import { activityManagementSummary } from './shared/activity-management-summary.js';
import { cleanActivityManagerName, resolveActivityInstructorName, activityTypeDisplayLabel } from './shared/activity-options.js';
import { ACTIVITY_SEASON_SCHOOL_2027 } from './shared/summer-activity.js';
import { escapeHtml } from './shared/html.js';
import { formatDateHe, formatTimeRangeShort, formatActivityDateColumnsHe } from './shared/format-date.js';

const clean = value => {
  const s = String(value ?? '').trim();
  return /^(?:[-—–]|לא משויך|ללא|ללא מדריך|ללא מנהל|null|undefined)$/i.test(s) ? '' : s;
};
const normalize = value => String(value ?? '').trim().toLocaleLowerCase('he');
const cmp = (a,b) => a.localeCompare(b, 'he', { numeric: true });
const esc = value => escapeHtml(String(value ?? ''));
const unique = values => [...new Set(values.filter(Boolean))].sort(cmp);

// Reuse precisely the existing All Activities 2027 selection and existing
// progress calculation. Only the minimal education-facing projection is kept.
export function projectEducationActivities(rows, user, today) {
  if (!isPersonalEducationViewer(user)) return [];
  return activityRowsForPeriodAndMonth(Array.isArray(rows) ? rows : [], {
    activityPeriodTab: ACTIVITY_SEASON_SCHOOL_2027,
    activitiesInnerTab: 'year_all',
    user
  }).map(row => {
    const progress = activityManagementSummary(row, today);
    const instructors = unique([resolveActivityInstructorName(row), resolveActivityInstructorName(row, {secondary:true})].map(clean));
    const start = normalizedActivityStartDate(row);
    const end = progress.end;
    const next = progress.next;
    const dates = clean(formatActivityDateColumnsHe(row));
    return {
      name: displayActivityName(row),
      type: clean(activityTypeDisplayLabel(row.activity_type)),
      school: clean(getActivitySchoolDisplayName(row)),
      authority: clean(row.authority),
      group: clean(activityLayoutClassGroup(row)),
      manager: cleanActivityManagerName(row.activity_manager),
      instructors,
      status: clean(normalizedActivityStatus(row)),
      start, end, next,
      total: progress.total,
      elapsed: progress.elapsed,
      hours: clean(formatTimeRangeShort(row.start_time, row.end_time)),
      dates
    };
  }).sort((a,b) => cmp(a.name,b.name) || cmp(a.school,b.school) || cmp(a.group,b.group));
}

export function filterEducationActivities(rows, filters = {}) {
  const terms = normalize(filters.q).split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    const searchable = normalize([row.name,row.school,row.authority,row.group,row.manager,row.status,...row.instructors].join(' '));
    return terms.every(term => searchable.includes(term))
      && (!filters.program || row.name === filters.program)
      && (!filters.instructor || row.instructors.includes(filters.instructor))
      && (!filters.manager || row.manager === filters.manager)
      && (!filters.status || row.status === filters.status);
  });
}

function fields(label, value) {
  return value ? `<div><small>${esc(label)}</small><span>${esc(value)}</span></div>` : '';
}

function card(row) {
  const location = [row.school,row.authority,row.group].filter(Boolean).join(' · ');
  const staff = [fields('מדריך/ה', row.instructors.join(' · ')),fields('מנהל פעילות',row.manager)].join('');
  const pct = row.total ? Math.min(100, Math.max(0, Math.round(row.elapsed/row.total*100))) : 0;
  const progress = row.total ? `<div class="edu-progress"><div><small>התקדמות הקורס</small><strong><bdi>${row.elapsed}/${row.total}</bdi></strong></div><div class="edu-track" role="progressbar" aria-label="התקדמות הקורס" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div></div>` : '';
  const schedule = new Map();
  for (const [label, value] of [['התחלה',row.start],['מפגש הבא',row.next],['סיום',row.end]]) {
    if (value) schedule.set(value, schedule.has(value) ? schedule.get(value) + ' / ' + label : label);
  }
  const dates = [...schedule].map(([value,label])=>fields(label,formatDateHe(value))).join('');
  return `<article class="edu-card">
    <header><h3>${esc(row.name)}</h3>${row.status ? `<span class="edu-status">${esc(row.status)}</span>` : ''}</header>
    ${location ? `<p class="edu-location">${esc(location)}</p>` : ''}
    ${staff ? `<div class="edu-fields">${staff}</div>` : ''}
    ${progress}
    ${dates ? `<div class="edu-fields edu-dates">${dates}</div>` : ''}
    ${row.type || row.hours || row.dates ? `<details class="edu-details"><summary>פרטי פעילות</summary>${row.type ? fields('סוג פעילות',row.type) : ''}${fields('שעות',row.hours)}${row.dates ? `<p><small>תאריכי מפגשים</small><span>${esc(row.dates)}</span></p>` : ''}</details>` : ''}
  </article>`;
}

export function educationListHtml(rows, group = 'all') {
  if (!rows.length) return '<p class="edu-empty" role="status">לא נמצאו פעילויות בהתאם לסינון.</p>';
  if (group === 'all') return `<div class="edu-grid">${rows.map(card).join('')}</div>`;
  const groups = new Map();
  for (const row of rows) {
    // Team teaching: place the activity once, under the displayed team name.
    const key = group === 'program' ? row.name : row.instructors.join(' · ') || 'ללא מדריך';
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  return [...groups.entries()].sort(([a],[b])=>cmp(a,b)).map(([label,items])=>`<section class="edu-group"><h2>${esc(label)} <span>${items.length}</span></h2><div class="edu-grid">${items.map(card).join('')}</div></section>`).join('');
}

function options(label, key, values) {
  return `<label><span>${esc(label)}</span><select data-edu-filter="${key}"><option value="">הכל</option>${unique(values).map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('')}</select></label>`;
}

function renderEducation(data, user, routes) {
  if (!isPersonalEducationViewer(user)) return '<p role="alert">אין הרשאה לתצוגה זו.</p>';
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const allowed = new Set(routes || []);
  return `<section class="edu-screen" dir="rtl" aria-label="מבט חינוכי – פעילויות תשפ״ז">
    <header class="edu-head"><div><h1>פעילויות תשפ״ז</h1><p>תמונת מצב חינוכית</p></div><div class="edu-nav">
      ${allowed.has('dashboard') ? '<button type="button" data-route="dashboard">לדשבורד הרגיל</button>' : ''}
      ${allowed.has('activities') ? '<button type="button" data-route="activities">ניהול פעילויות</button>' : ''}
      <button type="button" data-edu-logout>יציאה</button>
    </div></header>
    <div class="edu-stats">
      <div><strong>${rows.length}</strong><span>כל הפעילויות</span></div>
      <div><strong>${unique(rows.map(row=>row.name)).length}</strong><span>תוכניות</span></div>
      <div><strong>${unique(rows.flatMap(row=>row.instructors)).length}</strong><span>מדריכים ברשימה</span></div>
    </div>
    <div class="edu-tools">
      <label class="edu-search"><span>חיפוש</span><input type="search" data-edu-query placeholder="תוכנית, מוסד, רשות או מדריך"></label>
      <div class="edu-modes" role="group" aria-label="אופן הצגה">
        <button type="button" data-edu-group="all" aria-pressed="true">כל הפעילויות</button>
        <button type="button" data-edu-group="program" aria-pressed="false">לפי תוכנית</button>
        <button type="button" data-edu-group="instructor" aria-pressed="false">לפי מדריך</button>
      </div>
      <details class="edu-filters"><summary>סינון</summary><div>
        ${options('תוכנית','program',rows.map(row=>row.name))}
        ${options('מדריך','instructor',rows.flatMap(row=>row.instructors))}
        ${options('מנהל פעילות','manager',rows.map(row=>row.manager))}
        ${options('סטטוס','status',rows.map(row=>row.status))}
        <button type="button" data-edu-reset>ניקוי סינון</button>
      </div></details>
    </div>
    <p class="edu-result" data-edu-count aria-live="polite">${rows.length} פעילויות</p>
    <div data-edu-list>${educationListHtml(rows)}</div>
  </section>`;
}

export const personalEducationActivitiesScreen = {
  async load({api,state}) {
    if (!isPersonalEducationViewer(state?.user)) return {rows:[]};
    const result = await api.activities({activity_type:'all',include_inactive:true,activity_period:ACTIVITY_SEASON_SCHOOL_2027});
    return { rows: projectEducationActivities(result?.rows,state.user) };
  },
  render(data,{state}) {
    return renderEducation(data,state?.user,state?.routes);
  },
  bind({root,data,state}) {
    if (!isPersonalEducationViewer(state?.user) || state.route !== PERSONAL_EDUCATION_ROUTE) return;
    const screen = root.querySelector('.edu-screen');
    if (!screen) return;
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const filters = {};
    let group = 'all';
    const refresh = () => {
      const filtered = filterEducationActivities(rows, filters);
      screen.querySelector('[data-edu-count]').textContent = `${filtered.length} פעילויות`;
      screen.querySelector('[data-edu-list]').innerHTML = educationListHtml(filtered, group);
    };
    screen.querySelector('[data-edu-query]').addEventListener('input',event=>{filters.q=event.target.value;refresh();});
    screen.querySelectorAll('[data-edu-filter]').forEach(select=>select.addEventListener('change',()=>{filters[select.dataset.eduFilter]=select.value;refresh();}));
    screen.querySelectorAll('[data-edu-group]').forEach(button=>button.addEventListener('click',()=>{
      group = button.dataset.eduGroup;
      screen.querySelectorAll('[data-edu-group]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
      refresh();
    }));
    screen.querySelector('[data-edu-reset]').addEventListener('click',()=>{
      Object.keys(filters).forEach(key=>delete filters[key]);
      screen.querySelector('[data-edu-query]').value='';
      screen.querySelectorAll('[data-edu-filter]').forEach(select=>select.value='');
      refresh();
    });
    screen.querySelector('[data-edu-logout]').addEventListener('click',()=>root.ownerDocument.getElementById('logoutBtn')?.click());
  }
};

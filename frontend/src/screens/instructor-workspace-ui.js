import { escapeHtml } from './shared/html.js';
import { dsEmptyState, dsStatusChip } from './shared/layout.js';
import { formatDateHe, formatTimeRangeShort } from './shared/format-date.js';
import { activityTypeIconSvg } from './shared/activity-type-icons.js';
import { INSTRUCTOR_WEEKDAYS } from './instructor-scheduling-data.js';
import { formatInstructorSeniority, instructorSeniorityValues } from './instructor-seniority.js';

export function text(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function activeFlag(value) {
  if (value === false || value === 0) return 'no';
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['no', 'false', '0'].includes(normalized) ? 'no' : 'yes';
}

export function assigned(row) {
  return !!row?.has_activity_stats || Number(row?.programs_count || 0) + Number(row?.one_day_count || 0) > 0;
}

const TYPES = [
  { keys: ['course', 'קורס', 'קורסים'], label: 'קורסים', icon: 'course' },
  { keys: ['workshop', 'סדנה', 'סדנאות'], label: 'סדנאות', icon: 'workshop' },
  { keys: ['escape_room', 'escape room', 'חדר בריחה'], label: 'חדרי בריחה', icon: 'escape_room' },
  { keys: ['tour', 'סיור', 'סיורים'], label: 'סיורים', icon: 'tour' },
  { keys: ['after_school', 'אפטרסקול'], label: 'אפטרסקול', icon: 'after_school' }
];

export function instructorCard(row) {
  const counts = row.activity_type_counts || {};
  const stats = TYPES.map(({ keys, label, icon }) => {
    const count = keys.reduce((sum, key) => sum + Number(counts[key] || 0), 0);
    return `<span title="${escapeHtml(label)}" style="display:inline-flex;align-items:center;gap:4px;color:#536278"><span aria-hidden="true">${activityTypeIconSvg(icon, 14)}</span><strong>${count}</strong></span>`;
  }).join('');
  return `<button type="button" class="ds-card" data-instructor-profile="${escapeHtml(row.emp_id)}" data-instructor-card="${escapeHtml(row.emp_id)}" style="text-align:right;padding:0;border:1px solid #dfe7f1;background:#fff;cursor:pointer;min-height:138px">
    <span style="display:grid;gap:12px;padding:16px">
      <span style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
        <span style="display:grid;gap:4px;min-width:0"><strong style="font-size:1.02rem;color:#172235">${escapeHtml(text(row.full_name || row.emp_id) || '—')}</strong><span style="font-size:.82rem;color:#69778b">${escapeHtml(row.emp_id || '')}</span></span>
        <span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${dsStatusChip(activeFlag(row.active) === 'yes' ? 'פעיל' : 'לא פעיל', activeFlag(row.active) === 'yes' ? 'success' : 'neutral')}${dsStatusChip(assigned(row) ? 'משובץ' : 'לא משובץ', assigned(row) ? 'info' : 'neutral')}${text(row.address) ? '' : '<span class="ds-status-chip ds-status-chip--warning">חסרה כתובת</span>'}</span>
      </span>
      <span style="display:flex;gap:13px;align-items:center;flex-wrap:wrap;border-top:1px solid #edf1f6;padding-top:11px">${stats}</span>
    </span>
  </button>`;
}

function field(label, value, dir = 'rtl') {
  const displayValue = text(value) || '—';
  return `<div class="instructor-profile__field"><span class="instructor-profile__field-label">${escapeHtml(label)}</span><span class="instructor-profile__field-value${displayValue === '—' || displayValue === 'ללא' || displayValue === 'לא הוגדר' ? ' instructor-profile__field-value--muted' : ''}" dir="${dir}">${escapeHtml(displayValue)}</span></div>`;
}

function timeRangeHtml(start, end, className = 'instructor-time-range') {
  return `<bdi class="${className}" dir="ltr">${escapeHtml(formatTimeRangeShort(start, end))}</bdi>`;
}

function weeklySummary(row) {
  const byDay = new Map((row.availability_rules || []).map((rule) => [Number(rule.weekday), rule]));
  return INSTRUCTOR_WEEKDAYS.map((day) => {
    const rule = byDay.get(day.value);
    if (day.value === 6) return `<div>${escapeHtml(day.label)}: חסום</div>`;
    if (!rule) return `<div>${escapeHtml(day.label)}: טרם הוגדר</div>`;
    if (!rule.available) return `<div>${escapeHtml(day.label)}: לא זמין</div>`;
    return `<div>${escapeHtml(day.label)}: ${timeRangeHtml(rule.start_time, rule.end_time)}</div>`;
  });
}

export function schedulingProfileMissingFields(row = {}) {
  const profile = row.scheduling_profile;
  const missing = [];
  if (!text(row.address)) missing.push('כתובת');
  if (!profile?.gender) missing.push('מגדר');
  if (!profile?.instruction_languages?.length) missing.push('שפות הדרכה');
  if (!profile?.education_levels?.length) missing.push('שכבות גיל');
  if (!profile || !Object.prototype.hasOwnProperty.call(profile, 'course_restriction_mode')) missing.push('התאמה לקורסים');
  if (!row.availability_rules?.length) missing.push('זמינות שבועית');
  return missing;
}

function activitiesHtml(items) {
  if (!items.length) return dsEmptyState('אין פעילויות פעילות או עתידיות למדריך זה');
  return `<div style="overflow:auto"><table class="ds-table" dir="rtl"><thead><tr><th>פעילות</th><th>בית ספר</th><th>רשות</th><th>תקופה</th></tr></thead><tbody>${items.map((item) => {
    const id = text(item.row_id || item.RowID || item.source_row_id);
    const start = item.start_date ? formatDateHe(item.start_date) : '—';
    const end = item.end_date ? formatDateHe(item.end_date) : '';
    return `<tr><td><button type="button" class="ds-link-btn" data-open-instructor-activity="${escapeHtml(id)}">${escapeHtml(item.activity_name || '—')}</button></td><td>${escapeHtml(item.school || '—')}</td><td>${escapeHtml(item.authority || '—')}</td><td>${escapeHtml(end ? `${start}–${end}` : start)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

export function profileHtml(row, activities, canEdit, schedulingLoaded) {
  const profile = row.scheduling_profile || {};
  const exceptions = row.availability_exceptions || [];
  const profileMissing = schedulingProfileMissingFields(row);
  const statuses = [row.active === 'yes' ? 'פעיל' : 'לא פעיל', assigned(row) ? 'משובץ' : 'לא משובץ', profileMissing.length ? 'חסרים נתונים לשיבוץ' : 'פרופיל שיבוץ מלא'];
  return `<div dir="rtl" class="instructor-profile">
    <section class="instructor-profile__identity"><strong class="instructor-profile__name">${escapeHtml(row.full_name || row.emp_id)}</strong><span class="instructor-profile__id">${escapeHtml(row.emp_id || '')}</span><p class="instructor-profile__status-line" data-instructor-status-line>${statuses.map(escapeHtml).join(' | ')}</p></section>${profileMissing.length ? `<p class="scheduling-warning"><b>חסר להשלמה:</b> ${escapeHtml(profileMissing.join(', '))}.</p>` : ''}
    <section class="instructor-profile__section"><div class="instructor-profile__section-head"><h3>פרטי מדריך</h3>${canEdit ? '<button type="button" class="ds-btn ds-btn--sm instructor-profile__action" data-edit-instructor-contact>עריכת פרטים</button>' : ''}</div><div class="instructor-profile__fields">${field('נייד', row.mobile || row.phone, 'ltr')}${field('דוא״ל', row.email, 'ltr')}${field('כתובת', row.address)}${field('סוג העסקה', row.employment_type)}${field('ותק', formatInstructorSeniority(row.seniority_years))}${field('מנהל ישיר', row.direct_manager)}</div></section>
    <section class="instructor-profile__section"><div class="instructor-profile__section-head"><h3>זמינות ואילוצים</h3>${canEdit ? '<button type="button" class="ds-btn ds-btn--sm ds-btn--primary instructor-profile__action" data-edit-instructor-constraints>עדכון אילוצים</button>' : ''}</div>${schedulingLoaded ? `<div class="instructor-profile__availability">${weeklySummary(row).join('')}</div><div class="ds-muted">ברירת מחדל: ${timeRangeHtml(profile.default_start_time || '08:00', profile.default_end_time || '15:00')} · יום שישי: ${profile.friday_allowed ? 'מאושר' : 'חריג בלבד'} · ${exceptions.length} חריגים</div>` : '<p class="ds-muted">אזור האילוצים אינו זמין לחשבון זה.</p>'}</section>
    <section style="display:grid;gap:10px"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">התאמה לשיבוץ</h3>${canEdit ? '<button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-edit-instructor-matching>עריכת התאמה</button>' : ''}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:9px">${field('מגדר', profile.gender === 'female' ? 'מדריכה' : profile.gender === 'male' ? 'מדריך' : 'טרם הוגדר')}${field('שפות הדרכה', (profile.instruction_languages || []).map(v => v === 'he' ? 'עברית' : 'ערבית').join(', '))}${field('שכבות גיל', (profile.education_levels || []).map(v => ({elementary:'יסודי',middle_school:'חטיבת ביניים',high_school:'תיכון'}[v] || v)).join(', '))}${field('הגבלת קורסים', ({all:'כל הקורסים',allow_only:'רק קורסים נבחרים',block_selected:'חסום מקורסים נבחרים'}[profile.course_restriction_mode] || 'כל הקורסים'))}</div>${profile.matching_note ? `<p class="ds-muted">הערה פנימית: ${escapeHtml(profile.matching_note)}</p>` : ''}</section>
    <section style="display:grid;gap:10px"><h3 style="margin:0">פעילויות פעילות ועתידיות <span class="ds-badge">${activities.length}</span></h3>${activitiesHtml(activities)}</section>
  </div>`;
}

export function matchingForm(row, options = {}) {
  const p = row.scheduling_profile || {};
  const checked = (items, value) => (items || []).includes(value) ? ' checked' : '';
  const choice = (name, value, label, current) => `<label class="instructor-matching__choice"><input type="radio" name="${name}" value="${value}"${current === value ? ' checked' : ''}><span>${label}</span></label>`;
  const multi = (name, values, items, placeholder) => {
    const selected = new Set((values || []).map(String));
    const normalized = [...(items || [])];
    for (const value of selected) if (!normalized.some(item => String(item.value) === value)) normalized.push({ value, label: `${value} (ערך קיים)` });
    return `<div class="instructor-multiselect" data-multiselect="${name}">
      <div class="instructor-multiselect__tags" data-multiselect-tags></div>
      <input class="ds-input instructor-multiselect__search" type="search" autocomplete="off" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)}" aria-expanded="false" data-multiselect-search>
      <div class="instructor-multiselect__menu" data-multiselect-menu hidden>${normalized.map(item => `<label class="instructor-multiselect__option" data-search-text="${escapeHtml(text(item.label).toLowerCase())}"><input type="checkbox" name="${name}" value="${escapeHtml(item.value)}" data-option-label="${escapeHtml(item.label)}"${selected.has(String(item.value)) ? ' checked' : ''}><span>${escapeHtml(item.label)}</span></label>`).join('') || '<p class="instructor-multiselect__empty">אין אפשרויות זמינות</p>'}</div>
    </div>`;
  };
  const mode = ['all', 'allow_only', 'block_selected'].includes(p.course_restriction_mode) ? p.course_restriction_mode : 'all';
  return `<form class="instructor-matching" dir="rtl" data-instructor-matching-form>
    <section class="instructor-matching__card"><h3>התאמה בסיסית</h3><div class="instructor-matching__basic-grid"><fieldset><legend>מגדר</legend><div class="instructor-matching__choices">${choice('gender','','טרם הוגדר',p.gender || '')}${choice('gender','female','מדריכה',p.gender || '')}${choice('gender','male','מדריך',p.gender || '')}</div></fieldset><fieldset><legend>שפות הדרכה</legend><div class="instructor-matching__choices"><label class="instructor-matching__choice"><input type="checkbox" name="language" value="he"${checked(p.instruction_languages,'he')}><span>עברית</span></label><label class="instructor-matching__choice"><input type="checkbox" name="language" value="ar"${checked(p.instruction_languages,'ar')}><span>ערבית</span></label></div></fieldset><fieldset><legend>שכבות גיל</legend><div class="instructor-matching__choices"><label class="instructor-matching__choice"><input type="checkbox" name="education_level" value="elementary"${checked(p.education_levels,'elementary')}><span>יסודי</span></label><label class="instructor-matching__choice"><input type="checkbox" name="education_level" value="middle_school"${checked(p.education_levels,'middle_school')}><span>חטיבת ביניים</span></label><label class="instructor-matching__choice"><input type="checkbox" name="education_level" value="high_school"${checked(p.education_levels,'high_school')}><span>תיכון</span></label></div></fieldset></div></section>
    <section class="instructor-matching__card"><h3>התאמה לקורסים</h3><div class="instructor-matching__choices instructor-matching__choices--modes">${choice('course_restriction_mode','all','מתאים לכל הקורסים',mode)}${choice('course_restriction_mode','allow_only','מתאים רק לקורסים נבחרים',mode)}${choice('course_restriction_mode','block_selected','חסום מקורסים נבחרים',mode)}</div><div class="instructor-matching__course-picker" data-course-picker${mode === 'all' ? ' hidden' : ''}><h4 data-course-picker-title>${mode === 'block_selected' ? 'קורסים חסומים' : 'קורסים מותרים'}</h4>${multi('course_ids',p.course_ids,options.courses,'חיפוש קורס לפי שם או מספר…')}</div></section>
    <section class="instructor-matching__card"><h3>חסימות גאוגרפיות</h3><div class="instructor-matching__geo-grid"><div><h4>רשויות חסומות</h4>${multi('blocked_authorities',p.blocked_authorities,options.authorities,'חיפוש לפי שם רשות…')}</div><div><h4>בתי ספר חסומים</h4>${multi('blocked_schools',p.blocked_schools,options.schools,'חיפוש לפי שם בית ספר…')}</div></div></section>
    <section class="instructor-matching__card"><h3>הערה פנימית</h3><label class="instructor-matching__note"><span>הערת התאמה פנימית</span><textarea class="ds-input" name="matching_note" rows="4">${escapeHtml(p.matching_note || '')}</textarea><small>ההערה מיועדת לצוות התפעול ואינה מוצגת למדריך/ה.</small></label></section>
    <p class="instructor-matching__status" role="alert" data-matching-status hidden></p>
  </form>`;
}

export function contactForm(row) {
  const input = (label, name, value, type = 'text', dir = 'rtl') => `<label style="display:grid;gap:5px"><span class="ds-muted">${escapeHtml(label)}</span><input class="ds-input" type="${type}" name="${name}" value="${escapeHtml(value || '')}" dir="${dir}"></label>`;
  const select = (label, name, value, options) => `<label style="display:grid;gap:5px"><span class="ds-muted">${escapeHtml(label)}</span><select class="ds-input" name="${name}">${options.map((option) => `<option value="${escapeHtml(option.value)}"${String(option.value) === String(value ?? '') ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></label>`;
  const seniorityOptions = [{ value: '', label: 'לא הוגדר' }, ...instructorSeniorityValues().map((year) => ({ value: String(year), label: String(year) }))];
  return `<div dir="rtl" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">${input('שם מלא','full_name',row.full_name)}${input('נייד','mobile',row.mobile,'tel','ltr')}${input('דוא״ל','email',row.email,'email','ltr')}${input('כתובת','address',row.address)}${input('סוג העסקה','employment_type',row.employment_type)}${select('ותק','seniority_years',row.seniority_years,seniorityOptions)}${input('מנהל ישיר','direct_manager',row.direct_manager)}<label style="display:grid;gap:5px"><span class="ds-muted">סטטוס</span><select class="ds-input" name="active"><option value="yes"${row.active === 'yes' ? ' selected' : ''}>פעיל</option><option value="no"${row.active === 'no' ? ' selected' : ''}>לא פעיל</option></select></label><p class="ds-muted" data-instructor-form-status style="grid-column:1/-1;margin:0"></p></div>`;
}

function defaultRule(row, weekday) {
  const hit = (row.availability_rules || []).find((rule) => Number(rule.weekday) === weekday);
  if (hit) return hit;
  const profile = row.scheduling_profile || {};
  return { weekday, available: weekday <= 4, start_time: profile.default_start_time || '08:00', end_time: profile.default_end_time || '15:00' };
}

export function constraintsForm(row) {
  const profile = row.scheduling_profile || {};
  const weekly = INSTRUCTOR_WEEKDAYS.map((day) => {
    const rule = defaultRule(row, day.value);
    const saturday = day.value === 6;
    const disabled = saturday || !rule.available;
    return `<div class="instructor-constraints__day" data-weekday-row="${day.value}"><strong>${escapeHtml(day.label)}</strong><label class="instructor-constraints__available"><input type="checkbox" name="available"${rule.available && !saturday ? ' checked' : ''}${saturday ? ' disabled' : ''}> ${saturday ? 'חסום' : 'זמין'}</label><label><span>משעה</span><input class="ds-input ds-input--sm" type="time" name="start_time" value="${escapeHtml(String(rule.start_time || '08:00').slice(0,5))}"${disabled ? ' disabled' : ''}></label><label><span>עד שעה</span><input class="ds-input ds-input--sm" type="time" name="end_time" value="${escapeHtml(String(rule.end_time || '15:00').slice(0,5))}"${disabled ? ' disabled' : ''}></label></div>`;
  }).join('');
  const exceptions = (row.availability_exceptions || []).map((item) => `<div class="instructor-constraints__exception"><span><strong>${escapeHtml(formatDateHe(item.exception_date))}</strong> — ${item.available ? `זמין ${timeRangeHtml(item.start_time, item.end_time)}` : 'חסום'}${item.notes ? ` · ${escapeHtml(item.notes)}` : ''}</span><button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-delete-availability-exception="${escapeHtml(item.id)}">מחיקה</button></div>`).join('');
  return `<form class="instructor-constraints" dir="rtl" data-instructor-constraints-form>
    <section class="instructor-constraints__card"><h3>שעות ברירת מחדל</h3><div class="instructor-constraints__defaults"><label><span>שעת התחלה</span><input class="ds-input" type="time" name="default_start_time" value="${escapeHtml(String(profile.default_start_time || '08:00').slice(0,5))}"></label><label><span>שעת סיום</span><input class="ds-input" type="time" name="default_end_time" value="${escapeHtml(String(profile.default_end_time || '15:00').slice(0,5))}"></label><label class="instructor-constraints__friday"><input type="checkbox" name="friday_allowed"${profile.friday_allowed ? ' checked' : ''}> אישור שיבוץ ביום שישי כחריג</label></div><label class="instructor-constraints__notes"><span>הערה פנימית</span><textarea class="ds-input" name="notes" rows="2">${escapeHtml(profile.notes || '')}</textarea></label></section>
    <section class="instructor-constraints__card"><h3>עומס שבועי</h3><p class="ds-muted">לא חובה — כשלא מוגדר, העומס מחושב לפי הזמינות השבועית בלבד.</p><div class="instructor-constraints__defaults"><label><span>יעד שעות שבועי</span><input class="ds-input" type="number" min="0" step="0.5" name="weekly_target_hours" value="${escapeHtml(profile.weekly_target_hours ?? '')}" placeholder="לפי זמינות"></label><label><span>מקסימום שעות שבועי</span><input class="ds-input" type="number" min="0" step="0.5" name="weekly_max_hours" value="${escapeHtml(profile.weekly_max_hours ?? '')}" placeholder="לפי זמינות"></label><label><span>ימי עבודה רצויים</span><input class="ds-input" type="number" min="1" max="7" step="1" name="preferred_work_days" value="${escapeHtml(profile.preferred_work_days ?? '')}" placeholder="ללא הגבלה"></label><label><span>מקסימום קורסים קבועים</span><input class="ds-input" type="number" min="0" step="1" name="max_fixed_courses" value="${escapeHtml(profile.max_fixed_courses ?? '')}" placeholder="ללא הגבלה"></label></div></section>
    <section class="instructor-constraints__card"><h3>זמינות שבועית</h3><div class="instructor-constraints__week">${weekly}</div></section>
    <section class="instructor-constraints__card"><h3>חריגים לפי תאריך</h3><div class="instructor-constraints__exceptions">${exceptions || '<span class="ds-muted">לא הוגדרו חריגים.</span>'}</div><div class="instructor-constraints__exception-form"><label>תאריך<input class="ds-input ds-input--sm" type="date" name="exception_date"></label><label>סוג<select class="ds-input ds-input--sm" name="exception_available"><option value="no">חסום</option><option value="yes">זמין בשעות מיוחדות</option></select></label><label>משעה<input class="ds-input ds-input--sm" type="time" name="exception_start_time" value="08:00"></label><label>עד שעה<input class="ds-input ds-input--sm" type="time" name="exception_end_time" value="15:00"></label><label class="instructor-constraints__exception-note">הערה<input class="ds-input ds-input--sm" name="exception_notes"></label><button type="button" class="ds-btn ds-btn--sm" data-add-availability-exception>הוספת חריג</button></div></section>
    <p class="instructor-constraints__status" role="alert" data-constraints-status hidden></p>
  </form>`;
}

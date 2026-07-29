import { escapeHtml } from './shared/html.js';
import { dsEmptyState, dsStatusChip } from './shared/layout.js';
import { formatDateHe } from './shared/format-date.js';
import { activityTypeIconSvg } from './shared/activity-type-icons.js';
import { INSTRUCTOR_WEEKDAYS } from './instructor-scheduling-data.js';

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
  return `<div style="display:grid;gap:4px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:12px;background:#fff"><span style="font-size:.78rem;font-weight:750;color:#657286">${escapeHtml(label)}</span><span dir="${dir}" style="font-weight:650;color:#243247;overflow-wrap:anywhere">${escapeHtml(text(value) || '—')}</span></div>`;
}

function weeklySummary(row) {
  const byDay = new Map((row.availability_rules || []).map((rule) => [Number(rule.weekday), rule]));
  return INSTRUCTOR_WEEKDAYS.map((day) => {
    const rule = byDay.get(day.value);
    if (day.value === 6) return `${day.label}: חסום`;
    if (!rule) return `${day.label}: טרם הוגדר`;
    if (!rule.available) return `${day.label}: לא זמין`;
    return `${day.label}: ${String(rule.start_time || '').slice(0, 5)}–${String(rule.end_time || '').slice(0, 5)}`;
  });
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
  return `<div dir="rtl" style="display:grid;gap:18px">
    <section style="display:flex;justify-content:space-between;gap:12px;padding:15px;border:1px solid #dce7f2;border-radius:16px;background:linear-gradient(135deg,#f8fbff,#eef6ff)"><span style="display:grid;gap:5px"><strong style="font-size:1.2rem">${escapeHtml(row.full_name || row.emp_id)}</strong><span class="ds-muted">${escapeHtml(row.emp_id || '')}</span></span><span style="display:flex;gap:7px;flex-wrap:wrap">${dsStatusChip(row.active === 'yes' ? 'פעיל' : 'לא פעיל', row.active === 'yes' ? 'success' : 'neutral')}${dsStatusChip(assigned(row) ? 'משובץ' : 'לא משובץ', assigned(row) ? 'info' : 'neutral')}</span></section>
    <section style="display:grid;gap:10px"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">פרטי מדריך</h3>${canEdit ? '<button type="button" class="ds-btn ds-btn--sm" data-edit-instructor-contact>עריכת פרטים</button>' : ''}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:9px">${field('נייד', row.mobile || row.phone, 'ltr')}${field('דוא״ל', row.email, 'ltr')}${field('כתובת', row.address)}${field('סוג העסקה', row.employment_type)}${field('מנהל ישיר', row.direct_manager)}</div></section>
    <section style="display:grid;gap:10px"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">זמינות ואילוצים</h3>${canEdit ? '<button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-edit-instructor-constraints>עדכון אילוצים</button>' : ''}</div>${schedulingLoaded ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px">${weeklySummary(row).map((value) => `<div style="padding:9px 11px;border-radius:10px;background:#f6f8fb">${escapeHtml(value)}</div>`).join('')}</div><div class="ds-muted">ברירת מחדל: ${escapeHtml(String(profile.default_start_time || '08:00').slice(0,5))}–${escapeHtml(String(profile.default_end_time || '15:00').slice(0,5))} · יום שישי: ${profile.friday_allowed ? 'מאושר' : 'חריג בלבד'} · ${exceptions.length} חריגים</div>` : '<p class="ds-muted">אזור האילוצים אינו זמין לחשבון זה.</p>'}</section>
    <section style="display:grid;gap:10px"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">התאמה לשיבוץ</h3>${canEdit ? '<button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-edit-instructor-matching>עריכת התאמה</button>' : ''}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:9px">${field('מגדר', profile.gender === 'female' ? 'מדריכה' : profile.gender === 'male' ? 'מדריך' : 'טרם הוגדר')}${field('שפות הדרכה', (profile.instruction_languages || []).map(v => v === 'he' ? 'עברית' : 'ערבית').join(', '))}${field('שכבות גיל', (profile.education_levels || []).map(v => ({elementary:'יסודי',middle_school:'חטיבת ביניים',high_school:'תיכון'}[v] || v)).join(', '))}${field('הגבלת קורסים', ({all:'כל הקורסים',allow_only:'רק קורסים נבחרים',block_selected:'חסום מקורסים נבחרים'}[profile.course_restriction_mode] || 'כל הקורסים'))}</div>${profile.matching_note ? `<p class="ds-muted">הערה פנימית: ${escapeHtml(profile.matching_note)}</p>` : ''}</section>
    <section style="display:grid;gap:10px"><h3 style="margin:0">פעילויות פעילות ועתידיות <span class="ds-badge">${activities.length}</span></h3>${activitiesHtml(activities)}</section>
    <p class="ds-muted" style="margin:0">בשלב זה המערכת מרכזת נתונים ואילוצים בלבד ואינה משנה שיבוצים אוטומטית.</p>
  </div>`;
}

export function matchingForm(row) {
  const p = row.scheduling_profile || {};
  const checked = (items, value) => (items || []).includes(value) ? ' checked' : '';
  const csv = (value) => escapeHtml((value || []).join(', '));
  return `<div dir="rtl" style="display:grid;gap:14px"><label>מגדר<select class="ds-input" name="gender"><option value="">בחירה</option><option value="female"${p.gender === 'female' ? ' selected' : ''}>מדריכה</option><option value="male"${p.gender === 'male' ? ' selected' : ''}>מדריך</option></select></label><fieldset><legend>שפות הדרכה</legend><label><input type="checkbox" name="language" value="he"${checked(p.instruction_languages,'he')}> עברית</label> <label><input type="checkbox" name="language" value="ar"${checked(p.instruction_languages,'ar')}> ערבית</label></fieldset><fieldset><legend>שכבות גיל</legend><label><input type="checkbox" name="education" value="elementary"${checked(p.education_levels,'elementary')}> יסודי</label> <label><input type="checkbox" name="education" value="middle_school"${checked(p.education_levels,'middle_school')}> חטיבת ביניים</label> <label><input type="checkbox" name="education" value="high_school"${checked(p.education_levels,'high_school')}> תיכון</label></fieldset><label>הגבלת קורסים<select class="ds-input" name="course_restriction_mode"><option value="all"${p.course_restriction_mode === 'all' ? ' selected' : ''}>מתאים לכל הקורסים</option><option value="allow_only"${p.course_restriction_mode === 'allow_only' ? ' selected' : ''}>רק קורסים נבחרים</option><option value="block_selected"${p.course_restriction_mode === 'block_selected' ? ' selected' : ''}>חסום מקורסים נבחרים</option></select></label><label>קורסים (מזהים, מופרדים בפסיק)<input class="ds-input" name="course_ids" value="${csv(p.course_ids)}"></label><label>רשויות חסומות<input class="ds-input" name="blocked_authorities" value="${csv(p.blocked_authorities)}"></label><label>בתי ספר חסומים<input class="ds-input" name="blocked_schools" value="${csv(p.blocked_schools)}"></label><label>הערת התאמה פנימית<textarea class="ds-input" name="matching_note">${escapeHtml(p.matching_note || '')}</textarea></label><p class="ds-muted" data-matching-status></p></div>`;
}

export function contactForm(row) {
  const input = (label, name, value, type = 'text', dir = 'rtl') => `<label style="display:grid;gap:5px"><span class="ds-muted">${escapeHtml(label)}</span><input class="ds-input" type="${type}" name="${name}" value="${escapeHtml(value || '')}" dir="${dir}"></label>`;
  return `<div dir="rtl" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">${input('שם מלא','full_name',row.full_name)}${input('נייד','mobile',row.mobile,'tel','ltr')}${input('דוא״ל','email',row.email,'email','ltr')}${input('כתובת','address',row.address)}${input('סוג העסקה','employment_type',row.employment_type)}${input('מנהל ישיר','direct_manager',row.direct_manager)}<label style="display:grid;gap:5px"><span class="ds-muted">סטטוס</span><select class="ds-input" name="active"><option value="yes"${row.active === 'yes' ? ' selected' : ''}>פעיל</option><option value="no"${row.active === 'no' ? ' selected' : ''}>לא פעיל</option></select></label><p class="ds-muted" data-instructor-form-status style="grid-column:1/-1;margin:0"></p></div>`;
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
    return `<div data-weekday-row="${day.value}" style="display:grid;grid-template-columns:110px 90px 1fr 1fr;align-items:center;gap:8px;padding:9px;border:1px solid #e2e8f0;border-radius:11px"><strong>${escapeHtml(day.label)}</strong><label><input type="checkbox" name="available"${rule.available && !saturday ? ' checked' : ''}${saturday ? ' disabled' : ''}> זמין</label><input class="ds-input ds-input--sm" type="time" name="start_time" value="${escapeHtml(String(rule.start_time || '08:00').slice(0,5))}"${saturday ? ' disabled' : ''}><input class="ds-input ds-input--sm" type="time" name="end_time" value="${escapeHtml(String(rule.end_time || '15:00').slice(0,5))}"${saturday ? ' disabled' : ''}></div>`;
  }).join('');
  const exceptions = (row.availability_exceptions || []).map((item) => `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 10px;border:1px solid #e2e8f0;border-radius:10px"><span><strong>${escapeHtml(formatDateHe(item.exception_date))}</strong> — ${item.available ? `זמין ${escapeHtml(String(item.start_time || '').slice(0,5))}–${escapeHtml(String(item.end_time || '').slice(0,5))}` : 'חסום'}${item.notes ? ` · ${escapeHtml(item.notes)}` : ''}</span><button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-delete-availability-exception="${escapeHtml(item.id)}">מחיקה</button></div>`).join('');
  return `<div dir="rtl" style="display:grid;gap:16px;max-height:70vh;overflow:auto"><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><label>תחילת יום<input class="ds-input" type="time" name="default_start_time" value="${escapeHtml(String(profile.default_start_time || '08:00').slice(0,5))}"></label><label>סיום יום<input class="ds-input" type="time" name="default_end_time" value="${escapeHtml(String(profile.default_end_time || '15:00').slice(0,5))}"></label></div><label><input type="checkbox" name="friday_allowed"${profile.friday_allowed ? ' checked' : ''}> ניתן לשבץ ביום שישי כחריג מאושר</label><div style="display:grid;gap:7px"><strong>זמינות שבועית</strong>${weekly}</div><label style="display:grid;gap:5px">הערה פנימית<textarea class="ds-input" name="notes" rows="3">${escapeHtml(profile.notes || '')}</textarea></label><div style="display:grid;gap:8px"><strong>חריגים מתוארכים</strong>${exceptions || '<span class="ds-muted">לא הוגדרו חריגים.</span>'}</div><div style="display:grid;grid-template-columns:150px 130px 1fr 1fr;gap:8px;align-items:end;padding:12px;border-radius:12px;background:#f6f8fb"><label>תאריך<input class="ds-input ds-input--sm" type="date" name="exception_date"></label><label>סוג<select class="ds-input ds-input--sm" name="exception_available"><option value="no">חסום</option><option value="yes">זמין בשעות מיוחדות</option></select></label><label>משעה<input class="ds-input ds-input--sm" type="time" name="exception_start_time" value="08:00"></label><label>עד שעה<input class="ds-input ds-input--sm" type="time" name="exception_end_time" value="15:00"></label><label style="grid-column:1/-1">הערה<input class="ds-input ds-input--sm" name="exception_notes"></label><button type="button" class="ds-btn ds-btn--sm" data-add-availability-exception style="grid-column:1/-1">הוספת חריג</button></div><p class="ds-muted" data-constraints-status style="margin:0"></p></div>`;
}

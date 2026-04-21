/**
 * settings.gs — קריאת הגדרות מגיליון settings וקונפיגורציה נגזרת.
 *
 * תלויות: config.gs, helpers.gs, sheets.gs (readActiveSettingsMap_, readRows_)
 * נקרא מ: auth.gs, router.gs, actions.gs
 *
 * חשוב: קובץ זה חייב להיכלל ב-Apps Script לצד שאר הקבצים.
 */

/* ── ניתוח ערכי CSV / JSON מגיליון settings ──────────────────────────────── */

function parseCsvSetting_(raw) {
  var t = text_(raw);
  if (!t) return [];
  if (t.charAt(0) === '[') {
    try {
      var parsed = JSON.parse(t);
      if (Object.prototype.toString.call(parsed) === '[object Array]') {
        return parsed.map(text_).filter(Boolean);
      }
    } catch (e) {}
  }
  return t.split(',').map(function(v) { return text_(v); }).filter(Boolean);
}

function normalizeActivitySourceName_(value) {
  var t = text_(value).toLowerCase();
  if (t === 'data_short' || t === 'short') return CONFIG.SHEETS.DATA_SHORT;
  if (t === 'data_long' || t === 'long') return CONFIG.SHEETS.DATA_LONG;
  return '';
}

/* ── גישה בסיסית ל-settings ────────────────────────────────────────────────── */

function getSettingText_(key, fallback) {
  var map = readActiveSettingsMap_();
  var v = text_(map[key]);
  return v || text_(fallback);
}

function getSettingBool_(key, defaultValue) {
  var map = readActiveSettingsMap_();
  if (!Object.prototype.hasOwnProperty.call(map, key)) return !!defaultValue;
  return yesNo_(map[key]) === 'yes';
}

function settingYes_(key) {
  return yesNo_(readActiveSettingsMap_()[key]) !== 'no';
}

/* ── מקורות נתונים מוגדרים ─────────────────────────────────────────────────── */

function configuredActivitySources_(settingKey, fallbackSources) {
  var map = readActiveSettingsMap_();
  var configured = parseCsvSetting_(map[settingKey]);
  var out = [];
  configured.forEach(function(src) {
    var normalized = normalizeActivitySourceName_(src);
    if (normalized && out.indexOf(normalized) < 0) out.push(normalized);
  });
  if (!out.length) {
    (fallbackSources || [CONFIG.SHEETS.DATA_SHORT, CONFIG.SHEETS.DATA_LONG]).forEach(function(src) {
      var normalized = normalizeActivitySourceName_(src);
      if (normalized && out.indexOf(normalized) < 0) out.push(normalized);
    });
  }
  return out;
}

function configuredProgramActivityTypes_() {
  var list = parseCsvSetting_(readActiveSettingsMap_().program_activity_types);
  return list.length ? list : (CONFIG.DEFAULT_PROGRAM_ACTIVITY_TYPES || ['course', 'after_school']);
}

function configuredOneDayActivityTypes_() {
  var list = parseCsvSetting_(readActiveSettingsMap_().one_day_activity_types);
  return list.length ? list : (CONFIG.DEFAULT_ONE_DAY_ACTIVITY_TYPES || ['workshop', 'tour', 'escape_room']);
}

function configuredExceptionPriority_() {
  var allowed = {
    missing_instructor: true,
    missing_start_date: true,
    late_end_date: true
  };
  var list = parseCsvSetting_(readActiveSettingsMap_().exceptions_priority)
    .map(function(v) { return text_(v).toLowerCase(); })
    .filter(function(v) { return !!allowed[v]; });
  if (!list.length) {
    list = ['missing_instructor', 'missing_start_date', 'late_end_date'];
  }
  var unique = [];
  list.forEach(function(v) {
    if (unique.indexOf(v) < 0) unique.push(v);
  });
  return unique;
}

function configuredDropdownSourceSheet_() {
  var fromSettings = text_(readActiveSettingsMap_().dropdown_source_sheet);
  return fromSettings || CONFIG.SHEETS.LISTS;
}

function configuredInstructorsSources_() {
  return configuredActivitySources_('instructors_screen_sources', [CONFIG.SHEETS.DATA_SHORT, CONFIG.SHEETS.DATA_LONG]);
}

function configuredActivitiesSources_() {
  return configuredActivitySources_('activities_data_sources', [CONFIG.SHEETS.DATA_SHORT, CONFIG.SHEETS.DATA_LONG]);
}

function configuredInstructorContactsSourceSheet_() {
  var v = text_(readActiveSettingsMap_().instructor_contacts_source);
  return v || CONFIG.SHEETS.CONTACTS_INSTRUCTORS;
}

function configuredSchoolContactsSourceSheet_() {
  var v = text_(readActiveSettingsMap_().school_contacts_source);
  return v || CONFIG.SHEETS.SCHOOLS;
}

/* ── ערכי dropdown מגיליון lists ─────────────────────────────────────────── */

function listValuesForName_(listName) {
  var target = text_(listName);
  var rows = readRows_(configuredDropdownSourceSheet_());
  var out = [];
  rows.forEach(function(row) {
    if (text_(row.list_name) !== target) return;
    var v = text_(row.value);
    if (!v) return;
    if (out.indexOf(v) < 0) out.push(v);
  });
  return out;
}

function activityTypesForFilters_() {
  var fromSheet = listValuesForName_('activity_type');
  if (!fromSheet.length) {
    return CONFIG.ACTIVITY_TYPES.slice();
  }
  return ['all'].concat(fromSheet);
}

function financeStatusesForFilters_() {
  var fromSheet = listValuesForName_('finance_status');
  return fromSheet.length ? fromSheet : CONFIG.FINANCE_STATUSES.slice();
}

/* ── הגדרות זמן ─────────────────────────────────────────────────────────── */

function getLateEndDateCutoff_() {
  var m = readActiveSettingsMap_();
  var v = text_(m.late_end_date_cutoff);
  return v || CONFIG.LATE_END_DATE_CUTOFF;
}

/** yes = הצגת שבת בלוחות זמן (כמו ב-settings) */
function settingShowShabbat_() {
  return text_(readActiveSettingsMap_().show_shabbat).toLowerCase() === 'yes';
}

function getWeekStartDay_() {
  var n = parseInt(text_(readActiveSettingsMap_().week_start_day), 10);
  if (isNaN(n) || n < 0 || n > 6) {
    return 0;
  }
  return n;
}

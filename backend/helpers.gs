function text_(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    // Google Sheets stores time-only values as dates anchored to Dec 30, 1899.
    // Detect those and format as HH:mm instead of a date string.
    if (value.getFullYear() <= 1900) {
      return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
    }
    return formatDate_(value);
  }
  return String(value).trim();
}

/**
 * Unified empty-value normalization for control metrics.
 * Values such as null/undefined/blank/whitespace/"-"/"—"/"לא שובץ"/"טרם שובץ"/"לא נקבע"
 * are treated as empty.
 */
function isNormalizedEmptyValue_(value) {
  if (value === null || value === undefined) return true;
  var raw = text_(value);
  if (!raw) return true;
  var norm = raw.replace(/\u00A0/g, ' ').trim();
  if (!norm) return true;
  var compact = norm.replace(/\s+/g, ' ').toLowerCase();
  return compact === '-' ||
    compact === '—' ||
    compact === 'לא שובץ' ||
    compact === 'לא משובץ' ||
    compact === 'טרם שובץ' ||
    compact === 'לא נקבע' ||
    compact === 'אין' ||
    compact === 'none' ||
    compact === 'null' ||
    compact === 'undefined';
}

function isValidIsoDateString_(value) {
  var iso = text_(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  var parts = iso.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var d = parseInt(parts[2], 10);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return false;
  var dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && (dt.getMonth() + 1) === m && dt.getDate() === d;
}

function normalizeStatusForControl_(status) {
  return text_(status).replace(/\s+/g, ' ').trim().toLowerCase();
}

function isExcludedStatusForControl_(status) {
  var s = normalizeStatusForControl_(status);
  return s === 'מבוטל' ||
    s === 'בוטל' ||
    s === 'הסתיים' ||
    s === 'לא פעיל' ||
    s === 'טיוטה';
}

function yesNo_(value) {
  return text_(value).toLowerCase() === 'no' ? 'no' : 'yes';
}

function internalRoleFromPermissionRow_(row) {
  // Primary: permissions sheet `display_role` (Hebrew label or legacy English code).
  // Fallback: internal `role` column when display_role is blank.
  var display = text_(row && row.display_role);
  var roleCol = text_(row && row.role);
  if (display) return display;
  return roleCol;
}

/** True when value is a known internal role token (English), not a Hebrew label. */
function isPermissionsSheetRoleCodeToken_(value) {
  var t = text_(value).toLowerCase();
  if (!t) return false;
  var codes = [
    'admin',
    'finance',
    'operations_reviewer',
    'operation_manager',
    'authorized_user',
    'instructor',
    'instructor_admin',
    'activities_manager',
    'domain_manager',
    'manager_instructor'
  ];
  return codes.indexOf(t) >= 0;
}

function normalizeRole_(value) {
  var role = text_(value).trim();
  // Case-insensitive match on internal codes first
  switch (role.toLowerCase()) {
    case 'admin':              return 'admin';
    case 'finance':            return 'finance';
    case 'operations_reviewer':
    case 'operation_manager':  return 'operation_manager';
    case 'authorized_user':    return 'authorized_user';
    case 'activities_manager': return 'activities_manager';
    case 'domain_manager':     return 'domain_manager';
    case 'manager_instructor': return 'manager_instructor';
    case 'instructor':         return 'instructor';
    case 'instructor_admin':   return 'instructor';
  }
  // Hebrew display-label fallback (backward-compat: old sessions where
  // display_role column held the Hebrew label instead of the code).
  switch (role) {
    case 'מנהל/ת':
    case 'מנהל מערכת':         return 'admin';
    case 'בקר/ת תפעול':
    case 'מנהל/ת תפעול':
    case 'מנהל תפעול':         return 'operation_manager';
    case 'משתמש/ת מורשה':
    case 'משתמש מורשה':        return 'authorized_user';
    case 'מדריך/ה':
    case 'מדריך':              return 'instructor';
    case 'כספים':              return 'finance';
    case 'מנהל/ת פעילויות':
    case 'מנהל פעילויות':      return 'activities_manager';
    case 'מנהל/ת תחום':
    case 'מנהל תחום':          return 'domain_manager';
    case 'מדריך/ת-מנהל/ת':
    case 'מדריך-מנהל':         return 'manager_instructor';
    default:                   throw new Error('invalid_role');
  }
}

function isOperationManagerRole_(role) {
  var normalized = text_(role).toLowerCase().trim();
  return normalized === 'operation_manager' || normalized === 'operations_reviewer';
}

function canDirectWriteRole_(role) {
  var normalized = normalizeRole_(role);
  return normalized === 'admin' || normalized === 'operation_manager';
}

function isAuthorizedUserTier_(role) {
  return role === 'authorized_user' ||
    role === 'finance' ||
    role === 'operation_manager' ||
    role === 'activities_manager' ||
    role === 'domain_manager' ||
    role === 'manager_instructor';
}

function normalizeFinance_(value) {
  return text_(value).toLowerCase() === 'closed' ? 'closed' : 'open';
}

function parseFinanceRowAmount_(row) {
  var explicit = parseFloat((row && (row.Payment || row.payment || row.payment_amount)) || 0) || 0;
  if (explicit > 0) return explicit;
  var price = parseFloat(row && row.price) || 0;
  var sessions = parseFloat(row && row.sessions) || 0;
  return sessions > 0 ? price * sessions : price;
}

function parseFinanceRowPending_(row) {
  var price = parseFloat(row && row.price) || 0;
  var sessions = parseFloat(row && row.sessions) || 0;
  var expected = sessions > 0 ? price * sessions : price;
  var recorded = parseFloat((row && (row.Payment || row.payment || row.payment_amount)) || 0) || 0;
  var pending = expected - recorded;
  return pending > 0 ? pending : 0;
}

function pickYesNo_(input, key, fallback) {
  if (Object.prototype.hasOwnProperty.call(input || {}, key)) {
    return yesNo_(input[key]);
  }
  return yesNo_(fallback[key]);
}

function formatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function googleSheetsSerialToDate_(serial) {
  var n = Number(serial);
  if (isNaN(n)) return null;
  var wholeDays = Math.floor(n);
  var dayFraction = n - wholeDays;
  var ms = Math.round(dayFraction * 24 * 60 * 60 * 1000);
  var dt = new Date(1899, 11, 30);
  dt.setDate(dt.getDate() + wholeDays);
  dt = new Date(dt.getTime() + ms);
  return isNaN(dt.getTime()) ? null : dt;
}

function normalizeDateToIsoFlexible_(value) {
  if (isNormalizedEmptyValue_(value)) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : formatDate_(value);
  }
  if (Object.prototype.toString.call(value) === '[object Number]' && !isNaN(value)) {
    var serialDate = googleSheetsSerialToDate_(value);
    return serialDate ? formatDate_(serialDate) : '';
  }

  var t = text_(value);
  if (!t) return '';
  var trimmed = t.replace(/\u00A0/g, ' ').trim();

  if (/^\d{5}(\.\d+)?$/.test(trimmed)) {
    var serialDateFromText = googleSheetsSerialToDate_(Number(trimmed));
    if (serialDateFromText) return formatDate_(serialDateFromText);
  }

  var normalized = trimmed.replace(/[T\s]\d{1,2}:\d{2}(:\d{2})?.*$/, '');
  if (isValidIsoDateString_(normalized)) return normalized;

  var ym = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(normalized);
  if (ym) return ym[1] + '-' + ym[2] + '-01';

  var ymd = /^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/.exec(normalized);
  if (ymd) {
    var yy = ymd[1];
    var mmo = ('0' + parseInt(ymd[2], 10)).slice(-2);
    var dd = ('0' + parseInt(ymd[3], 10)).slice(-2);
    var ymdIso = yy + '-' + mmo + '-' + dd;
    if (isValidIsoDateString_(ymdIso)) return ymdIso;
  }

  var dmy = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(normalized);
  if (dmy) {
    var d = ('0' + parseInt(dmy[1], 10)).slice(-2);
    var mo = ('0' + parseInt(dmy[2], 10)).slice(-2);
    var y = dmy[3];
    var iso = y + '-' + mo + '-' + d;
    if (isValidIsoDateString_(iso)) return iso;
  }

  var dmy2 = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2})$/.exec(normalized);
  if (dmy2) {
    var d2 = ('0' + parseInt(dmy2[1], 10)).slice(-2);
    var mo2 = ('0' + parseInt(dmy2[2], 10)).slice(-2);
    var yy2 = parseInt(dmy2[3], 10);
    var y2 = String(yy2 >= 70 ? 1900 + yy2 : 2000 + yy2);
    var iso2 = y2 + '-' + mo2 + '-' + d2;
    if (isValidIsoDateString_(iso2)) return iso2;
  }

  var parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? '' : formatDate_(parsed);
}

function normalizeMonthYmFlexible_(value) {
  if (isNormalizedEmptyValue_(value)) return '';
  var t = text_(value);
  var directYm = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(t);
  if (directYm) return directYm[1] + '-' + directYm[2];
  var iso = normalizeDateToIsoFlexible_(value);
  return iso ? iso.slice(0, 7) : '';
}

function normalizeTimeToTextFlexible_(value) {
  if (isNormalizedEmptyValue_(value)) return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
  }

  if (Object.prototype.toString.call(value) === '[object Number]' && !isNaN(value)) {
    var serialTime = googleSheetsSerialToDate_(value);
    return serialTime ? Utilities.formatDate(serialTime, Session.getScriptTimeZone(), 'HH:mm') : '';
  }

  var t = text_(value);
  if (!t) return '';
  var trimmed = t.replace(/\u00A0/g, ' ').trim();

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    var numeric = Number(trimmed);
    if (!isNaN(numeric)) {
      var fromNumeric = googleSheetsSerialToDate_(numeric);
      if (fromNumeric) return Utilities.formatDate(fromNumeric, Session.getScriptTimeZone(), 'HH:mm');
    }
  }

  var hm = /^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/.exec(trimmed);
  if (hm) {
    var h = parseInt(hm[1], 10);
    var m = parseInt(hm[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);
    }
  }

  var parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return '';
  return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'HH:mm');
}

function mondayOfWeek_(date) {
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var day = d.getDay();
  var diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function shiftDate_(date, days) {
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function parsePayload_(e) {
  var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  return JSON.parse(raw || '{}');
}

function parseJsonObject_(raw, fallback) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_e) {
    return fallback;
  }
}

var __rqPerf_ = null;

/** Wall-clock SLA ceilings (ms); breaches log only — see maybeLogSlaBreached_. */
var SLA_THRESHOLDS_MS_ = {
  login: 1000,
  dashboard: 1500,
  dashboardSnapshot: 1500,
  dashboardSheet: 1500,
  activities: 2000,
  week: 2000,
  month: 2000
};

function perfNowMs_() {
  return new Date().getTime();
}

/**
 * Non-blocking: console.warn when request wall time exceeds SLA for the action.
 * Uses __rqPerf_.started_ms from beginRequestPerf_; no effect if perf was not started.
 */
function maybeLogSlaBreached_(perfMeta) {
  if (!__rqPerf_ || typeof __rqPerf_.started_ms !== 'number') return;
  var action = text_((perfMeta && perfMeta.action) || __rqPerf_.action || '');
  if (!action) return;
  var limit = SLA_THRESHOLDS_MS_[action];
  if (!limit) return;
  var elapsed = Math.max(0, perfNowMs_() - __rqPerf_.started_ms);
  if (elapsed <= limit) return;
  try {
    console.warn('[sla]', JSON.stringify({
      action: action,
      reason: 'sla_exceeded',
      duration_ms: elapsed,
      threshold_ms: limit,
      overflow_ms: elapsed - limit,
      cache_hit: !!(perfMeta && perfMeta.cache_hit),
      errored: !!(perfMeta && perfMeta.errored)
    }));
  } catch (_e) {}
}

/**
 * Enable per-request perf when any of:
 * - JSON body debug_perf true / "1" / "true"
 * - Query string debug_perf=1 (web app POST may still carry e.parameter)
 * - Script property DEBUG_PERF=1 (Apps Script project settings → Script properties)
 */
function debugPerfRequested_(payload, httpEvent) {
  var p = payload || {};
  if (
    p.debug_perf === true ||
    text_(p.debug_perf) === '1' ||
    text_(p.debug_perf).toLowerCase() === 'true'
  ) {
    return true;
  }
  try {
    if (httpEvent && httpEvent.parameter) {
      var q = text_(httpEvent.parameter.debug_perf).toLowerCase();
      if (q === '1' || q === 'true') return true;
    }
  } catch (_e) {}
  try {
    if (PropertiesService.getScriptProperties().getProperty('DEBUG_PERF') === '1') return true;
  } catch (_e2) {}
  return false;
}

function inferFallbackUsedFromPerfCustom_(custom) {
  if (!custom || typeof custom !== 'object') return false;
  if (custom.fallback_used !== undefined && custom.fallback_used !== null) {
    return !!custom.fallback_used;
  }
  if (custom.read_model_legacy_fallback) return true;
  if (custom.dashboard_fallback_used) return true;
  if (custom.week_fallback_used) return true;
  if (custom._activities_fallback_used) return true;
  return false;
}

function beginRequestPerf_(action, payload, httpEvent) {
  var debugFlag = debugPerfRequested_(payload, httpEvent);
  __rqPerf_ = {
    enabled: !!debugFlag,
    action: text_(action),
    started_ms: perfNowMs_(),
    marks: [{ label: 'request_start', at_ms: perfNowMs_() }],
    sheet_reads: [],
    sheets_total_ms: 0,
    custom: {
      permissions_lookup: false,
      data_source: 'full'
    }
  };
  try {
    __rqPerf_.custom.request_size_bytes = JSON.stringify(payload || {}).length;
  } catch (_e) {
    __rqPerf_.custom.request_size_bytes = 0;
  }
}

function markRequestPerf_(label) {
  if (!__rqPerf_ || !__rqPerf_.enabled) return;
  __rqPerf_.marks.push({ label: text_(label), at_ms: perfNowMs_() });
}

function trackSheetReadPerf_(meta) {
  if (!__rqPerf_ || !__rqPerf_.enabled) return;
  var item = {
    sheet: text_(meta.sheet),
    rows: Number(meta.rows || 0),
    cols: Number(meta.cols || 0),
    duration_ms: Number(meta.duration_ms || 0),
    projected: !!meta.projected,
    from_cache: !!meta.from_cache
  };
  __rqPerf_.sheet_reads.push(item);
  __rqPerf_.sheets_total_ms += item.duration_ms;
}

function setRequestPerfField_(key, value) {
  if (!__rqPerf_ || !__rqPerf_.enabled) return;
  var fieldKey = text_(key);
  if (!fieldKey) return;
  __rqPerf_.custom[fieldKey] = value;
}

function buildPerfPayload_(responsePayload, meta) {
  if (!__rqPerf_ || !__rqPerf_.enabled) return null;
  var endMs = perfNowMs_();
  var marks = __rqPerf_.marks.slice();
  marks.push({ label: 'response_start', at_ms: endMs });
  var stepDurations = [];
  for (var i = 1; i < marks.length; i++) {
    stepDurations.push({
      step: marks[i - 1].label + '→' + marks[i].label,
      duration_ms: marks[i].at_ms - marks[i - 1].at_ms
    });
  }
  var responseSize = JSON.stringify(responsePayload || {}).length;
  var totalMs = endMs - __rqPerf_.started_ms;
  var sheetReadsArr = __rqPerf_.sheet_reads || [];
  var perfPayload = {
    action: text_((meta && meta.action) || __rqPerf_.action),
    cache_hit: !!(meta && meta.cache_hit),
    errored: !!(meta && meta.errored),
    total_ms: totalMs,
    duration_ms: totalMs,
    sheets_total_ms: __rqPerf_.sheets_total_ms,
    sheet_reads: sheetReadsArr,
    sheet_reads_count: sheetReadsArr.length,
    steps: stepDurations,
    response_size_bytes: responseSize,
    payload_size: responseSize
  };
  Object.keys(__rqPerf_.custom || {}).forEach(function(key) {
    perfPayload[key] = __rqPerf_.custom[key];
  });
  perfPayload.fallback_used = inferFallbackUsedFromPerfCustom_(__rqPerf_.custom);
  perfPayload.duration_ms = totalMs;
  perfPayload.sheet_reads_count = sheetReadsArr.length;
  perfPayload.payload_size = responseSize;
  return perfPayload;
}

function jsonResponse_(payload, perfMeta) {
  var body = payload || {};
  try {
    maybeLogSlaBreached_(perfMeta || {});
  } catch (_sla) {}
  var perf = buildPerfPayload_(body, perfMeta);
  if (perf) {
    if (body.ok && body.data && typeof body.data === 'object') {
      body.data.debug_perf = perf;
    } else {
      body.debug_perf = perf;
    }
  }
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

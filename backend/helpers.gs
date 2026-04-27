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
  return text_(row && row.display_role);
}

function normalizeRole_(value) {
  var role = text_(value).toLowerCase().trim();
  switch (role) {
    case 'admin':             return 'admin';
    case 'finance':           return 'finance';
    case 'operations_reviewer':
    case 'operation_manager': return 'operation_manager';
    case 'activities_manager':return 'activities_manager';
    case 'domain_manager':    return 'domain_manager';
    case 'manager_instructor':return 'manager_instructor';
    case 'instructor':        return 'instructor';
    case 'instructor_admin':  return 'instructor';
    default:                  throw new Error('invalid_role');
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

function perfNowMs_() {
  return new Date().getTime();
}

function beginRequestPerf_(action, payload) {
  var debugFlag = payload && (
    payload.debug_perf === true ||
    text_(payload.debug_perf) === '1' ||
    text_(payload.debug_perf).toLowerCase() === 'true'
  );
  __rqPerf_ = {
    enabled: !!debugFlag,
    action: text_(action),
    started_ms: perfNowMs_(),
    marks: [{ label: 'request_start', at_ms: perfNowMs_() }],
    sheet_reads: [],
    sheets_total_ms: 0
  };
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
  return {
    action: text_((meta && meta.action) || __rqPerf_.action),
    cache_hit: !!(meta && meta.cache_hit),
    errored: !!(meta && meta.errored),
    total_ms: endMs - __rqPerf_.started_ms,
    sheets_total_ms: __rqPerf_.sheets_total_ms,
    sheet_reads: __rqPerf_.sheet_reads,
    steps: stepDurations,
    response_size_bytes: responseSize
  };
}

function jsonResponse_(payload, perfMeta) {
  var body = payload || {};
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

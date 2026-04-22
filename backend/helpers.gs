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
    case 'operation_manager': return 'operation_manager';
    case 'activities_manager':return 'activities_manager';
    case 'domain_manager':    return 'domain_manager';
    case 'manager_instructor':return 'manager_instructor';
    case 'instructor':        return 'instructor';
    default:                  throw new Error('invalid_role');
  }
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

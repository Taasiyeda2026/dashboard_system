function text_(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
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
  var raw = text_(value).toLowerCase();
  var role = raw.replace(/\s+/g, ' ').trim();
  if (role === 'admin') return 'admin';
  if (role === 'finance') return 'finance';
  if (role === 'operations_reviewer' || role === 'operations reviewer') return 'operations_reviewer';
  if (role === 'authorized_user' || role === 'authorized user') return 'authorized_user';
  if (role === 'instructor') return 'instructor';
  if (role === 'operation manager' || role === 'operations manager') return 'operation_manager';
  if (role === 'activities manager') return 'activities_manager';
  if (role === 'domain manager') return 'domain_manager';
  if (role === 'manager instructor') return 'manager_instructor';
  throw new Error('Invalid role: ' + raw);
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

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

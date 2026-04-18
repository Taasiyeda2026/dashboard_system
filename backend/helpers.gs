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

function normalizeRole_(value) {
  var role = text_(value).toLowerCase();
  if (role === 'admin') return 'admin';
  if (role === 'operations_reviewer' || role === 'operations reviewer') return 'operations_reviewer';
  if (role === 'authorized_user' || role === 'authorized user') return 'authorized_user';
  if (role === 'instructor') return 'instructor';
  throw new Error('Invalid role: ' + role);
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

// ============================================================
// Code.gs — Taasiyeda Backend (Google Apps Script)
// ============================================================
// Deploy as Web App:
//   Execute as: Me
//   Who has access: Anyone (or Anyone with Google account)
// ============================================================

const SPREADSHEET_ID = "YOUR_SPREADSHEET_ID"; // ← החלף במזהה הגיליון שלך
const LATE_CUTOFF    = "2026-06-15";

// ── Entry points ─────────────────────────────────────────────
function doGet(e)  { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  try {
    const params = e.parameter || {};
    const body   = parseBody(e);
    const all    = { ...params, ...body };

    const action = all.action;
    if (!action) return jsonError("Missing action");

    // Auth check (skip for login)
    let user = null;
    if (action !== "login") {
      user = authenticate(all.user_id, all.entry_code);
      if (!user) return jsonError("Unauthorized", 401);
    }

    const result = dispatch(action, all, user);
    return jsonOk(result);
  } catch (err) {
    return jsonError(err.message || "Internal error");
  }
}

function parseBody(e) {
  try { return JSON.parse(e.postData?.contents || "{}"); }
  catch { return {}; }
}

function dispatch(action, p, user) {
  switch (action) {
    case "login":               return actionLogin(p);
    case "getDashboardStats":   return actionDashboardStats(user);
    case "getActivities":       return actionGetActivities(p, user);
    case "getActivity":         return actionGetActivity(p, user);
    case "addActivity":         return actionAddActivity(p, user);
    case "editDirect":          return actionEditDirect(p, user);
    case "submitEditRequest":   return actionSubmitEditRequest(p, user);
    case "getEditRequests":     return actionGetEditRequests(p, user);
    case "reviewEditRequest":   return actionReviewEditRequest(p, user);
    case "getMeetings":         return actionGetMeetings(p, user);
    case "getInstructors":      return actionGetInstructors(p, user);
    case "getSchools":          return actionGetSchools(user);
    case "getLists":            return actionGetLists(user);
    case "getExceptions":       return actionGetExceptions(p, user);
    case "getFinanceData":      return actionGetFinanceData(p, user);
    case "getPermissions":      return actionGetPermissions(user);
    case "savePermission":      return actionSavePermission(p, user);
    case "getPrivateNote":      return actionGetPrivateNote(p, user);
    case "savePrivateNote":     return actionSavePrivateNote(p, user);
    case "getMyData":           return actionGetMyData(user);
    case "getWeekData":         return actionGetWeekData(p, user);
    case "getMonthData":        return actionGetMonthData(p, user);
    default: throw new Error("Unknown action: " + action);
  }
}

// ── Auth ─────────────────────────────────────────────────────
function authenticate(user_id, entry_code) {
  if (!entry_code) return null;
  const rows = getSheetData("permissions");
  const user = rows.find((r) =>
    String(r.entry_code).trim() === String(entry_code).trim() &&
    (r.active === true || r.active === "TRUE" || r.active === "yes")
  );
  return user || null;
}

function actionLogin(p) {
  const user = authenticate(null, p.entry_code);
  if (!user) return { user: null, error: "קוד כניסה שגוי" };
  // Don't expose entry_code back
  const safe = { ...user };
  delete safe.entry_code;
  return { user: safe };
}

// ── Permission helpers ────────────────────────────────────────
function boolPerm(user, field) {
  const v = user?.[field];
  return v === true || v === "TRUE" || v === "yes" || v === 1;
}

function requirePerm(user, field) {
  if (!boolPerm(user, field)) throw new Error("אין הרשאה");
}

// ── Sheets helpers ────────────────────────────────────────────
function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet(name) {
  const ss = getSpreadsheet();
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error("Sheet not found: " + name);
  return sh;
}

function getSheetData(sheetName) {
  const sh = getSheet(sheetName);
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(String);
  return data.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] ?? ""; });
    return obj;
  });
}

function appendRow(sheetName, rowObj) {
  const sh = getSheet(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const row = headers.map((h) => rowObj[h] ?? "");
  sh.appendRow(row);
}

function updateCell(sheetName, rowIndex, colName, value) {
  // rowIndex is 1-based data row (row 2 = index 1 in data)
  const sh = getSheet(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const col = headers.indexOf(colName);
  if (col === -1) throw new Error("Column not found: " + colName);
  sh.getRange(rowIndex + 1, col + 1).setValue(value); // +1 for header row
}

function findRowIndex(sheetName, keyField, keyValue) {
  const rows = getSheetData(sheetName);
  const idx = rows.findIndex((r) => String(r[keyField]) === String(keyValue));
  if (idx === -1) throw new Error("Row not found: " + keyValue);
  return idx + 2; // 1-based sheet row (1=header, so data starts at 2)
}

function dateToISO(val) {
  if (!val) return "";
  if (val instanceof Date) return Utilities.formatDate(val, "Asia/Jerusalem", "yyyy-MM-dd");
  return String(val);
}

function normalizeRow(row) {
  const out = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v instanceof Date) out[k] = dateToISO(v);
    else out[k] = v;
  }
  return out;
}

function filterRows(rows, filters) {
  const keys = Object.keys(filters).filter((k) => filters[k] !== "" && filters[k] !== undefined);
  return rows.filter((r) => keys.every((k) => {
    if (k === "q") {
      const q = String(filters.q).toLowerCase();
      return Object.values(r).some((v) => String(v).toLowerCase().includes(q));
    }
    return String(r[k]).toLowerCase() === String(filters[k]).toLowerCase();
  }));
}

// ── Generate next RowID ───────────────────────────────────────
function nextRowId(sheetName) {
  const prefix = sheetName === "data_short" ? "SHORT" : "LONG";
  const rows = getSheetData(sheetName);
  const nums = rows
    .map((r) => parseInt(String(r.RowID).split("-")[1]))
    .filter((n) => !isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

// ── Actions ───────────────────────────────────────────────────

function actionDashboardStats(user) {
  requirePerm(user, "view_dashboard");

  const shorts = getSheetData("data_short");
  const longs  = getSheetData("data_long");
  const instrs = getSheetData("contacts_instructors").filter((r) => r.active === "yes" || r.active === true);

  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastOfMonth  = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const courseEndings = longs.filter((r) => {
    if (r.activity_type !== "course" && r.activity_type !== "after_school") return false;
    const ed = new Date(dateToISO(r.end_date));
    return ed >= firstOfMonth && ed <= lastOfMonth;
  }).length;

  // By manager
  const allActivities = [...shorts, ...longs];
  const byManager = {};
  allActivities.forEach((r) => {
    const m = r.activity_manager || "—";
    if (!byManager[m]) byManager[m] = { name: m, short: 0, long: 0 };
    if (String(r.RowID).startsWith("SHORT")) byManager[m].short++;
    else byManager[m].long++;
  });

  return {
    stats: {
      total_short: shorts.length,
      total_long:  longs.length,
      total_instructors: instrs.length,
      course_endings_this_month: courseEndings,
      by_manager: Object.values(byManager).sort((a, b) => a.name.localeCompare(b.name, "he")),
    }
  };
}

function actionGetActivities(p, user) {
  requirePerm(user, "view_activities");

  const filters = {
    activity_type:    p.activity_type    || "",
    authority:        p.authority        || "",
    school:           p.school           || "",
    instructor_name:  p.instructor_name  || "",
    activity_manager: p.activity_manager || "",
    status:           p.status           || "",
  };

  const shorts = getSheetData("data_short").map(normalizeRow);
  const longs  = getSheetData("data_long").map(normalizeRow);
  let all = [...shorts, ...longs];
  all = filterRows(all, filters);

  return { activities: all };
}

function actionGetActivity(p, user) {
  requirePerm(user, "view_activities");
  const sheet = p.sheet;
  if (!["data_short", "data_long"].includes(sheet)) throw new Error("Invalid sheet");
  const rows = getSheetData(sheet).map(normalizeRow);
  const activity = rows.find((r) => r.RowID === p.row_id);
  if (!activity) throw new Error("Not found");
  return { activity };
}

function actionAddActivity(p, user) {
  requirePerm(user, "can_add_activity");
  const data = typeof p.data === "string" ? JSON.parse(p.data) : p.data;
  const sheet = p.sheet;
  if (!["data_short", "data_long"].includes(sheet)) throw new Error("Invalid sheet");
  data.RowID = nextRowId(sheet);
  appendRow(sheet, data);
  return { success: true, row_id: data.RowID };
}

function actionEditDirect(p, user) {
  requirePerm(user, "can_edit_direct");
  const sheet = p.sheet;
  if (!["data_short", "data_long"].includes(sheet)) throw new Error("Invalid sheet");
  const sheetRow = findRowIndex(sheet, "RowID", p.row_id);
  const sh = getSheet(sheet);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const col = headers.indexOf(p.field);
  if (col === -1) throw new Error("Field not found: " + p.field);
  sh.getRange(sheetRow, col + 1).setValue(p.value);
  return { success: true };
}

function actionSubmitEditRequest(p, user) {
  requirePerm(user, "can_request_edit");
  const reqId = "REQ-" + Date.now();
  appendRow("edit_requests", {
    request_id:          reqId,
    source_sheet:        p.source_sheet,
    source_row_id:       p.source_row_id,
    field_name:          p.field_name,
    old_value:           p.old_value,
    new_value:           p.new_value,
    requested_by_user_id: user.user_id,
    requested_by_name:   user.full_name,
    requested_at:        new Date().toISOString(),
    status:              "pending",
    active:              "yes",
  });
  return { success: true, request_id: reqId };
}

function actionGetEditRequests(p, user) {
  requirePerm(user, "can_review_requests");
  const rows = getSheetData("edit_requests").map(normalizeRow);
  const status = p.status || "pending";
  return { requests: rows.filter((r) => r.status === status) };
}

function actionReviewEditRequest(p, user) {
  requirePerm(user, "can_review_requests");
  const rows = getSheetData("edit_requests");
  const idx  = rows.findIndex((r) => r.request_id === p.request_id);
  if (idx === -1) throw new Error("Request not found");

  const sheetRow = idx + 2;
  const sh = getSheet("edit_requests");
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);

  const set = (col, val) => sh.getRange(sheetRow, headers.indexOf(col) + 1).setValue(val);
  set("status",       p.status);
  set("reviewed_at",  new Date().toISOString());
  set("reviewed_by",  user.full_name);
  set("reviewer_notes", p.reviewer_notes || "");

  // Apply if approved
  if (p.status === "approved") {
    const req = rows[idx];
    const targetSheet = req.source_sheet;
    if (["data_short", "data_long"].includes(targetSheet)) {
      const targetRow = findRowIndex(targetSheet, "RowID", req.source_row_id);
      const tsh = getSheet(targetSheet);
      const th = tsh.getRange(1, 1, 1, tsh.getLastColumn()).getValues()[0].map(String);
      const col = th.indexOf(req.field_name);
      if (col !== -1) tsh.getRange(targetRow, col + 1).setValue(req.new_value);
    }
  }

  return { success: true };
}

function actionGetMeetings(p, user) {
  requirePerm(user, "view_activities");
  const rows = getSheetData("activity_meetings").map(normalizeRow);
  return { meetings: rows.filter((r) => r.source_row_id === p.source_row_id) };
}

function actionGetInstructors(p, user) {
  requirePerm(user, "view_instructors");
  let rows = getSheetData("contacts_instructors").map(normalizeRow);
  if (p.active_only === "true" || p.active_only === true) {
    rows = rows.filter((r) => r.active === "yes" || r.active === true);
  }
  if (p.q) rows = filterRows(rows, { q: p.q });
  return { instructors: rows };
}

function actionGetSchools(user) {
  requirePerm(user, "view_contacts");
  const rows = getSheetData("contacts_schools").map(normalizeRow);
  return { schools: rows };
}

function actionGetLists(user) {
  const rows = getSheetData("lists");
  return { lists: rows };
}

function actionGetExceptions(p, user) {
  requirePerm(user, "view_exceptions");

  const rows = getSheetData("data_long").map(normalizeRow);
  const CUTOFF = LATE_CUTOFF;

  const exceptions = [];
  rows.forEach((r) => {
    // Priority order: missing instructor > missing start_date > late end_date
    if (!r.instructor_name || r.instructor_name === "") {
      exceptions.push({ ...r, exception_type: "missing_instructor" });
    } else if (!r.start_date || r.start_date === "") {
      exceptions.push({ ...r, exception_type: "missing_date" });
    } else if (r.end_date && String(r.end_date) > CUTOFF) {
      exceptions.push({ ...r, exception_type: "late_end" });
    }
  });

  // Apply filters
  let filtered = exceptions;
  if (p.exception_type) filtered = filtered.filter((r) => r.exception_type === p.exception_type);
  if (p.activity_manager) filtered = filtered.filter((r) => r.activity_manager === p.activity_manager);
  if (p.instructor_name)  filtered = filtered.filter((r) => r.instructor_name === p.instructor_name);
  if (p.authority)        filtered = filtered.filter((r) => r.authority === p.authority);

  return { exceptions: filtered };
}

function actionGetFinanceData(p, user) {
  requirePerm(user, "view_finance");

  const shorts = getSheetData("data_short").map(normalizeRow);
  const longs  = getSheetData("data_long").map(normalizeRow);
  let all = [...shorts, ...longs];

  if (p.finance_status)   all = all.filter((r) => r.finance_status   === p.finance_status);
  if (p.authority)        all = all.filter((r) => r.authority        === p.authority);
  if (p.activity_manager) all = all.filter((r) => r.activity_manager === p.activity_manager);
  if (p.activity_type)    all = all.filter((r) => r.activity_type    === p.activity_type);

  return { data: all };
}

function actionGetPermissions(user) {
  requirePerm(user, "view_permissions");
  const rows = getSheetData("permissions");
  // Don't expose entry_codes to non-admins
  if (!boolPerm(user, "view_admin")) {
    rows.forEach((r) => delete r.entry_code);
  }
  return { users: rows };
}

function actionSavePermission(p, user) {
  requirePerm(user, "view_admin");
  const data = typeof p.data === "string" ? JSON.parse(p.data) : p.data;

  const rows = getSheetData("permissions");
  const idx  = rows.findIndex((r) => r.user_id === data.user_id);

  if (idx === -1) {
    // New user
    appendRow("permissions", data);
  } else {
    // Update existing — overwrite row
    const sh = getSheet("permissions");
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const sheetRow = idx + 2;
    const rowVals = headers.map((h) => data[h] ?? rows[idx][h] ?? "");
    sh.getRange(sheetRow, 1, 1, rowVals.length).setValues([rowVals]);
  }

  return { success: true };
}

function actionGetPrivateNote(p, user) {
  if (!boolPerm(user, "can_review_requests") && !boolPerm(user, "view_admin")) throw new Error("אין הרשאה");
  const rows = getSheetData("operations_private_notes").map(normalizeRow);
  const note = rows.find((r) => r.source_sheet === p.source_sheet && r.source_row_id === p.source_row_id);
  return { note: note?.note_text ?? "" };
}

function actionSavePrivateNote(p, user) {
  if (!boolPerm(user, "can_review_requests") && !boolPerm(user, "view_admin")) throw new Error("אין הרשאה");

  const rows = getSheetData("operations_private_notes");
  const idx  = rows.findIndex((r) => r.source_sheet === p.source_sheet && r.source_row_id === p.source_row_id);

  const noteData = {
    source_sheet:   p.source_sheet,
    source_row_id:  p.source_row_id,
    note_text:      p.note_text,
    updated_at:     new Date().toISOString(),
    updated_by:     user.full_name,
    active:         "yes",
  };

  if (idx === -1) {
    appendRow("operations_private_notes", noteData);
  } else {
    const sh = getSheet("operations_private_notes");
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const sheetRow = idx + 2;
    sh.getRange(sheetRow, 1, 1, headers.length).setValues([headers.map((h) => noteData[h] ?? "")]);
  }

  return { success: true };
}

function actionGetMyData(user) {
  requirePerm(user, "view_my_data");

  // Match by emp_id in permissions → contacts_instructors
  const instrRows = getSheetData("contacts_instructors");
  const instrMatch = instrRows.find((r) => r.full_name === user.full_name);
  const empId = instrMatch?.emp_id;

  const shorts = getSheetData("data_short").map(normalizeRow);
  const longs  = getSheetData("data_long").map(normalizeRow);
  let all = [...shorts, ...longs];

  if (empId) {
    all = all.filter((r) => r.emp_id === empId || r.emp_id_2 === empId);
  } else {
    // Fallback: match by name
    all = all.filter((r) =>
      r.instructor_name === user.full_name || r.instructor_name_2 === user.full_name
    );
  }

  return { activities: all };
}

function actionGetWeekData(p, user) {
  requirePerm(user, "view_week");

  const from = p.date_from;
  const to   = p.date_to;

  const shorts = getSheetData("data_short").map(normalizeRow);
  const longs  = getSheetData("data_long").map(normalizeRow);
  const meetings = getSheetData("activity_meetings").map(normalizeRow);

  // For data_short: use start_date directly
  // For data_long: use meetings dates
  const days = {};

  shorts.forEach((r) => {
    if (!r.start_date) return;
    if (r.start_date < from || r.start_date > to) return;
    if (applyWeekFilters(r, p)) {
      if (!days[r.start_date]) days[r.start_date] = [];
      days[r.start_date].push(r);
    }
  });

  // For longs, get all their meetings in range
  const longMap = {};
  longs.forEach((r) => { longMap[r.RowID] = r; });

  meetings.forEach((m) => {
    if (!m.meeting_date) return;
    const d = String(m.meeting_date).slice(0, 10);
    if (d < from || d > to) return;
    const act = longMap[m.source_row_id];
    if (!act) return;
    if (applyWeekFilters(act, p)) {
      if (!days[d]) days[d] = [];
      days[d].push({ ...act, meeting_date: d, meeting_no: m.meeting_no });
    }
  });

  return { days };
}

function actionGetMonthData(p, user) {
  requirePerm(user, "view_month");

  const year  = parseInt(p.year);
  const month = parseInt(p.month);
  const from  = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastD = new Date(year, month, 0).getDate();
  const to    = `${year}-${String(month).padStart(2, "0")}-${String(lastD).padStart(2, "0")}`;

  // Reuse week logic with month range
  return actionGetWeekData({ ...p, date_from: from, date_to: to }, user);
}

function applyWeekFilters(r, p) {
  if (p.instructor_name  && r.instructor_name  !== p.instructor_name)  return false;
  if (p.activity_type    && r.activity_type    !== p.activity_type)    return false;
  if (p.activity_manager && r.activity_manager !== p.activity_manager) return false;
  return true;
}

// ── Response helpers ──────────────────────────────────────────
function jsonOk(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError(msg, code) {
  return ContentService
    .createTextOutput(JSON.stringify({ error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

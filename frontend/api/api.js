// ============================================================
// api.js — All requests to Apps Script backend
// ============================================================

import { CONFIG } from "../config/config.js";
import { showToast } from "../shared/toast.js";

// ── Internal cache ──────────────────────────────────────────
const _cache = new Map();

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CONFIG.CACHE_TTL) { _cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data) {
  _cache.set(key, { ts: Date.now(), data });
}
export function cacheClear(prefix) {
  for (const k of _cache.keys()) {
    if (!prefix || k.startsWith(prefix)) _cache.delete(k);
  }
}

// ── Core request ────────────────────────────────────────────
async function request(action, params = {}, method = "GET") {
  const session = getSession();
  const payload = { action, user_id: session?.user_id, entry_code: session?.entry_code, ...params };

  try {
    let res;
    if (method === "GET") {
      const qs = new URLSearchParams(payload).toString();
      res = await fetch(`${CONFIG.API_URL}?${qs}`);
    } else {
      res = await fetch(CONFIG.API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  } catch (err) {
    showToast(`שגיאה: ${err.message}`, "error");
    throw err;
  }
}

// ── Session helpers ─────────────────────────────────────────
export function getSession() {
  try { return JSON.parse(localStorage.getItem(CONFIG.SESSION_KEY)); }
  catch { return null; }
}
export function setSession(user) {
  localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(CONFIG.SESSION_KEY);
}

// ── Auth ────────────────────────────────────────────────────
export async function login(entry_code) {
  const res = await request("login", { entry_code }, "POST");
  if (res.user) setSession(res.user);
  return res;
}

// ── Activities ───────────────────────────────────────────────
export async function getActivities(filters = {}) {
  const key = "activities_" + JSON.stringify(filters);
  const cached = cacheGet(key);
  if (cached) return cached;
  const res = await request("getActivities", filters);
  cacheSet(key, res);
  return res;
}

export async function getActivity(sheet, row_id) {
  return request("getActivity", { sheet, row_id });
}

export async function addActivity(sheet, data) {
  cacheClear("activities");
  return request("addActivity", { sheet, data: JSON.stringify(data) }, "POST");
}

export async function editActivityDirect(sheet, row_id, field, value) {
  cacheClear("activities");
  return request("editDirect", { sheet, row_id, field, value }, "POST");
}

// ── Edit requests ────────────────────────────────────────────
export async function submitEditRequest(source_sheet, source_row_id, field_name, old_value, new_value) {
  cacheClear("edit_requests");
  return request("submitEditRequest", { source_sheet, source_row_id, field_name, old_value, new_value }, "POST");
}

export async function getEditRequests(status = "pending") {
  const key = "edit_requests_" + status;
  const cached = cacheGet(key);
  if (cached) return cached;
  const res = await request("getEditRequests", { status });
  cacheSet(key, res);
  return res;
}

export async function reviewEditRequest(request_id, status, reviewer_notes = "") {
  cacheClear("edit_requests");
  cacheClear("activities");
  return request("reviewEditRequest", { request_id, status, reviewer_notes }, "POST");
}

// ── Meetings (data_long only) ────────────────────────────────
export async function getMeetings(source_row_id) {
  return request("getMeetings", { source_row_id });
}

// ── Dashboard stats ──────────────────────────────────────────
export async function getDashboardStats() {
  const cached = cacheGet("dashboard_stats");
  if (cached) return cached;
  const res = await request("getDashboardStats");
  cacheSet("dashboard_stats", res);
  return res;
}

// ── Instructors ──────────────────────────────────────────────
export async function getInstructors(active_only = true) {
  const key = "instructors_" + active_only;
  const cached = cacheGet(key);
  if (cached) return cached;
  const res = await request("getInstructors", { active_only });
  cacheSet(key, res);
  return res;
}

// ── Contacts ─────────────────────────────────────────────────
export async function getSchools() {
  const cached = cacheGet("schools");
  if (cached) return cached;
  const res = await request("getSchools");
  cacheSet("schools", res);
  return res;
}

// ── Lists (dropdown values) ──────────────────────────────────
export async function getLists() {
  const cached = cacheGet("lists");
  if (cached) return cached;
  const res = await request("getLists");
  cacheSet("lists", res);
  return res;
}

// ── Exceptions ───────────────────────────────────────────────
export async function getExceptions(filters = {}) {
  return request("getExceptions", filters);
}

// ── Finance ──────────────────────────────────────────────────
export async function getFinanceData(filters = {}) {
  return request("getFinanceData", filters);
}

// ── Permissions ──────────────────────────────────────────────
export async function getPermissions() {
  return request("getPermissions");
}
export async function savePermission(data) {
  cacheClear("permissions");
  return request("savePermission", { data: JSON.stringify(data) }, "POST");
}

// ── Private notes ────────────────────────────────────────────
export async function getPrivateNote(source_sheet, source_row_id) {
  return request("getPrivateNote", { source_sheet, source_row_id });
}
export async function savePrivateNote(source_sheet, source_row_id, note_text) {
  return request("savePrivateNote", { source_sheet, source_row_id, note_text }, "POST");
}

// ── My data (instructor view) ────────────────────────────────
export async function getMyData() {
  return request("getMyData");
}

// ── Week / Month ─────────────────────────────────────────────
export async function getWeekData(date_from, date_to, filters = {}) {
  return request("getWeekData", { date_from, date_to, ...filters });
}
export async function getMonthData(year, month, filters = {}) {
  return request("getMonthData", { year, month, ...filters });
}

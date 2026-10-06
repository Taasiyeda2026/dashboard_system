import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { PDFDocument, rgb } from "npm:pdf-lib@^1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import bidiFactory from "npm:bidi-js@1.0.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_DRIVE_ID = "b!7yHSW8aMokunngKw03vHhB5QSRQPWQ1JhXcgoDOvU2BFY5HnYLNMTZS2gZux2CMR";
const SHAREPOINT_HOST = "think365orgil.sharepoint.com";
const SHAREPOINT_SITE_PATH = "/sites/taasiyeda2027";
const PAYROLL_SUBFOLDER = "04 דוחות שכר";
const ALEF_REGULAR_URL = "https://raw.githubusercontent.com/Taasiyeda2026/dashboard_system/main/frontend/assets/fonts/Alef-Regular.ttf";
const ALEF_BOLD_URL = "https://raw.githubusercontent.com/Taasiyeda2026/dashboard_system/main/frontend/assets/fonts/Alef-Bold.ttf";
const HEBREW_MONTH_NAMES = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];
const bidi = bidiFactory();
let alefRegularPromise: Promise<Uint8Array> | null = null;
let alefBoldPromise: Promise<Uint8Array> | null = null;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeFileNamePart(value: string, fallback = "עובד") {
  const normalized = clean(value).replace(/[\/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function encodePath(path: string) {
  return path
    .split("/")
    .map((segment) => clean(segment))
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function monthKeyParts(monthKey: string) {
  const match = clean(monthKey).match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  return { year: match[1], month: Number(match[2]) };
}

function schoolYearFromMonthKey(monthKey: string) {
  const parts = monthKeyParts(monthKey);
  if (!parts) return "";
  return parts.month >= 9 ? String(Number(parts.year) + 1) : parts.year;
}

function hebrewMonthName(monthKey: string) {
  const parts = monthKeyParts(monthKey);
  return parts ? (HEBREW_MONTH_NAMES[parts.month - 1] || clean(monthKey)) : clean(monthKey);
}

function hebrewMonthYearLabel(monthKey: string) {
  const parts = monthKeyParts(monthKey);
  const name = hebrewMonthName(monthKey);
  return parts ? `${name} ${parts.year}` : name;
}

function payrollApprovalPdfFileName(employeeName: string, monthKey: string, version = 1) {
  const base = `דוח נוכחות - ${safeFileNamePart(employeeName)} - ${hebrewMonthYearLabel(monthKey)} - מאושר`;
  return version > 1 ? `${base} - ${version}.pdf` : `${base}.pdf`;
}

async function restRpcAuth(url: string, anonKey: string, authorization: string, rpc: string, payload: Record<string, unknown>) {
  const response = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${rpc}_failed:${response.status}:${detail.slice(0, 180)}`);
  }
  return await response.json();
}

async function restReadService(url: string, serviceKey: string, tableOrPath: string) {
  const response = await fetch(`${url}/rest/v1/${tableOrPath}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`service_read_failed:${response.status}:${detail.slice(0, 180)}`);
  }
  return await response.json();
}

async function graphToken() {
  const tenant = clean(Deno.env.get("MS_TENANT_ID"));
  const client = clean(Deno.env.get("MS_CLIENT_ID"));
  const secret = clean(Deno.env.get("MS_CLIENT_SECRET"));
  if (!tenant || !client || !secret) throw new Error("graph_not_configured");
  const body = new URLSearchParams({
    client_id: client,
    client_secret: secret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`graph_auth_failed:${response.status}`);
  const payload = await response.json();
  const token = clean(payload?.access_token);
  if (!token) throw new Error("graph_auth_missing_token");
  return token;
}

async function graphRequest(token: string, path: string, options: RequestInit = {}, allow404 = false) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`graph_request_failed:${response.status}:${detail.slice(0, 220)}`);
  }
  if (response.status === 204) return null;
  return await response.json();
}

function graphShareId(url: string) {
  const bytes = new TextEncoder().encode(url);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return `u!${btoa(binary).replace(/=+$/g, "").replace(/\//g, "_").replace(/\+/g, "-")}`;
}

function looksLikeSharingLink(folderWebUrl: string) {
  try {
    const url = new URL(folderWebUrl);
    return url.pathname.includes("/:f:/") || url.pathname.includes("/:u:/") || url.searchParams.has("e");
  } catch {
    return false;
  }
}

function normalizeDecodedPath(path: string) {
  try {
    return decodeURIComponent(path).replace(/\/+$/, "");
  } catch {
    return path.replace(/\/+$/, "");
  }
}

/** Convert SharePoint Forms/view.aspx?id=... links into canonical folder URLs. */
function normalizeFolderWebUrl(folderWebUrl: string) {
  const raw = clean(folderWebUrl);
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    const path = url.pathname.toLowerCase();
    const isFormsView = path.includes("/forms/view.aspx") || path.includes("/forms/allitems.aspx");
    if (!isFormsView) return raw;
    const folderId = url.searchParams.get("id") || url.searchParams.get("RootFolder") || "";
    if (!folderId) return raw;
    let decoded = folderId;
    try {
      decoded = decodeURIComponent(folderId);
    } catch {
      decoded = folderId;
    }
    if (!decoded.startsWith("/")) return raw;
    return `${url.origin}${decoded}`;
  } catch {
    return raw;
  }
}

async function resolveSharedFolderRoot(token: string, folderWebUrl: string) {
  if (!looksLikeSharingLink(folderWebUrl)) return null;
  const payload = await graphRequest(
    token,
    `/shares/${encodeURIComponent(graphShareId(folderWebUrl))}/driveItem?$select=id,name,webUrl,parentReference,folder,remoteItem`,
    {},
    true,
  );
  if (!payload) return null;
  const item = payload?.remoteItem || payload;
  const driveId = clean(item?.parentReference?.driveId || payload?.parentReference?.driveId);
  const itemId = clean(item?.id || payload?.id);
  const webUrl = clean(item?.webUrl || payload?.webUrl);
  if (!driveId || !itemId) return null;
  return { driveId, itemId, webUrl };
}

async function resolveCanonicalFolderRoot(token: string, folderWebUrl: string, fallbackDriveId: string) {
  const folderUrl = new URL(normalizeFolderWebUrl(folderWebUrl));
  const targetPath = normalizeDecodedPath(folderUrl.pathname);
  const site = await graphRequest(token, `/sites/${SHAREPOINT_HOST}:${SHAREPOINT_SITE_PATH}?$select=id,webUrl`);
  const siteId = clean(site?.id);
  if (!siteId) throw new Error("sharepoint_site_not_found");
  const drives = await graphRequest(token, `/sites/${encodeURIComponent(siteId)}/drives?$select=id,name,webUrl,driveType`);
  const driveRows = Array.isArray(drives?.value) ? drives.value : [];
  let drive = driveRows.find((row: { webUrl?: string }) => {
    if (!row?.webUrl) return false;
    try {
      const drivePath = normalizeDecodedPath(new URL(row.webUrl).pathname);
      return targetPath === drivePath || targetPath.startsWith(`${drivePath}/`);
    } catch {
      return false;
    }
  });
  drive ||= driveRows.find((row: { driveType?: string }) => clean(row?.driveType) === "documentLibrary");
  const driveId = clean(drive?.id) || fallbackDriveId;
  if (!driveId || !drive?.webUrl) throw new Error("sharepoint_document_library_not_found");
  const drivePath = normalizeDecodedPath(new URL(drive.webUrl).pathname);
  if (!(targetPath === drivePath || targetPath.startsWith(`${drivePath}/`))) {
    throw new Error("employee_folder_not_in_document_library");
  }
  const employeeRoot = targetPath.slice(drivePath.length).replace(/^\/+/, "");
  if (!employeeRoot) throw new Error("employee_folder_path_missing");
  const item = await graphRequest(
    token,
    `/drives/${encodeURIComponent(driveId)}/root:/${encodePath(employeeRoot)}?$select=id,name,webUrl,folder`,
    {},
    true,
  );
  const itemId = clean(item?.id);
  if (!itemId) throw new Error("employee_personal_folder_not_found");
  return { driveId, itemId, webUrl: clean(item?.webUrl) };
}

async function resolveEmployeeFolderRoot(token: string, folderWebUrl: string, fallbackDriveId: string) {
  const normalized = normalizeFolderWebUrl(folderWebUrl);
  const shared = await resolveSharedFolderRoot(token, normalized).catch(() => null);
  if (shared) return shared;
  return await resolveCanonicalFolderRoot(token, normalized, fallbackDriveId);
}

async function restRpcService(url: string, serviceKey: string, rpc: string, payload: Record<string, unknown>) {
  const response = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${rpc}_failed:${response.status}:${detail.slice(0, 180)}`);
  }
  return await response.json();
}

async function verifyTriggerSecret(req: Request, url: string, serviceKey: string) {
  const provided = clean(req.headers.get("x-av2-trigger-secret"));
  if (!provided) return false;
  const expectedEnv = clean(Deno.env.get("AV2_TRIGGER_SECRET"));
  if (expectedEnv && provided === expectedEnv) return true;
  try {
    const verified = await restRpcService(url, serviceKey, "av2_verify_trigger_secret", { p_secret: provided });
    return verified === true;
  } catch {
    return false;
  }
}

async function ensureChildFolder(token: string, driveId: string, parentItemId: string, name: string) {
  const existing = await graphRequest(
    token,
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentItemId)}:/${encodePath(name)}?$select=id,name,webUrl,folder`,
    {},
    true,
  );
  if (existing?.id && existing?.folder) {
    return { id: clean(existing.id), webUrl: clean(existing.webUrl), name: clean(existing.name) };
  }
  try {
    const created = await graphRequest(
      token,
      `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentItemId)}/children`,
      {
        method: "POST",
        body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
      },
    );
    return { id: clean(created?.id), webUrl: clean(created?.webUrl), name: clean(created?.name) };
  } catch (error) {
    const raced = await graphRequest(
      token,
      `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentItemId)}:/${encodePath(name)}?$select=id,name,webUrl,folder`,
      {},
      true,
    );
    if (raced?.id && raced?.folder) {
      return { id: clean(raced.id), webUrl: clean(raced.webUrl), name: clean(raced.name) };
    }
    throw error;
  }
}

async function uploadUniquePdf(
  token: string,
  driveId: string,
  folderItemId: string,
  employeeName: string,
  monthKey: string,
  startVersion: number,
  pdfBytes: Uint8Array,
) {
  let version = Math.max(1, startVersion);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const fileName = payrollApprovalPdfFileName(employeeName, monthKey, version);
    const existing = await graphRequest(
      token,
      `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderItemId)}:/${encodePath(fileName)}?$select=id,name`,
      {},
      true,
    );
    if (existing?.id) {
      version += 1;
      continue;
    }
    const uploadResponse = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderItemId)}:/${encodePath(fileName)}:/content?@microsoft.graph.conflictBehavior=fail`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf" },
        body: pdfBytes,
      },
    );
    if (uploadResponse.status === 409) {
      version += 1;
      continue;
    }
    if (!uploadResponse.ok) {
      const detail = await uploadResponse.text();
      throw new Error(`sharepoint_upload_failed:${uploadResponse.status}:${detail.slice(0, 220)}`);
    }
    const uploaded = await uploadResponse.json();
    return {
      fileName,
      version,
      sharepointItemId: clean(uploaded?.id),
      sharepointWebUrl: clean(uploaded?.webUrl),
    };
  }
  throw new Error("sharepoint_unique_filename_exhausted");
}

async function loadEmployeeFolderMapping(url: string, serviceKey: string, employeeId: string, monthKey: string) {
  const rows = await restReadService(
    url,
    serviceKey,
    `instructor_employee_folders?select=emp_id,school_year,folder_web_url,updated_at&emp_id=eq.${encodeURIComponent(employeeId)}&order=updated_at.desc`,
  );
  const mappings = (Array.isArray(rows) ? rows : []).filter((row) => clean(row?.folder_web_url));
  if (!mappings.length) throw new Error("employee_personal_folder_not_mapped");
  const schoolYear = schoolYearFromMonthKey(monthKey);
  const matchingYear = mappings.find((row) => clean(row?.school_year) === schoolYear);
  return matchingYear || mappings[0];
}

async function loadFontBytes(url: string, cache: "regular" | "bold") {
  const existing = cache === "regular" ? alefRegularPromise : alefBoldPromise;
  if (existing) return existing;
  const promise = fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`pdf_font_load_failed:${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  });
  if (cache === "regular") alefRegularPromise = promise;
  else alefBoldPromise = promise;
  return promise;
}

function rtlVisual(value: unknown) {
  const source = clean(value).replace(/\s+/g, " ");
  if (!source) return "";
  const chars = source.split("");
  const levels = bidi.getEmbeddingLevels(source, "rtl");
  const segments = bidi.getReorderSegments(source, levels);
  for (const [start, end] of segments) {
    let left = start;
    let right = end;
    while (left < right) {
      const temp = chars[left];
      chars[left] = chars[right];
      chars[right] = temp;
      left += 1;
      right -= 1;
    }
  }
  return chars.join("");
}

function pdfRtlText(value: unknown) {
  const visual = rtlVisual(value);
  if (!visual) return "";
  // pdf-lib/fontkit applies RTL glyph ordering for the embedded Hebrew font.
  // Feed it the reverse of the Unicode visual order so the final PDF renders
  // the intended RTL order while keeping LTR runs (dates, times, IDs) intact.
  return Array.from(visual).reverse().join("");
}

function formatDate(value: unknown) {
  const source = clean(value);
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : source;
}

function attendanceDateSortKey(value: unknown) {
  const source = clean(value);
  const iso = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const display = source.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (display) {
    return `${display[3]}-${display[2].padStart(2, "0")}-${display[1].padStart(2, "0")}`;
  }
  return "9999-99-99";
}

function formatApprovalTime(value: unknown) {
  const source = clean(value);
  if (!source) return "—";
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return source;
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function buildPdfBytes(payload: {
  employeeName: string;
  employeeId: string;
  monthKey: string;
  employeeApprovalName: string;
  employeeApprovalAt: string;
  managerApprovalName: string;
  managerApprovalAt: string;
  approvedSnapshot: Record<string, unknown>;
}) {
  const [regularBytes, boldBytes] = await Promise.all([
    loadFontBytes(ALEF_REGULAR_URL, "regular"),
    loadFontBytes(ALEF_BOLD_URL, "bold"),
  ]);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // Alef subsets cleanly with pdf-lib/fontkit. Arimo subset:true produced a
  // corrupt Hebrew glyph map while subset:false crashed fontkit during save.
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  const PAGE_W = 595;
  const PAGE_H = 842;
  const RIGHT = 555;
  const LEFT = 40;
  const CONTENT_W = RIGHT - LEFT;
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = 792;

  const ensureSpace = (height: number) => {
    if (y - height >= 48) return;
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = 792;
    drawHeader(false);
  };

  const drawRtl = (logicalText: unknown, xRight: number, yPos: number, size: number, font = regular, color = rgb(0.13, 0.16, 0.22)) => {
    const pdfText = pdfRtlText(logicalText);
    const width = font.widthOfTextAtSize(pdfText, size);
    page.drawText(pdfText, { x: Math.max(LEFT, xRight - width), y: yPos, size, font, color });
  };

  const wrapLogical = (logicalText: unknown, font = regular, size = 9, maxWidth = CONTENT_W) => {
    const source = clean(logicalText).replace(/\s+/g, " ");
    if (!source) return [] as string[];
    const words = source.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const width = font.widthOfTextAtSize(pdfRtlText(candidate), size);
      if (current && width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  const drawWrapped = (logicalText: unknown, options: { font?: typeof regular; size?: number; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) => {
    const font = options.font || regular;
    const size = options.size || 9;
    const right = RIGHT - (options.indent || 0);
    const lines = wrapLogical(logicalText, font, size, CONTENT_W - (options.indent || 0));
    for (const line of lines) {
      ensureSpace(size + 7);
      drawRtl(line, right, y, size, font, options.color || rgb(0.18, 0.22, 0.3));
      y -= size + 5;
    }
    y -= options.gap || 0;
  };

  const drawHeader = (first = true) => {
    page.drawRectangle({ x: LEFT, y: first ? 744 : 760, width: CONTENT_W, height: first ? 68 : 42, color: rgb(0.95, 0.97, 1) });
    drawRtl("תעשיידע — דוח נוכחות חודשי", RIGHT - 14, first ? 782 : 782, first ? 17 : 13, bold, rgb(0.10, 0.27, 0.52));
    if (first) {
      drawRtl(`${payload.employeeName}  |  ${hebrewMonthYearLabel(payload.monthKey)}`, RIGHT - 14, 758, 10, regular, rgb(0.28, 0.34, 0.44));
      y = 724;
    } else {
      y = 742;
    }
  };

  drawHeader(true);

  const snapshotRows = Array.isArray(payload.approvedSnapshot?.rows)
    ? payload.approvedSnapshot.rows as Record<string, unknown>[]
    : [];
  const rows = snapshotRows
    .map((row, sourceIndex) => ({ row, sourceIndex }))
    .sort((left, right) => {
      const dateCompare = attendanceDateSortKey(left.row.date).localeCompare(attendanceDateSortKey(right.row.date));
      if (dateCompare) return dateCompare;
      // Generated rows such as travel-time cancellation have no start time;
      // keep them after the timed activity for the same calendar day.
      const leftTime = clean(left.row.startTime) || "99:99";
      const rightTime = clean(right.row.startTime) || "99:99";
      const timeCompare = leftTime.localeCompare(rightTime);
      return timeCompare || left.sourceIndex - right.sourceIndex;
    })
    .map(({ row }) => row);
  const totalHours = rows.reduce((sum, row) => sum + toNumber(row.workHours), 0);
  const totalKm = rows.reduce((sum, row) => {
    const usesPt = row.publicTransport === true || row.publicTransport === "true" || row.publicTransport === 1;
    return usesPt ? sum : sum + toNumber(row.kilometers);
  }, 0);
  const totalExpenses = rows.reduce((sum, row) => sum + toNumber(row.expenses), 0);
  const totalPublicTransportCost = rows.reduce((sum, row) => {
    const usesPt = row.publicTransport === true || row.publicTransport === "true" || row.publicTransport === 1;
    return usesPt ? sum + toNumber(row.publicTransportCost) : sum;
  }, 0);

  page.drawRectangle({ x: LEFT, y: y - 68, width: CONTENT_W, height: 68, borderColor: rgb(0.88, 0.9, 0.94), borderWidth: 0.7, color: rgb(0.99, 0.995, 1) });
  drawRtl(`${rows.length} דיווחים`, RIGHT - 22, y - 22, 10, bold);
  drawRtl(`${totalHours.toFixed(2)} שעות`, RIGHT - 150, y - 22, 10, bold);
  drawRtl(`${totalKm.toFixed(0)} ק״מ`, RIGHT - 290, y - 22, 10, bold);
  drawRtl(`₪${totalExpenses.toFixed(2)} הוצאות`, RIGHT - 405, y - 22, 10, bold);
  const hasPublicTransport = rows.some((row) => row.publicTransport === true || row.publicTransport === "true" || row.publicTransport === 1);
  drawRtl(`מספר עובד: ${payload.employeeId}`, RIGHT - 22, y - 43, 8.5, regular, rgb(0.42, 0.46, 0.54));
  if (hasPublicTransport) {
    drawRtl(`₪${totalPublicTransportCost.toFixed(2)} תחבורה ציבורית`, RIGHT - 250, y - 43, 8.5, regular, rgb(0.42, 0.46, 0.54));
  }
  y -= 90;

  drawRtl("פירוט דיווחי הנוכחות", RIGHT, y, 12, bold, rgb(0.10, 0.27, 0.52));
  y -= 20;

  if (!rows.length) {
    drawWrapped("לא קיימים דיווחי נוכחות בחודש זה.", { size: 9.5 });
  } else {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || {};
      const activity = clean(row.activityType) || "פעילות";
      const date = formatDate(row.date) || "—";
      const time = `${clean(row.startTime) || "—"}–${clean(row.endTime) || "—"}`;
      const hours = toNumber(row.workHours).toFixed(2);
      const place = [clean(row.program), clean(row.school), clean(row.authority)].filter(Boolean).join(" | ");
      const usesPublicTransport = row.publicTransport === true || row.publicTransport === "true" || row.publicTransport === 1;
      const travelLabel = usesPublicTransport
        ? `תחבורה ציבורית${toNumber(row.publicTransportCost) ? ` ₪${toNumber(row.publicTransportCost).toFixed(2)}` : ""}`
        : (toNumber(row.kilometers) ? `${toNumber(row.kilometers).toFixed(0)} ק״מ` : "");
      const secondary = [
        clean(row.meetingNo) ? `מפגש ${clean(row.meetingNo)}` : "",
        travelLabel,
        toNumber(row.expenses) ? `₪${toNumber(row.expenses).toFixed(2)} הוצאות` : "",
      ].filter(Boolean).join(" | ");
      const notes = clean(row.notes);

      // Keep the attendance list dense enough for real monthly reports while
      // sizing every row from the lines it will actually draw. The previous
      // fixed base height omitted the secondary line, so expense/travel text
      // could fall below the box and be overdrawn by the next record.
      const primaryLines = wrapLogical(
        `${index + 1}. ${date}  |  ${activity}  |  ${time}  |  ${hours} שעות`,
        bold,
        8.6,
        CONTENT_W - 24,
      );
      const details = [place, secondary].filter(Boolean).join(" | ");
      const detailLines = details ? wrapLogical(details, regular, 7.8, CONTENT_W - 24) : [];
      const noteLines = notes ? wrapLogical(`הערה: ${notes}`, regular, 7.6, CONTENT_W - 24) : [];
      const PRIMARY_STEP = 10;
      const DETAIL_STEP = 9.5;
      const ROW_TOP_AND_BOTTOM = 10;
      const ROW_GAP = 2.5;
      const blockHeight = ROW_TOP_AND_BOTTOM
        + primaryLines.length * PRIMARY_STEP
        + (detailLines.length + noteLines.length) * DETAIL_STEP;
      ensureSpace(blockHeight + ROW_GAP);

      page.drawRectangle({
        x: LEFT,
        y: y - blockHeight,
        width: CONTENT_W,
        height: blockHeight,
        borderColor: rgb(0.9, 0.92, 0.95),
        borderWidth: 0.6,
        color: index % 2 === 0 ? rgb(1, 1, 1) : rgb(0.992, 0.995, 1),
      });

      let localY = y - 10;
      for (const line of primaryLines) {
        drawRtl(line, RIGHT - 10, localY, 8.6, bold);
        localY -= PRIMARY_STEP;
      }
      for (const line of detailLines) {
        drawRtl(line, RIGHT - 10, localY, 7.8, regular, rgb(0.28, 0.34, 0.44));
        localY -= DETAIL_STEP;
      }
      for (const line of noteLines) {
        drawRtl(line, RIGHT - 10, localY, 7.6, regular, rgb(0.42, 0.46, 0.54));
        localY -= DETAIL_STEP;
      }
      y -= blockHeight + ROW_GAP;
    }
  }

  ensureSpace(126);
  y -= 4;
  drawRtl("אישורים", RIGHT, y, 12, bold, rgb(0.10, 0.27, 0.52));
  y -= 18;

  const approvalBox = (title: string, name: string, at: string) => {
    page.drawRectangle({ x: LEFT, y: y - 49, width: CONTENT_W, height: 49, borderColor: rgb(0.86, 0.9, 0.88), borderWidth: 0.7, color: rgb(0.96, 0.99, 0.97) });
    drawRtl(`${title}: ${name || "—"}`, RIGHT - 12, y - 17, 9.3, bold, rgb(0.05, 0.38, 0.25));
    drawRtl(`אושר במערכת  |  ${formatApprovalTime(at)}`, RIGHT - 12, y - 35, 8.4, regular, rgb(0.24, 0.43, 0.35));
    y -= 58;
  };

  approvalBox("אישור עובד", payload.employeeApprovalName, payload.employeeApprovalAt);
  approvalBox("אישור מנהל", payload.managerApprovalName, payload.managerApprovalAt);

  drawRtl("המסמך הופק ממערכת הנוכחות של תעשיידע ומהווה תיעוד של הנתונים שאושרו במערכת.", RIGHT, 28, 7.5, regular, rgb(0.5, 0.54, 0.6));

  const bytes = await pdf.save();
  return new Uint8Array(bytes);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
    const supabaseAnonKey = clean(Deno.env.get("SUPABASE_ANON_KEY"));
    const supabaseServiceRole = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const authorization = clean(req.headers.get("authorization"));
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRole || !authorization) {
      throw new Error("supabase_env_not_configured");
    }

    const body = await req.json().catch(() => ({}));
    const employeeId = clean(body?.employeeId || body?.employee_id);
    const employeeNameInput = clean(body?.employeeName || body?.employee_name);
    const monthKey = clean(body?.monthKey || body?.month_key);
    let managerApprovalName = clean(body?.managerApprovalName || body?.manager_approval_name);
    let managerApprovalAt = clean(body?.managerApprovalAt || body?.manager_approval_at);
    let employeeApprovalName = clean(body?.employeeApprovalName || body?.employee_approval_name);
    let employeeApprovalAt = clean(body?.employeeApprovalAt || body?.employee_approval_at);
    let approvedSnapshot = (body?.approvedSnapshot && typeof body.approvedSnapshot === "object")
      ? body.approvedSnapshot as Record<string, unknown>
      : {};
    const wantsRetry = body?.retry === true || body?.retry === "true" || body?.mode === "retry";
    const wantsForceRegenerate = body?.forceRegenerate === true || body?.force_regenerate === true;
    const suppressEmail = body?.suppressEmail === true || body?.suppress_email === true;
    const bearerToken = authorization.replace(/^Bearer\s+/i, "").trim();
    const isServiceCaller = bearerToken === supabaseServiceRole;
    const isSecretRetry = wantsRetry && await verifyTriggerSecret(req, supabaseUrl, supabaseServiceRole);
    const isRetryCaller = wantsRetry && (isSecretRetry || isServiceCaller);
    if (wantsRetry && !isRetryCaller) throw new Error("not_authorized");
    if ((wantsForceRegenerate || suppressEmail) && !isRetryCaller) throw new Error("not_authorized");

    if (!employeeId || !monthKey) throw new Error("employee_id_and_month_required");

    let currentUser: Record<string, unknown> | null = null;
    if (!isRetryCaller) {
      const currentUserRows = await restRpcAuth(supabaseUrl, supabaseAnonKey, authorization, "get_current_app_user", {});
      currentUser = (Array.isArray(currentUserRows) ? currentUserRows[0] : currentUserRows) as Record<string, unknown>;
      const role = clean(currentUser?.role).toLowerCase();
      if (!currentUser?.is_active || !["admin", "operation_manager", "activities_manager", "manager", "instructor_manager"].includes(role)) {
        throw new Error("not_authorized");
      }
    }

    const monthApprovalRows = await restReadService(
      supabaseUrl,
      supabaseServiceRole,
      `attendance_month_approvals?select=status,submitted_at,submitted_by_name,manager_approved_at,manager_approved_by_user_id,manager_approved_by_name,manager_approved_snapshot,manager_pdf_sharepoint_url,manager_pdf_sharepoint_item_id,manager_pdf_file_name,manager_pdf_version&emp_id=eq.${encodeURIComponent(employeeId)}&month_key=eq.${encodeURIComponent(monthKey)}&limit=1`,
    );
    const approvalRow = Array.isArray(monthApprovalRows) ? monthApprovalRows[0] : null;
    if (!approvalRow) throw new Error("attendance_month_not_found");

    const approvalStatus = clean(approvalRow.status).toLowerCase();
    const existingPdfUrl = clean(approvalRow.manager_pdf_sharepoint_url);
    const existingPdfItemId = clean(approvalRow.manager_pdf_sharepoint_item_id);
    const existingPdfFileName = clean(approvalRow.manager_pdf_file_name);
    const existingPdfVersion = Number(approvalRow.manager_pdf_version || 0);
    const isLockedApproval = approvalStatus === "locked" && Boolean(clean(approvalRow.manager_approved_at));
    const isSubmittedApproval = approvalStatus === "submitted";

    if (!isSubmittedApproval && !isLockedApproval) {
      throw new Error("employee_month_not_submitted");
    }

    // After manager approval the month is locked. PDF generation/retry must use
    // the locked approved snapshot so artifacts cannot drift from the approval.
    if (isLockedApproval) {
      if (approvalRow.manager_approved_snapshot && typeof approvalRow.manager_approved_snapshot === "object") {
        approvedSnapshot = approvalRow.manager_approved_snapshot as Record<string, unknown>;
      }
      managerApprovalName = managerApprovalName || clean(approvalRow.manager_approved_by_name);
      managerApprovalAt = managerApprovalAt || clean(approvalRow.manager_approved_at);
      employeeApprovalName = employeeApprovalName || clean(approvalRow.submitted_by_name);
      employeeApprovalAt = employeeApprovalAt || clean(approvalRow.submitted_at);
      if (isRetryCaller) {
        const approverUserId = clean(approvalRow.manager_approved_by_user_id);
        if (approverUserId) {
          const approverRows = await restReadService(
            supabaseUrl,
            supabaseServiceRole,
            `users?select=auth_user_id,full_name,name,email,auth_email,is_active&auth_user_id=eq.${encodeURIComponent(approverUserId)}&is_active=eq.true&limit=1`,
          );
          currentUser = (Array.isArray(approverRows) ? approverRows[0] : null) as Record<string, unknown> | null;
        }
      }
    } else if (!isRetryCaller) {
      const monthRows = await restRpcAuth(supabaseUrl, supabaseAnonKey, authorization, "get_payroll_attendance_month_statuses", {
        p_month_key: monthKey,
        p_employee_ids: [employeeId],
      });
      const monthRow = Array.isArray(monthRows) ? monthRows[0] : null;
      if (!monthRow) throw new Error("employee_month_not_visible_to_user");
      employeeApprovalName = employeeApprovalName || clean(monthRow.submitted_by_name);
      employeeApprovalAt = employeeApprovalAt || clean(monthRow.submitted_at);
    }

    if (!managerApprovalName) throw new Error("manager_name_required");
    managerApprovalAt = managerApprovalAt || new Date().toISOString();

    // Idempotent retry: never upload a second PDF once metadata is attached.
    if (isLockedApproval && existingPdfUrl && existingPdfFileName && !wantsForceRegenerate) {
      return json({
        employeeId,
        employeeName: safeFileNamePart(employeeNameInput || clean((approvedSnapshot as { employeeName?: string })?.employeeName) || `עובד ${employeeId}`, `עובד ${employeeId}`),
        monthKey,
        fileName: existingPdfFileName,
        managerPdfVersion: Number.isFinite(existingPdfVersion) ? existingPdfVersion : 1,
        sharepointItemId: existingPdfItemId,
        sharepointWebUrl: existingPdfUrl,
        sharepointFolderWebUrl: "",
        employeeEmail: "",
        reusedExistingPdf: true,
        mailSent: false,
        mailError: "",
        mailedAt: "",
        attachedToApproval: true,
      });
    }

    const contactRows = await restReadService(
      supabaseUrl,
      supabaseServiceRole,
      `contacts_instructors?select=emp_id,full_name,email&emp_id=eq.${encodeURIComponent(employeeId)}&limit=1`,
    );
    const userRows = await restReadService(
      supabaseUrl,
      supabaseServiceRole,
      `users?select=emp_id,full_name,name,email,auth_email,is_active&emp_id=eq.${encodeURIComponent(employeeId)}&is_active=eq.true&limit=1`,
    );
    const contact = Array.isArray(contactRows) ? contactRows[0] : null;
    const user = Array.isArray(userRows) ? userRows[0] : null;
    const employeeName = safeFileNamePart(
      employeeNameInput
      || clean((approvedSnapshot as { employeeName?: string })?.employeeName)
      || clean(contact?.full_name)
      || clean(user?.full_name)
      || clean(user?.name)
      || `עובד ${employeeId}`,
      `עובד ${employeeId}`,
    );
    const employeeEmail = clean(contact?.email || user?.auth_email || user?.email).toLowerCase();
    if (!employeeEmail) throw new Error("employee_email_missing");

    const monthText = hebrewMonthYearLabel(monthKey);
    const monthFolderName = hebrewMonthName(monthKey);
    const nextVersion = Number.isFinite(existingPdfVersion) && existingPdfVersion > 0 ? existingPdfVersion + 1 : 1;
    const pdfBytes = await buildPdfBytes({
      employeeName,
      employeeId,
      monthKey,
      employeeApprovalName: employeeApprovalName || employeeName,
      employeeApprovalAt,
      managerApprovalName,
      managerApprovalAt,
      approvedSnapshot,
    });

    const mapping = await loadEmployeeFolderMapping(supabaseUrl, supabaseServiceRole, employeeId, monthKey);
    const folderWebUrl = clean(mapping?.folder_web_url);
    if (!folderWebUrl) throw new Error("employee_personal_folder_not_mapped");

    const graphAccessToken = await graphToken();
    const fallbackDriveId = clean(Deno.env.get("MS_SHAREPOINT_DRIVE_ID")) || DEFAULT_DRIVE_ID;
    const employeeRoot = await resolveEmployeeFolderRoot(graphAccessToken, folderWebUrl, fallbackDriveId);
    const payrollFolder = await ensureChildFolder(graphAccessToken, employeeRoot.driveId, employeeRoot.itemId, PAYROLL_SUBFOLDER);
    const monthFolder = await ensureChildFolder(graphAccessToken, employeeRoot.driveId, payrollFolder.id, monthFolderName);
    if (!monthFolder.id) throw new Error("sharepoint_month_folder_missing");

    // Upload a new unique PDF for this approval snapshot. Duplicate prevention for
    // retries is enforced by returning existing manager_pdf_* metadata above and
    // by attach_manager_attendance_month_pdf idempotency in the database.
    const uploaded = await uploadUniquePdf(
      graphAccessToken,
      employeeRoot.driveId,
      monthFolder.id,
      employeeName,
      monthKey,
      nextVersion,
      pdfBytes,
    );
    if (!uploaded.sharepointWebUrl || !uploaded.sharepointItemId) throw new Error("sharepoint_upload_missing_url");

    let attachedToApproval = false;
    if (isLockedApproval) {
      const attachRpc = wantsForceRegenerate
        ? "replace_manager_attendance_month_pdf"
        : "attach_manager_attendance_month_pdf";
      const attached = await restRpcService(supabaseUrl, supabaseServiceRole, attachRpc, {
        p_employee_id: employeeId,
        p_month_key: monthKey,
        p_manager_pdf_sharepoint_url: uploaded.sharepointWebUrl,
        p_manager_pdf_sharepoint_item_id: uploaded.sharepointItemId,
        p_manager_pdf_file_name: uploaded.fileName,
        p_manager_pdf_version: uploaded.version,
      });
      attachedToApproval = attached?.attached === true || attached?.already_attached === true;
      if (!wantsForceRegenerate && attached?.already_attached === true && clean(attached?.manager_pdf_sharepoint_url)) {
        return json({
          employeeId,
          employeeName,
          monthKey,
          fileName: clean(attached.manager_pdf_file_name) || uploaded.fileName,
          managerPdfVersion: Number(attached.manager_pdf_version || uploaded.version),
          sharepointItemId: clean(attached.manager_pdf_sharepoint_item_id) || uploaded.sharepointItemId,
          sharepointWebUrl: clean(attached.manager_pdf_sharepoint_url),
          sharepointFolderWebUrl: monthFolder.webUrl,
          employeeEmail,
          reusedExistingPdf: true,
          mailSent: false,
          mailError: "",
          mailedAt: "",
          attachedToApproval: true,
        });
      }
    }

    // Email delivery is best-effort and must not invalidate approval or PDF.
    // Forced regenerations may explicitly suppress delivery so repaired artifacts
    // can be verified before any employee receives a replacement.
    let mailedAt = "";
    let mailError = "";
    const mailSuppressed = suppressEmail;
    const sender = clean(currentUser?.auth_email || currentUser?.email).toLowerCase();
    if (mailSuppressed) {
      console.info("[payroll-attendance-pdf-dispatch] email suppressed for PDF regeneration", {
        employeeId,
        monthKey,
        managerPdfVersion: uploaded.version,
      });
    } else if (!sender) {
      mailError = "approver_email_missing";
    } else {
      try {
        const emailBody = [
          "שלום,",
          "",
          "מצורף דוח הנוכחות המאושר לחודש המבוקש.",
          `חודש: ${monthText}`,
          `קישור SharePoint: ${uploaded.sharepointWebUrl}`,
          "",
          "בברכה",
          "מערכת הנוכחות",
        ].join("\n");
        const mailResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
          method: "POST",
          headers: { Authorization: `Bearer ${graphAccessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: {
              subject: `דוח נוכחות מאושר - ${employeeName} - ${monthText}`,
              body: { contentType: "Text", content: emailBody },
              toRecipients: [{ emailAddress: { address: employeeEmail } }],
              attachments: [{
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: uploaded.fileName,
                contentType: "application/pdf",
                contentBytes: toBase64(pdfBytes),
              }],
            },
            saveToSentItems: false,
          }),
        });
        if (!mailResponse.ok) {
          const detail = await mailResponse.text();
          mailError = `mail_send_failed:${mailResponse.status}:${detail.slice(0, 220)}`;
        } else {
          mailedAt = new Date().toISOString();
        }
      } catch (error) {
        mailError = `mail_send_failed:network:${clean((error as Error)?.message).slice(0, 220)}`;
      }
    }
    if (mailError) {
      console.error("[payroll-attendance-pdf-dispatch] email delivery failed after PDF persistence", {
        employeeId,
        monthKey,
        error: mailError,
      });
    }

    return json({
      employeeId,
      employeeName,
      monthKey,
      fileName: uploaded.fileName,
      managerPdfVersion: uploaded.version,
      sharepointItemId: uploaded.sharepointItemId,
      sharepointWebUrl: uploaded.sharepointWebUrl,
      sharepointFolderWebUrl: monthFolder.webUrl,
      employeeEmail,
      reusedExistingPdf: false,
      mailSent: !mailSuppressed && !mailError,
      mailSuppressed,
      mailError: mailError ? mailError.split(":").slice(0, 2).join(":") : "",
      mailedAt,
      attachedToApproval,
    });
  } catch (error) {
    const message = clean((error as Error)?.message) || "payroll_attendance_pdf_dispatch_failed";
    const status = message === "not_authorized" ? 403 : 500;
    return json({ error: message }, status);
  }
});

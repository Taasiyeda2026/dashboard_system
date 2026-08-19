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
const ARIMO_REGULAR_URL = "https://raw.githubusercontent.com/Taasiyeda2026/dashboard_system/main/frontend/assets/fonts/Arimo-Regular.ttf";
const ARIMO_BOLD_URL = "https://raw.githubusercontent.com/Taasiyeda2026/dashboard_system/main/frontend/assets/fonts/Arimo-Bold.ttf";
const HEBREW_MONTH_NAMES = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];
const bidi = bidiFactory();
let arimoRegularPromise: Promise<Uint8Array> | null = null;
let arimoBoldPromise: Promise<Uint8Array> | null = null;

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
  const folderUrl = new URL(folderWebUrl);
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
  const shared = await resolveSharedFolderRoot(token, folderWebUrl).catch(() => null);
  if (shared) return shared;
  return await resolveCanonicalFolderRoot(token, folderWebUrl, fallbackDriveId);
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
  const existing = cache === "regular" ? arimoRegularPromise : arimoBoldPromise;
  if (existing) return existing;
  const promise = fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`pdf_font_load_failed:${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  });
  if (cache === "regular") arimoRegularPromise = promise;
  else arimoBoldPromise = promise;
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

function formatDate(value: unknown) {
  const source = clean(value);
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : source;
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
    loadFontBytes(ARIMO_REGULAR_URL, "regular"),
    loadFontBytes(ARIMO_BOLD_URL, "bold"),
  ]);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
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
    const visual = rtlVisual(logicalText);
    const width = font.widthOfTextAtSize(visual, size);
    page.drawText(visual, { x: Math.max(LEFT, xRight - width), y: yPos, size, font, color });
  };

  const wrapLogical = (logicalText: unknown, font = regular, size = 9, maxWidth = CONTENT_W) => {
    const source = clean(logicalText).replace(/\s+/g, " ");
    if (!source) return [] as string[];
    const words = source.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const width = font.widthOfTextAtSize(rtlVisual(candidate), size);
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

  const rows = Array.isArray(payload.approvedSnapshot?.rows)
    ? payload.approvedSnapshot.rows as Record<string, unknown>[]
    : [];
  const totalHours = rows.reduce((sum, row) => sum + toNumber(row.workHours), 0);
  const totalKm = rows.reduce((sum, row) => sum + toNumber(row.kilometers), 0);
  const totalExpenses = rows.reduce((sum, row) => sum + toNumber(row.expenses), 0);

  page.drawRectangle({ x: LEFT, y: y - 56, width: CONTENT_W, height: 56, borderColor: rgb(0.88, 0.9, 0.94), borderWidth: 0.7, color: rgb(0.99, 0.995, 1) });
  drawRtl(`${rows.length} דיווחים`, RIGHT - 22, y - 22, 10, bold);
  drawRtl(`${totalHours.toFixed(2)} שעות`, RIGHT - 150, y - 22, 10, bold);
  drawRtl(`${totalKm.toFixed(0)} ק״מ`, RIGHT - 290, y - 22, 10, bold);
  drawRtl(`₪${totalExpenses.toFixed(2)} הוצאות`, RIGHT - 405, y - 22, 10, bold);
  drawRtl(`מספר עובד: ${payload.employeeId}`, RIGHT - 22, y - 43, 8.5, regular, rgb(0.42, 0.46, 0.54));
  y -= 78;

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
      const secondary = [
        clean(row.meetingNo) ? `מפגש ${clean(row.meetingNo)}` : "",
        toNumber(row.kilometers) ? `${toNumber(row.kilometers).toFixed(0)} ק״מ` : "",
        toNumber(row.expenses) ? `₪${toNumber(row.expenses).toFixed(2)} הוצאות` : "",
      ].filter(Boolean).join(" | ");
      const notes = clean(row.notes);
      const placeLines = wrapLogical(place, regular, 8.5, CONTENT_W - 28);
      const noteLines = notes ? wrapLogical(`הערה: ${notes}`, regular, 8.2, CONTENT_W - 28) : [];
      const blockHeight = 49 + Math.max(0, placeLines.length - 1) * 12 + noteLines.length * 12;
      ensureSpace(blockHeight + 12);

      page.drawRectangle({
        x: LEFT,
        y: y - blockHeight,
        width: CONTENT_W,
        height: blockHeight,
        borderColor: rgb(0.9, 0.92, 0.95),
        borderWidth: 0.6,
        color: index % 2 === 0 ? rgb(1, 1, 1) : rgb(0.992, 0.995, 1),
      });
      drawRtl(`${index + 1}. ${date}  |  ${activity}`, RIGHT - 12, y - 16, 9.5, bold);
      drawRtl(`${time}  |  ${hours} שעות`, RIGHT - 12, y - 32, 8.7, regular, rgb(0.28, 0.34, 0.44));
      let localY = y - 47;
      for (const line of placeLines) {
        drawRtl(line, RIGHT - 12, localY, 8.5, regular, rgb(0.28, 0.34, 0.44));
        localY -= 12;
      }
      if (secondary) {
        drawRtl(secondary, RIGHT - 12, localY, 8.2, regular, rgb(0.42, 0.46, 0.54));
        localY -= 12;
      }
      for (const line of noteLines) {
        drawRtl(line, RIGHT - 12, localY, 8.2, regular, rgb(0.42, 0.46, 0.54));
        localY -= 12;
      }
      y -= blockHeight + 9;
    }
  }

  ensureSpace(126);
  y -= 4;
  drawRtl("אישורים", RIGHT, y, 12, bold, rgb(0.10, 0.27, 0.52));
  y -= 18;

  const approvalBox = (title: string, name: string, at: string) => {
    page.drawRectangle({ x: LEFT, y: y - 49, width: CONTENT_W, height: 49, borderColor: rgb(0.86, 0.9, 0.88), borderWidth: 0.7, color: rgb(0.96, 0.99, 0.97) });
    drawRtl(`${title}: ${name || "—"}`, RIGHT - 12, y - 17, 9.3, bold, rgb(0.05, 0.38, 0.25));
    drawRtl(`✓ אושר במערכת  |  ${formatApprovalTime(at)}`, RIGHT - 12, y - 35, 8.4, regular, rgb(0.24, 0.43, 0.35));
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
    const managerApprovalName = clean(body?.managerApprovalName || body?.manager_approval_name);
    const managerApprovalAt = clean(body?.managerApprovalAt || body?.manager_approval_at) || new Date().toISOString();
    const employeeApprovalName = clean(body?.employeeApprovalName || body?.employee_approval_name);
    const employeeApprovalAt = clean(body?.employeeApprovalAt || body?.employee_approval_at);
    const approvedSnapshot = (body?.approvedSnapshot && typeof body.approvedSnapshot === "object")
      ? body.approvedSnapshot as Record<string, unknown>
      : {};

    if (!employeeId || !monthKey) throw new Error("employee_id_and_month_required");
    if (!managerApprovalName) throw new Error("manager_name_required");

    const currentUserRows = await restRpcAuth(supabaseUrl, supabaseAnonKey, authorization, "get_current_app_user", {});
    const currentUser = Array.isArray(currentUserRows) ? currentUserRows[0] : currentUserRows;
    const role = clean(currentUser?.role).toLowerCase();
    if (!currentUser?.is_active || !["admin", "operation_manager", "activities_manager", "manager", "instructor_manager"].includes(role)) {
      throw new Error("not_authorized");
    }

    const monthRows = await restRpcAuth(supabaseUrl, supabaseAnonKey, authorization, "get_payroll_attendance_month_statuses", {
      p_month_key: monthKey,
      p_employee_ids: [employeeId],
    });
    const monthRow = Array.isArray(monthRows) ? monthRows[0] : null;
    if (!monthRow) throw new Error("employee_month_not_visible_to_user");
    if (clean(monthRow.attendance_submission_status) !== "submitted") {
      throw new Error("employee_month_not_submitted");
    }

    const monthApprovalRows = await restReadService(
      supabaseUrl,
      supabaseServiceRole,
      `attendance_month_approvals?select=manager_pdf_version&emp_id=eq.${encodeURIComponent(employeeId)}&month_key=eq.${encodeURIComponent(monthKey)}&limit=1`,
    );
    const currentVersion = Number(Array.isArray(monthApprovalRows) ? monthApprovalRows[0]?.manager_pdf_version : 0);
    const nextVersion = Number.isFinite(currentVersion) && currentVersion > 0 ? currentVersion + 1 : 1;

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
    const pdfBytes = await buildPdfBytes({
      employeeName,
      employeeId,
      monthKey,
      employeeApprovalName: employeeApprovalName || clean(monthRow.submitted_by_name) || employeeName,
      employeeApprovalAt: employeeApprovalAt || clean(monthRow.submitted_at),
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

    const sender = clean(Deno.env.get("MS_MAIL_SENDER"));
    if (!sender) throw new Error("mail_sender_not_configured");
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
      throw new Error(`mail_send_failed:${mailResponse.status}:${detail.slice(0, 220)}`);
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
      mailedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = clean((error as Error)?.message) || "payroll_attendance_pdf_dispatch_failed";
    const status = message === "not_authorized" ? 403 : 500;
    return json({ error: message }, status);
  }
});

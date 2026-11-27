import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Admin-only SharePoint upload/link helper for Gefen tender 2027.
 * Credentials stay in Edge Function secrets (MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET).
 */

const DRIVE = "b!7yHSW8aMokunngKw03vHhB5QSRQPWQ1JhXcgoDOvU2BFY5HnYLNMTZS2gZux2CMR";
const ROOT = "ניהול/מכרז גפן 2027";
const GRAPH = "https://graph.microsoft.com/v1.0/drives/" + encodeURIComponent(DRIVE);
const MAX_BYTES = 5 * 1024 * 1024;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const txt = (v: unknown) => String(v ?? "").trim();
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

class HttpFailure extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function encodePath(path: string) {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function safeName(name: string) {
  return txt(name).replace(/[\/\\:*?"<>|#%\x00-\x1f]+/g, " ").replace(/\s+/g, " ").slice(0, 120).trim() || "document";
}

function sanitizeSegment(value: string) {
  return safeName(value).replace(/^\.+/, "").slice(0, 90) || "כללי";
}

async function assertAdmin(req: Request) {
  const authorization = txt(req.headers.get("authorization"));
  const url = txt(Deno.env.get("SUPABASE_URL"));
  const apikey = txt(Deno.env.get("SUPABASE_ANON_KEY"));
  if (!authorization.startsWith("Bearer ") || !url || !apikey) {
    throw new HttpFailure("נדרשת התחברות למערכת.", 401);
  }
  const r = await fetch(`${url}/rest/v1/rpc/get_current_app_user`, {
    method: "POST",
    headers: { Authorization: authorization, apikey, "Content-Type": "application/json" },
    body: "{}"
  });
  if (!r.ok) throw new HttpFailure("לא ניתן לאמת הרשאה.", 403);
  const payload = await r.json();
  const user = Array.isArray(payload) ? payload[0] : payload;
  if (user?.is_active !== true || txt(user?.role) !== "admin") {
    throw new HttpFailure("העלאת מסמכי מכרז גפ״ן מותרת למנהלים בלבד.", 403);
  }
  return user;
}

async function graphToken() {
  const tenant = txt(Deno.env.get("MS_TENANT_ID"));
  const client = txt(Deno.env.get("MS_CLIENT_ID"));
  const secret = txt(Deno.env.get("MS_CLIENT_SECRET"));
  if (!tenant || !client || !secret) throw new HttpFailure("חיבור SharePoint אינו מוגדר בשרת.", 503);
  const r = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client,
        client_secret: secret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default"
      })
    }
  );
  if (!r.ok) throw new HttpFailure("אימות SharePoint נכשל.", 502);
  const token = txt((await r.json()).access_token);
  if (!token) throw new HttpFailure("לא התקבל אסימון SharePoint.", 502);
  return token;
}

async function graph(token: string, path: string, options: RequestInit = {}, allow404 = false) {
  const url = path.startsWith("https://") ? path : GRAPH + path;
  const r = await fetch(url, {
    ...options,
    headers: { Authorization: "Bearer " + token, ...(options.headers || {}) }
  });
  if (allow404 && r.status === 404) return null;
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new HttpFailure(`שירות SharePoint החזיר ${r.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`, 502);
  }
  if (r.status === 204) return null;
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await r.json();
  return r;
}

async function ensureFolder(token: string, folderPath: string) {
  const parts = folderPath.split("/").filter(Boolean).map(sanitizeSegment);
  let currentPath = "";
  let currentId = "root";
  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const existing = await graph(
      token,
      `/root:/${encodePath(currentPath)}?$select=id,name,webUrl,folder`,
      {},
      true
    );
    if (existing?.id) {
      currentId = existing.id;
      continue;
    }
    const created = await graph(token, `/items/${encodeURIComponent(currentId)}/children`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: part,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail"
      })
    });
    currentId = created.id;
  }
  const folder = await graph(token, `/items/${encodeURIComponent(currentId)}?$select=id,name,webUrl`);
  return folder;
}

function resolveFolderPath(body: Record<string, unknown>) {
  const area = txt(body.area);
  const program = sanitizeSegment(txt(body.program_title) || txt(body.program_id) || "תוכנית");
  const person = sanitizeSegment(txt(body.person_name) || "איש צוות");
  const section = sanitizeSegment(txt(body.section_label) || `סעיף-${txt(body.section_number) || "0"}`);
  const recFolder = sanitizeSegment(txt(body.recommendations_folder) || program);

  switch (area) {
    case "administrative":
      return `${ROOT}/11 - טופס מנהלי והצהרות/${section}`;
    case "program":
      return `${ROOT}/04 - חומרי תוכניות/${program}`;
    case "recommendations":
      return `${ROOT}/05 - המלצות/${recFolder}`;
    case "experience":
      return `${ROOT}/07 - ניסיון בהפעלת תוכניות/${program}`;
    case "operator":
      return `${ROOT}/06 - מפתחים ומפעילים/${person}`;
    case "evidence":
      return `${ROOT}/08 - אישורים ואסמכתאות/${program}`;
    case "documents":
      return `${ROOT}/08 - אישורים ואסמכתאות/${program}`;
    default:
      throw new HttpFailure("אזור העלאה לא מוכר.", 400);
  }
}

function readBytes(base64: unknown) {
  const raw = txt(base64).replace(/^data:[^;]+;base64,/, "");
  if (!raw) throw new HttpFailure("תוכן הקובץ חסר.");
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.byteLength <= 0) throw new HttpFailure("הקובץ ריק.");
  if (bytes.byteLength > MAX_BYTES) throw new HttpFailure("גודל הקובץ חורג מ־5MB.", 413);
  return bytes;
}

function guessMime(name: string, provided: string) {
  const lower = name.toLowerCase();
  if (provided && provided !== "application/octet-stream") return provided;
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (/\.jpe?g$/.test(lower)) return "image/jpeg";
  if (/\.docx?$/.test(lower)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (/\.xlsx?$/.test(lower)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/octet-stream";
}

async function handle(req: Request) {
  await assertAdmin(req);
  if (req.method !== "POST") throw new HttpFailure("שיטת בקשה לא נתמכת.", 405);
  const body = await req.json().catch(() => ({}));
  const action = txt(body.action) || "upload";
  const token = await graphToken();

  if (action === "ensure_folder") {
    const folderPath = resolveFolderPath(body);
    const folder = await ensureFolder(token, folderPath);
    return respond({
      folder_path: folderPath,
      folder_id: folder.id,
      folder_url: folder.webUrl || null
    });
  }

  if (action === "upload") {
    const folderPath = resolveFolderPath(body);
    const folder = await ensureFolder(token, folderPath);
    const originalName = safeName(txt(body.file_name));
    const bytes = readBytes(body.base64);
    const mime = guessMime(originalName, txt(body.mime_type));
    const stamped = `${new Date().toISOString().slice(0, 10)}_${crypto.randomUUID().slice(0, 8)}_${originalName}`;
    const uploadPath = `/items/${encodeURIComponent(folder.id)}:/${encodeURIComponent(stamped)}:/content`;
    const item = await graph(token, uploadPath, {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: bytes
    });
    if (!item?.id) throw new HttpFailure("SharePoint לא החזיר מזהה מסמך.", 502);
    return respond({
      document: {
        id: crypto.randomUUID(),
        name: originalName,
        stored_name: stamped,
        url: item.webUrl || null,
        item_id: item.id,
        drive_id: DRIVE,
        folder_path: folderPath,
        folder_url: folder.webUrl || null,
        mime_type: mime,
        size_bytes: bytes.byteLength,
        uploaded_at: new Date().toISOString(),
        source: "upload"
      }
    });
  }

  if (action === "delete") {
    const itemId = txt(body.item_id);
    if (!itemId) throw new HttpFailure("חסר מזהה מסמך.");
    await graph(token, `/items/${encodeURIComponent(itemId)}`, { method: "DELETE" }, true);
    return respond({ deleted: true });
  }

  if (action === "list") {
    const folderPath = txt(body.folder_path) || resolveFolderPath(body);
    const folder = await ensureFolder(token, folderPath);
    const children = await graph(
      token,
      `/items/${encodeURIComponent(folder.id)}/children?$select=id,name,webUrl,size,lastModifiedDateTime,file,folder&$top=200`
    );
    const items = (children?.value || []).map((item: Record<string, unknown>) => ({
      id: item.id,
      name: item.name,
      url: item.webUrl || null,
      size_bytes: item.size || 0,
      updated_at: item.lastModifiedDateTime || null,
      is_folder: Boolean(item.folder),
      mime_type: (item.file as { mimeType?: string } | undefined)?.mimeType || null
    }));
    return respond({
      folder_path: folderPath,
      folder_id: folder.id,
      folder_url: folder.webUrl || null,
      items
    });
  }

  if (action === "list_root") {
    const folderPath = ROOT;
    const folder = await ensureFolder(token, folderPath);
    const children = await graph(
      token,
      `/items/${encodeURIComponent(folder.id)}/children?$select=id,name,webUrl,size,lastModifiedDateTime,file,folder&$top=50`
    );
    const items = (children?.value || []).map((item: Record<string, unknown>) => ({
      id: item.id,
      name: item.name,
      url: item.webUrl || null,
      size_bytes: item.size || 0,
      updated_at: item.lastModifiedDateTime || null,
      is_folder: Boolean(item.folder),
      mime_type: (item.file as { mimeType?: string } | undefined)?.mimeType || null
    }));
    return respond({
      folder_path: folderPath,
      folder_id: folder.id,
      folder_url: folder.webUrl || null,
      items
    });
  }

  throw new HttpFailure("פעולה לא מוכרת.", 400);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    return await handle(req);
  } catch (e) {
    const err = e as Error & { status?: number };
    return respond(
      { error: "gefen_tender_sharepoint_error", message: err.message || "פעולת המסמך נכשלה." },
      e instanceof HttpFailure ? e.status : 500
    );
  }
});

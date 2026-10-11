import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const DRIVE = "b!7yHSW8aMokunngKw03vHhB5QSRQPWQ1JhXcgoDOvU2BFY5HnYLNMTZS2gZux2CMR";
const ROOT = "01EESB27DFN3CGOT5HL5FJ3BOTDQFMYJGY"; // "אישורי צילום חתומים" - exact verified folder
const MAX_BYTES = 6 * 1024 * 1024;
const GRAPH = "https://graph.microsoft.com/v1.0/drives/" + encodeURIComponent(DRIVE);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const txt = (v: unknown) => String(v ?? "").trim();
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

class HttpFailure extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

async function session(req: Request) {
  const authorization = txt(req.headers.get("authorization"));
  const url = txt(Deno.env.get("SUPABASE_URL"));
  const apikey = txt(Deno.env.get("SUPABASE_ANON_KEY"));
  if (!authorization.startsWith("Bearer ") || !url || !apikey) throw new HttpFailure("נדרשת התחברות למערכת.", 401);
  const headers = { Authorization: authorization, apikey, "Content-Type": "application/json" };
  const r = await fetch(url + "/rest/v1/rpc/get_current_app_user", {
    method: "POST", headers, body: "{}"
  });
  if (!r.ok) throw new HttpFailure("לא ניתן לאמת הרשאת מנהל.", 403);
  const payload = await r.json();
  const user = Array.isArray(payload) ? payload[0] : payload;
  if (user?.role !== "admin" || user?.is_active !== true) throw new HttpFailure("הפעולה מותרת למנהל מערכת בלבד.", 403);
  return { url, headers, user };
}

async function rest(ctx: Awaited<ReturnType<typeof session>>, path: string, options: RequestInit = {}) {
  const r = await fetch(ctx.url + "/rest/v1/" + path, {
    ...options,
    headers: { ...ctx.headers, Prefer: "return=representation", ...(options.headers || {}) }
  });
  if (!r.ok) throw new HttpFailure("שמירת הנתונים במערכת נכשלה (" + r.status + ").", 502);
  return await r.json();
}

async function validateActivity(ctx: Awaited<ReturnType<typeof session>>, id: number) {
  const rows = await rest(ctx, "activities?id=eq." + id + "&select=id,start_date,activity_season,status");
  const activity = rows[0];
  if (!activity || !activity.start_date) throw new HttpFailure("לפעילות לא הוגדר תאריך התחלה.", 400);
  if (["נמחק", "deleted"].includes(txt(activity.status).toLowerCase())) throw new HttpFailure("לא ניתן להעלות אישור לפעילות שנמחקה.", 400);
  return activity;
}

async function graphToken() {
  const tenant = txt(Deno.env.get("MS_TENANT_ID"));
  const client = txt(Deno.env.get("MS_CLIENT_ID"));
  const secret = txt(Deno.env.get("MS_CLIENT_SECRET"));
  if (!tenant || !client || !secret) throw new HttpFailure("חיבור SharePoint אינו מוגדר.", 503);
  const r = await fetch("https://login.microsoftonline.com/" + encodeURIComponent(tenant) + "/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client, client_secret: secret, grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default"
    })
  });
  if (!r.ok) throw new HttpFailure("התחברות ל־SharePoint נכשלה.", 502);
  return txt((await r.json()).access_token);
}

async function graph(token: string, path: string, opts: RequestInit = {}) {
  return fetch(GRAPH + path, {
    ...opts,
    headers: { Authorization: "Bearer " + token, ...(opts.headers || {}) }
  });
}

async function ensureFolder(token: string, activityId: number) {
  const folder = "activity-" + activityId;
  const path = "/items/" + encodeURIComponent(ROOT) + ":/" + encodeURIComponent(folder);
  let r = await graph(token, path);
  if (r.ok) {
    const item = await r.json();
    if (!item.folder) throw new HttpFailure("נתיב הפעילות תפוס על ידי קובץ.", 409);
    return item.id as string;
  }
  if (r.status !== 404) throw new HttpFailure("לא ניתן לקרוא את תיקיית האישורים ב־SharePoint (" + r.status + ").", 502);
  r = await graph(token, "/items/" + encodeURIComponent(ROOT) + "/children", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: folder, folder: {}, "@microsoft.graph.conflictBehavior": "fail" })
  });
  if (r.status === 409) {
    const retry = await graph(token, path);
    if (retry.ok) return txt((await retry.json()).id);
  }
  if (!r.ok) throw new HttpFailure("יצירת תיקיית פעילות ב־SharePoint נכשלה (" + r.status + ").", 502);
  return txt((await r.json()).id);
}

function readBytes(base64: unknown) {
  const value = txt(base64);
  if (!value || value.length > Math.ceil(MAX_BYTES / 3) * 4 + 20 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new HttpFailure("קובץ לא תקין או גדול מ־6MB.");
  }
  let binary: string;
  try { binary = atob(value); } catch { throw new HttpFailure("נתוני הקובץ אינם תקינים."); }
  if (!binary.length || binary.length > MAX_BYTES) throw new HttpFailure("קובץ ריק או גדול מ־6MB.");
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

function verifiedMime(bytes: Uint8Array) {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  throw new HttpFailure("מותר להעלות קובצי PDF, JPG או PNG בלבד.");
}

async function storedFile(ctx: Awaited<ReturnType<typeof session>>, fileId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw new HttpFailure("מזהה מסמך לא תקין.");
  const rows = await rest(ctx, "activity_photo_consent_files?id=eq." + encodeURIComponent(fileId) + "&select=*");
  if (!rows[0] || rows[0].sp_drive_id !== DRIVE) throw new HttpFailure("המסמך לא נמצא.", 404);
  return rows[0];
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function handle(req: Request) {
  const ctx = await session(req);
  if (req.method !== "POST") throw new HttpFailure("שיטת בקשה לא נתמכת.", 405);
  const body = await req.json().catch(() => ({}));
  const action = txt(body.action);
  const token = await graphToken();

  if (action === "upload") {
    const activityId = Number(body.activity_id);
    if (!Number.isSafeInteger(activityId) || activityId <= 0) throw new HttpFailure("מזהה פעילות לא תקין.");
    await validateActivity(ctx, activityId);
    const bytes = readBytes(body.base64);
    const mime = verifiedMime(bytes);
    const originalName = txt(body.file_name).replace(/[/\\\x00-\x1f]/g, "_").slice(0, 90) || "אישור צילום";
    const suffix = mime === "application/pdf" ? ".pdf" : mime === "image/png" ? ".png" : ".jpg";
    const fileName = crypto.randomUUID() + "-" + originalName.replace(/\.(pdf|jpe?g|png)$/i, "") + suffix;
    const folderId = await ensureFolder(token, activityId);
    const r = await graph(token, "/items/" + encodeURIComponent(folderId) + ":/" + encodeURIComponent(fileName) + ":/content", {
      method: "PUT", headers: { "Content-Type": mime }, body: bytes
    });
    if (!r.ok) throw new HttpFailure("העלאת המסמך ל־SharePoint נכשלה (" + r.status + ").", 502);
    const item = await r.json();
    if (!item.id) throw new HttpFailure("SharePoint לא החזיר מזהה למסמך.", 502);
    const entry = {
      activity_id: activityId, sp_drive_id: DRIVE, sp_item_id: item.id,
      sp_web_url: item.webUrl || null, file_name: originalName, mime_type: mime,
      size_bytes: bytes.length, uploaded_by: txt(ctx.user.full_name || ctx.user.name || ctx.user.user_id)
    };
    try {
      const saved = await rest(ctx, "activity_photo_consent_files", { method: "POST", body: JSON.stringify(entry) });
      return respond({ file: saved[0] });
    } catch (err) {
      await graph(token, "/items/" + encodeURIComponent(item.id), { method: "DELETE" }).catch(() => {});
      throw err;
    }
  }

  if (action === "download") {
    const file = await storedFile(ctx, txt(body.file_id));
    const r = await graph(token, "/items/" + encodeURIComponent(file.sp_item_id) + "/content");
    if (!r.ok) throw new HttpFailure("לא ניתן לטעון את המסמך מ־SharePoint (" + r.status + ").", 502);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new HttpFailure("המסמך גדול מדי לתצוגה.", 413);
    return respond({ file_name: file.file_name, mime_type: file.mime_type, base64: toBase64(bytes) });
  }

  if (action === "delete") {
    const file = await storedFile(ctx, txt(body.file_id));
    const r = await graph(token, "/items/" + encodeURIComponent(file.sp_item_id), { method: "DELETE" });
    if (!r.ok && r.status !== 404) throw new HttpFailure("מחיקת המסמך מ־SharePoint נכשלה (" + r.status + ").", 502);
    await rest(ctx, "activity_photo_consent_files?id=eq." + encodeURIComponent(file.id), { method: "DELETE" });
    return respond({ deleted: true });
  }

  throw new HttpFailure("פעולה לא מוכרת.", 400);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try { return await handle(req); }
  catch (e) {
    const error = e as Error;
    return respond({ error: "photo_consent_error", message: error.message || "פעולת המסמך נכשלה." },
      e instanceof HttpFailure ? e.status : 500);
  }
});

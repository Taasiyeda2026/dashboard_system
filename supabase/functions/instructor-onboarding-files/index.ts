import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@^2/cors";
import { directFileItems, onboardingFolder } from "./logic.js";

const HOST = "think365orgil.sharepoint.com";
const SITE_ID = "think365orgil.sharepoint.com,5bd221ef-8cc6-4ba2-a79e-02b0d37bc784,1449501e-590f-490d-8577-20a033af5360";
const DRIVE_ID = "b!7yHSW8aMokunngKw03vHhB5QSRQPWQ1JhXcgoDOvU2BFY5HnYLNMTZS2gZux2CMR";
const BASE_FOLDER = "תיקים אישיים/קליטת מדריך";
function clean(value: unknown) { return String(value ?? "").trim(); }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }); }
function encodePath(path: string) { return path.split("/").filter(Boolean).map(encodeURIComponent).join("/"); }
async function token() {
  const tenant = clean(Deno.env.get("MS_TENANT_ID")); const client = clean(Deno.env.get("MS_CLIENT_ID")); const secret = clean(Deno.env.get("MS_CLIENT_SECRET"));
  if (!tenant || !client || !secret) throw new Error("graph_not_configured");
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: client, client_secret: secret, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }) });
  if (!response.ok) throw new Error("graph_auth_failed"); return clean((await response.json()).access_token);
}
async function graph(accessToken: string, path: string) {
  const url = path.startsWith("https://") ? path : `https://graph.microsoft.com/v1.0${path}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`graph_request_failed:${response.status}`); return response;
}
async function assertAllowed(req: Request) {
  const auth = clean(req.headers.get("authorization")); const url = clean(Deno.env.get("SUPABASE_URL")); const key = clean(Deno.env.get("SUPABASE_ANON_KEY"));
  if (!auth || !url || !key) throw new Error("not_authorized");
  const response = await fetch(`${url}/rest/v1/rpc/get_current_app_user`, { method: "POST", headers: { apikey: key, Authorization: auth, "Content-Type": "application/json" }, body: "{}" });
  const currentUsers = response.ok ? await response.json() : []; const user = Array.isArray(currentUsers) ? currentUsers[0] : currentUsers;
  const roles = new Set(["admin", "operation_manager", "finance", "activities_manager", "domain_manager", "business_development_manager", "instructor_manager"]);
  const explicit = user?.permissions?.view_employee_files;
  if (!user?.is_active || (explicit != null ? ![true, "yes", "true", "1", 1].includes(explicit) : !roles.has(clean(user?.role)))) throw new Error("not_authorized");
}
async function listDirectFiles(accessToken: string, folderId: string) {
  let next = `/drives/${encodeURIComponent(DRIVE_ID)}/items/${encodeURIComponent(folderId)}/children?$select=id,name,file,folder&$top=200`;
  const items = [];
  while (next) {
    const payload = await (await graph(accessToken, next)).json();
    items.push(...directFileItems(payload?.value));
    next = clean(payload?.["@odata.nextLink"]);
  }
  return items;
}
function bytesToBase64(bytes: Uint8Array) { let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(binary); }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await assertAllowed(req); const body = await req.json(); const selectedFolder = onboardingFolder(body.employment_type); if (!selectedFolder) return json({ message: "יש לבחור סוג העסקה." }, 400);
    const accessToken = await token();
    const folderPath = `${BASE_FOLDER}/${selectedFolder}`; const folder = await (await graph(accessToken, `/drives/${encodeURIComponent(DRIVE_ID)}/root:/${encodePath(folderPath)}?$select=id,webUrl`)).json();
    if (body.folder_only) return json({ folder_url: folder.webUrl });
    const files = await listDirectFiles(accessToken, folder.id);
    console.info("[instructor-onboarding-files] SharePoint folder loaded", { selectedFolder, fileCount: files.length });
    if (!files.length) return json({ error: "empty_folder", message: "לא נמצאו מסמכים בתיקיית הקליטה שנבחרה." });
    const attachments = [];
    for (const item of files) {
      const response = await graph(accessToken, `/drives/${encodeURIComponent(DRIVE_ID)}/items/${encodeURIComponent(item.id)}/content`); const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 3 * 1024 * 1024) return json({ error: "attachment_too_large", message: `לא ניתן לצרף את הקובץ "${item.name}" משום שגודלו עולה על 3MB.` });
      attachments.push({ name: item.name, content_type: response.headers.get("content-type") || "application/pdf", content_bytes: bytesToBase64(bytes) });
    }
    return json({ source: "sharepoint", folder_url: folder.webUrl, attachment_count: attachments.length, attachments });
  } catch (error) {
    const forbidden = clean((error as Error)?.message) === "not_authorized"; return json({ message: forbidden ? "אין הרשאה להכין קליטת מדריך." : "לא ניתן לטעון את מסמכי הקליטה מ-SharePoint. יש לנסות שוב." }, forbidden ? 403 : 500);
  }
});

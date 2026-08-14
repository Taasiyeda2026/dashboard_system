import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const HOST = "think365orgil.sharepoint.com";
const SITE_PATH = "/sites/taasiyeda2027";
const BASE_FOLDER = "תיקים אישיים/קליטת מדריך";
const KITS: Record<string, { folder: string; files: Array<{ label: string; names: string[] }> }> = {
  taasiyeda: { folder: "תעשיידע", files: [
    { label: "הסכם העסקה.pdf", names: ["הסכם העסקה.pdf"] },
    { label: "קליטת מדריך 101.pdf", names: ["קליטת מדריך 101.pdf", "טופס 101.pdf", "101.pdf"] },
    { label: "נהלים למדריך.pdf", names: ["נהלים למדריך.pdf"] },
    { label: "אישור משטרה.pdf", names: ["אישור משטרה.pdf"] }
  ] },
  staffing: { folder: "כוח אדם", files: [
    { label: "נהלים למדריך.pdf", names: ["נהלים למדריך.pdf"] },
    { label: "שמירה על סודיות.pdf", names: ["שמירה על סודיות.pdf", "טופס שמירה על סודיות.pdf"] },
    { label: "אישור משטרה.pdf", names: ["אישור משטרה.pdf"] }
  ] }
};
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
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`graph_request_failed:${response.status}`); return response;
}
async function assertAllowed(req: Request) {
  const auth = clean(req.headers.get("authorization")); const url = clean(Deno.env.get("SUPABASE_URL")); const key = clean(Deno.env.get("SUPABASE_ANON_KEY"));
  if (!auth || !url || !key) throw new Error("not_authorized");
  const response = await fetch(`${url}/rest/v1/users?select=role,permissions,is_active`, { headers: { apikey: key, Authorization: auth } });
  const users = response.ok ? await response.json() : []; const user = users?.[0];
  const roles = new Set(["admin", "operation_manager", "finance", "activities_manager", "domain_manager", "business_development_manager", "instructor_manager"]);
  const explicit = user?.permissions?.view_employee_files;
  if (!user?.is_active || (explicit != null ? ![true, "yes", "true", "1", 1].includes(explicit) : !roles.has(clean(user?.role)))) throw new Error("not_authorized");
}
function bytesToBase64(bytes: Uint8Array) { let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(binary); }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await assertAllowed(req); const body = await req.json(); const kit = KITS[clean(body.employment_type)]; if (!kit) return json({ message: "יש לבחור סוג העסקה." }, 400);
    const accessToken = await token(); const site = await (await graph(accessToken, `/sites/${HOST}:${SITE_PATH}?$select=id`)).json();
    const drives = await (await graph(accessToken, `/sites/${encodeURIComponent(site.id)}/drives?$select=id,name,webUrl`)).json(); const drive = drives.value?.[0]; if (!drive?.id) throw new Error("drive_not_found");
    const folderPath = `${BASE_FOLDER}/${kit.folder}`; const folder = await (await graph(accessToken, `/drives/${encodeURIComponent(drive.id)}/root:/${encodePath(folderPath)}?$select=id,webUrl`)).json();
    if (body.folder_only) return json({ folder_url: folder.webUrl });
    const children = await (await graph(accessToken, `/drives/${encodeURIComponent(drive.id)}/items/${encodeURIComponent(folder.id)}/children?$select=id,name,file&$top=100`)).json();
    const byName = new Map((children.value || []).filter((item: any) => item.file).map((item: any) => [clean(item.name).toLocaleLowerCase("he"), item]));
    const attachments = [];
    for (const expected of kit.files) {
      const item = expected.names.map((name) => byName.get(name.toLocaleLowerCase("he"))).find(Boolean) as any;
      if (!item) return json({ error: "missing_file", message: `לא ניתן להכין את המייל. הקובץ "${expected.label}" לא נמצא בתיקיית הקליטה.` });
      const response = await graph(accessToken, `/drives/${encodeURIComponent(drive.id)}/items/${encodeURIComponent(item.id)}/content`); const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 3 * 1024 * 1024) return json({ error: "attachment_too_large", message: `לא ניתן לצרף את הקובץ "${item.name}" משום שגודלו עולה על 3MB.` });
      attachments.push({ name: item.name, content_type: response.headers.get("content-type") || "application/pdf", content_bytes: bytesToBase64(bytes) });
    }
    return json({ source: "sharepoint", folder_url: folder.webUrl, attachments });
  } catch (error) {
    const forbidden = clean((error as Error)?.message) === "not_authorized"; return json({ message: forbidden ? "אין הרשאה להכין קליטת מדריך." : "לא ניתן לטעון את מסמכי הקליטה מ-SharePoint. יש לנסות שוב." }, forbidden ? 403 : 500);
  }
});

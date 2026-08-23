import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const clean = (value: unknown) => String(value ?? "").trim();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });

async function assertAllowed(req: Request) {
  const auth = clean(req.headers.get("authorization"));
  const url = clean(Deno.env.get("SUPABASE_URL"));
  const key = clean(Deno.env.get("SUPABASE_ANON_KEY"));
  if (!auth || !url || !key) throw new Error("not_authorized");
  const response = await fetch(`${url}/rest/v1/rpc/get_current_app_user`, { method: "POST", headers: { apikey: key, Authorization: auth, "Content-Type": "application/json" }, body: "{}" });
  const payload = response.ok ? await response.json() : [];
  const user = Array.isArray(payload) ? payload[0] : payload;
  const allowed = [true, "yes", "true", "1", 1].includes(user?.permissions?.send_activity_coordination_approvals)
    && [true, "yes", "true", "1", 1].includes(user?.permissions?.view_activities);
  if (!user?.is_active || (clean(user?.role) !== "admin" && !allowed)) throw new Error("not_authorized");
}

async function graphToken() {
  const tenant = clean(Deno.env.get("MS_TENANT_ID"));
  const client = clean(Deno.env.get("MS_CLIENT_ID"));
  const secret = clean(Deno.env.get("MS_CLIENT_SECRET"));
  if (!tenant || !client || !secret) throw new Error("graph_not_configured");
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client, client_secret: secret, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" })
  });
  if (!response.ok) throw new Error("graph_auth_failed");
  return clean((await response.json()).access_token);
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    await assertAllowed(req);
    const driveId = clean(Deno.env.get("ACTIVITY_COORDINATION_PHOTO_DRIVE_ID"));
    const itemId = clean(Deno.env.get("ACTIVITY_COORDINATION_PHOTO_ITEM_ID"));
    const displayName = clean(Deno.env.get("ACTIVITY_COORDINATION_PHOTO_FILENAME")) || "אישור צילום.pdf";
    if (!driveId || !itemId) return json({ error: "photo_approval_not_configured", message: "מיקום אישור הצילום טרם הוגדר." }, 503);
    const token = await graphToken();
    const response = await fetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`graph_file_failed:${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 3 * 1024 * 1024) return json({ error: "attachment_too_large", message: "אישור הצילום גדול מ-3MB ולא ניתן לצרפו כקובץ רגיל." }, 413);
    return json({ name: displayName, content_type: response.headers.get("content-type") || "application/pdf", content_bytes: toBase64(bytes) });
  } catch (error) {
    const forbidden = clean((error as Error)?.message) === "not_authorized";
    return json({ message: forbidden ? "אין הרשאה להכין אישור תיאום." : "לא ניתן לטעון את אישור הצילום מ-SharePoint." }, forbidden ? 403 : 500);
  }
});

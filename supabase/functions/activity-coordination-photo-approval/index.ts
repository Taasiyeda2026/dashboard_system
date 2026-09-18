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
    const configuredDriveId = clean(Deno.env.get("ACTIVITY_COORDINATION_PHOTO_DRIVE_ID"));
    const configuredItemId = clean(Deno.env.get("ACTIVITY_COORDINATION_PHOTO_ITEM_ID"));
    const photoPath = clean(Deno.env.get("ACTIVITY_COORDINATION_PHOTO_PATH")) || "ניהול/אישור צילום/אישור צילום.pdf";
    const displayName = clean(Deno.env.get("ACTIVITY_COORDINATION_PHOTO_FILENAME")) || "אישור צילום.pdf";
    const token = await graphToken();
    const headers = { Authorization: `Bearer ${token}` };

    const encodedPath = photoPath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    const candidateUrls: string[] = [];
    if (configuredDriveId && configuredItemId) {
      candidateUrls.push(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(configuredDriveId)}/items/${encodeURIComponent(configuredItemId)}/content`);
    }
    if (configuredDriveId) {
      candidateUrls.push(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(configuredDriveId)}/root:/${encodedPath}:/content`);
    }
    let response: Response | null = null;
    let lastStatus = 0;
    for (const url of candidateUrls) {
      const attempt = await fetch(url, { headers });
      if (attempt.ok) {
        response = attempt;
        break;
      }
      lastStatus = attempt.status;
    }

    // Final self-healing fallback: resolve the current site/default document
    // library and fetch the fixed file path. This survives stale drive/item IDs.
    if (!response) {
      const host = clean(Deno.env.get("ACTIVITY_COORDINATION_SHAREPOINT_HOST")) || "think365orgil.sharepoint.com";
      const sitePath = clean(Deno.env.get("ACTIVITY_COORDINATION_SHAREPOINT_SITE_PATH")) || "/sites/taasiyeda2027";
      const siteUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(host)}:${sitePath}`;
      const siteAttempt = await fetch(siteUrl, { headers });
      if (siteAttempt.ok) {
        const site = await siteAttempt.json();
        const siteId = clean(site?.id);
        if (siteId) {
          const pathAttempt = await fetch(
            `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/drive/root:/${encodedPath}:/content`,
            { headers }
          );
          if (pathAttempt.ok) response = pathAttempt;
          else lastStatus = pathAttempt.status;
        }
      } else {
        lastStatus = siteAttempt.status;
      }
    }

    if (!response) throw new Error(`graph_file_failed:${lastStatus || 500}`);

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 3 * 1024 * 1024) return json({ error: "attachment_too_large", message: "אישור הצילום גדול מ-3MB ולא ניתן לצרפו כקובץ רגיל." }, 413);
    return json({
      name: displayName,
      content_type: response.headers.get("content-type") || "application/pdf",
      content_bytes: toBase64(bytes),
      source: configuredDriveId ? "sharepoint_path_fallback" : "sharepoint"
    });
  } catch (error) {
    const reason = clean((error as Error)?.message);
    const forbidden = reason === "not_authorized";
    const graphStatus = /^graph_file_failed:(\d+)$/.exec(reason)?.[1] || "";
    return json({
      error: forbidden ? "not_authorized" : (reason || "photo_approval_failed"),
      message: forbidden
        ? "אין הרשאה להכין אישור תיאום."
        : (graphStatus
          ? `לא ניתן לטעון את אישור הצילום מ-SharePoint (Graph ${graphStatus}).`
          : "לא ניתן לטעון את אישור הצילום מ-SharePoint.")
    }, forbidden ? 403 : 500);
  }
});

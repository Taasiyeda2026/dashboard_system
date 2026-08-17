import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@^2/cors";

const DRIVE_ID = "b!7yHSW8aMokunngKw03vHhB5QSRQPWQ1JhXcgoDOvU2BFY5HnYLNMTZS2gZux2CMR";
const EMPLOYEE_FILES_ROOT = "תיקים אישיים";
const SCHOOL_YEAR = "2027";
const FOLDER_PATHS = [
  "01 הסכם ומסמכים",
  "01 הסכם ומסמכים/הסכם חתום",
  "01 הסכם ומסמכים/מסמכים נלווים",
  "02 משובים",
  "02 משובים/משוב היכרות",
  "02 משובים/משוב אמצע שנה",
  "02 משובים/משוב סוף שנה",
  "03 תצפיות",
  "03 תצפיות/תצפית 1",
  "03 תצפיות/תצפית 2",
  "04 דוחות שכר",
];

function clean(value: unknown) { return String(value ?? "").trim(); }
function encodePath(path: string) { return path.split("/").filter(Boolean).map(encodeURIComponent).join("/"); }
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
}

async function graphToken() {
  const tenant = clean(Deno.env.get("MS_TENANT_ID"));
  const client = clean(Deno.env.get("MS_CLIENT_ID"));
  const secret = clean(Deno.env.get("MS_CLIENT_SECRET"));
  if (!tenant || !client || !secret) throw new Error("graph_not_configured");
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client, client_secret: secret, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" }),
  });
  if (!response.ok) throw new Error(`graph_auth_failed:${response.status}`);
  return clean((await response.json())?.access_token);
}

async function graph(accessToken: string, path: string, init: RequestInit = {}, allow404 = false) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw new Error(`graph_request_failed:${response.status}:${(await response.text()).slice(0, 160)}`);
  return await response.json();
}

async function rpc(req: Request, name: string, body: Record<string, unknown>) {
  const url = clean(Deno.env.get("SUPABASE_URL"));
  const key = clean(Deno.env.get("SUPABASE_ANON_KEY"));
  const authorization = clean(req.headers.get("authorization"));
  if (!url || !key || !authorization) throw new Error("not_authorized");
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${name}_failed:${response.status}:${(await response.text()).slice(0, 160)}`);
  return await response.json();
}

async function getFolder(accessToken: string, path: string) {
  return await graph(accessToken, `/drives/${encodeURIComponent(DRIVE_ID)}/root:/${encodePath(path)}?$select=id,name,webUrl,folder`, {}, true);
}

async function ensureFolder(accessToken: string, parentPath: string, name: string) {
  const fullPath = `${parentPath}/${name}`;
  const existing = await getFolder(accessToken, fullPath);
  if (existing?.folder) return existing;
  const parent = await getFolder(accessToken, parentPath);
  if (!parent?.id || !parent?.folder) throw new Error("sharepoint_parent_folder_missing");
  try {
    return await graph(accessToken, `/drives/${encodeURIComponent(DRIVE_ID)}/items/${encodeURIComponent(parent.id)}/children`, {
      method: "POST",
      body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
  } catch (error) {
    // A concurrent retry may have won the create race. Resolve it by path instead of creating a renamed duplicate.
    const raced = await getFolder(accessToken, fullPath);
    if (raced?.folder) return raced;
    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ message: "method_not_allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const empId = Number(body?.emp_id);
    const fullName = clean(body?.full_name);
    const schoolYear = clean(body?.school_year) || SCHOOL_YEAR;
    if (!Number.isSafeInteger(empId) || empId <= 0 || !fullName || schoolYear !== SCHOOL_YEAR || /[\/#]/.test(fullName)) {
      return json({ message: "onboarding_employee_folder_fields_invalid" }, 400);
    }

    const snapshot = await rpc(req, "get_instructor_employee_file_snapshot", { p_emp_id: empId, p_school_year: schoolYear });
    if (snapshot?.mapped && clean(snapshot?.folder_web_url)) {
      return json({ folder_web_url: clean(snapshot.folder_web_url), existing: true });
    }

    const accessToken = await graphToken();
    const employeePath = `${EMPLOYEE_FILES_ROOT}/${fullName}`;
    const employeeFolder = await ensureFolder(accessToken, EMPLOYEE_FILES_ROOT, fullName);
    for (const relativePath of FOLDER_PATHS) {
      const parts = relativePath.split("/");
      await ensureFolder(accessToken, `${employeePath}/${parts.slice(0, -1).join("/")}`.replace(/\/$/, ""), parts.at(-1)!);
    }
    const folderWebUrl = clean(employeeFolder?.webUrl);
    if (!/^https:\/\/think365orgil[.]sharepoint[.]com\//.test(folderWebUrl)) throw new Error("sharepoint_folder_url_invalid");

    // Persist only after the complete hierarchy exists; a partial Graph failure leaves no false mapping.
    const saved = await rpc(req, "update_instructor_employee_folder_url", {
      p_emp_id: empId,
      p_school_year: schoolYear,
      p_folder_web_url: folderWebUrl,
    });
    if (clean(saved?.folder_web_url) !== folderWebUrl) throw new Error("employee_folder_mapping_not_saved");
    return json({ folder_web_url: folderWebUrl, existing: false });
  } catch (error) {
    console.error("[instructor-onboarding-folder]", error);
    return json({ message: "לא ניתן ליצור את התיק האישי ב-SharePoint." }, 500);
  }
});

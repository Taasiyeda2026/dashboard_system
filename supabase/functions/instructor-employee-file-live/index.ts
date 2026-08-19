import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SHAREPOINT_HOST = "think365orgil.sharepoint.com";
const SHAREPOINT_SITE_PATH = "/sites/taasiyeda2027";

const COMPONENT_PATHS: Array<[string, string]> = [
  ["signed_agreement", "01 הסכם ומסמכים/הסכם חתום"],
  ["supporting_documents", "01 הסכם ומסמכים/מסמכים נלווים"],
  ["police_clearance", "01 הסכם ומסמכים/אישור משטרה"],
  ["intro_feedback", "02 משובים/משוב היכרות"],
  ["midyear_feedback", "02 משובים/משוב אמצע שנה"],
  ["year_end_feedback", "02 משובים/משוב סוף שנה"],
  ["observation_1", "03 תצפיות/תצפית 1"],
  ["observation_2", "03 תצפיות/תצפית 2"],
  ["payroll_reports", "04 דוחות שכר"],
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeDecodedPath(path: string) {
  try {
    return decodeURIComponent(path).replace(/\/+$/, "");
  } catch {
    return path.replace(/\/+$/, "");
  }
}

function encodeGraphPath(path: string) {
  return path.split("/").filter(Boolean).map((segment) => encodeURIComponent(segment)).join("/");
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

async function loadSnapshot(req: Request, empId: number, schoolYear: string) {
  const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
  const anonKey = clean(Deno.env.get("SUPABASE_ANON_KEY"));
  const authorization = clean(req.headers.get("authorization"));
  if (!supabaseUrl || !anonKey || !authorization) throw new Error("employee_file_auth_unavailable");

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_instructor_employee_file_snapshot`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_emp_id: empId, p_school_year: schoolYear }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`employee_file_snapshot_failed:${response.status}:${detail.slice(0, 200)}`);
  }
  return await response.json();
}

async function persistComponents(empId: number, schoolYear: string, components: Array<Record<string, unknown>>) {
  const supabaseUrl = clean(Deno.env.get("SUPABASE_URL"));
  const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !serviceKey) throw new Error("employee_file_snapshot_writer_unavailable");

  const mappingResponse = await fetch(
    `${supabaseUrl}/rest/v1/instructor_employee_folders?select=id&emp_id=eq.${empId}&school_year=eq.${encodeURIComponent(schoolYear)}&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  if (!mappingResponse.ok) throw new Error(`employee_file_mapping_lookup_failed:${mappingResponse.status}`);
  const mappingId = clean((await mappingResponse.json())?.[0]?.id);
  if (!mappingId) throw new Error("employee_file_mapping_not_found");

  const rows = components.map((component) => ({
    folder_mapping_id: mappingId,
    component_key: clean(component.component_key),
    completed: component.completed === true,
    item_count: Math.max(0, Number(component.item_count) || 0),
    updated_at: new Date().toISOString(),
    updated_by: null,
  }));
  const saveResponse = await fetch(
    `${supabaseUrl}/rest/v1/instructor_employee_document_status?on_conflict=folder_mapping_id,component_key`,
    {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
  );
  if (!saveResponse.ok) {
    const detail = await saveResponse.text();
    throw new Error(`employee_file_snapshot_save_failed:${saveResponse.status}:${detail.slice(0, 200)}`);
  }
}

async function graphToken() {
  const tenantId = clean(Deno.env.get("MS_TENANT_ID"));
  const clientId = clean(Deno.env.get("MS_CLIENT_ID"));
  const clientSecret = clean(Deno.env.get("MS_CLIENT_SECRET"));
  if (!tenantId || !clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`graph_token_failed:${response.status}:${detail.slice(0, 200)}`);
  }
  const payload = await response.json();
  return clean(payload?.access_token) || null;
}

async function graphGet(token: string, urlOrPath: string, allow404 = false) {
  const url = urlOrPath.startsWith("https://") ? urlOrPath : `https://graph.microsoft.com/v1.0${urlOrPath}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`graph_request_failed:${response.status}:${detail.slice(0, 240)}`);
  }
  return await response.json();
}

async function listFolderFiles(token: string, driveId: string, relativePath: string) {
  const encoded = encodeGraphPath(relativePath);
  let next: string | null = `/drives/${encodeURIComponent(driveId)}/root:/${encoded}:/children?$select=id,name,file,folder&$top=200`;
  let count = 0;
  while (next) {
    const payload = await graphGet(token, next, true);
    if (!payload) return 0;
    for (const item of Array.isArray(payload.value) ? payload.value : []) {
      if (item?.file) count += 1;
    }
    next = clean(payload?.["@odata.nextLink"]) || null;
  }
  return count;
}

async function listFolderFilesFromItem(token: string, driveId: string, rootItemId: string, relativePath: string) {
  const encoded = encodeGraphPath(relativePath);
  let next: string | null = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(rootItemId)}:/${encoded}:/children?$select=id,name,file,folder&$top=200`;
  let count = 0;
  while (next) {
    const payload = await graphGet(token, next, true);
    if (!payload) return 0;
    for (const item of Array.isArray(payload.value) ? payload.value : []) {
      if (item?.file) count += 1;
    }
    next = clean(payload?.["@odata.nextLink"]) || null;
  }
  return count;
}

async function sharedFolderRoot(token: string, folderWebUrl: string) {
  if (!looksLikeSharingLink(folderWebUrl)) return null;
  const shareId = graphShareId(folderWebUrl);
  const payload = await graphGet(
    token,
    `/shares/${encodeURIComponent(shareId)}/driveItem?$select=id,name,webUrl,parentReference,folder,remoteItem`,
    true,
  );
  if (!payload) return null;
  const item = payload?.remoteItem || payload;
  const driveId = clean(item?.parentReference?.driveId || payload?.parentReference?.driveId);
  const itemId = clean(item?.id || payload?.id);
  if (!driveId || !itemId) return null;
  return { driveId, itemId };
}

async function liveComponents(token: string, folderWebUrl: string) {
  const sharedRoot = await sharedFolderRoot(token, folderWebUrl).catch((error) => {
    console.warn("[instructor-employee-file-live] shared-link resolution failed; trying canonical path", error);
    return null;
  });
  if (sharedRoot) {
    return await Promise.all(COMPONENT_PATHS.map(async ([componentKey, suffix]) => {
      const itemCount = await listFolderFilesFromItem(token, sharedRoot.driveId, sharedRoot.itemId, suffix);
      return {
        component_key: componentKey,
        completed: itemCount > 0,
        item_count: componentKey === "payroll_reports" ? itemCount : 0,
      };
    }));
  }

  const site = await graphGet(
    token,
    `/sites/${SHAREPOINT_HOST}:${SHAREPOINT_SITE_PATH}?$select=id,webUrl`,
  );
  const siteId = clean(site?.id);
  if (!siteId) throw new Error("sharepoint_site_not_found");

  const drives = await graphGet(token, `/sites/${encodeURIComponent(siteId)}/drives?$select=id,name,webUrl,driveType`);
  const driveRows = Array.isArray(drives?.value) ? drives.value : [];
  const folderUrl = new URL(folderWebUrl);
  const targetPath = normalizeDecodedPath(folderUrl.pathname);

  let drive = driveRows.find((row: any) => {
    if (!row?.webUrl) return false;
    try {
      const drivePath = normalizeDecodedPath(new URL(row.webUrl).pathname);
      return targetPath === drivePath || targetPath.startsWith(`${drivePath}/`);
    } catch {
      return false;
    }
  });
  drive ||= driveRows.find((row: any) => clean(row?.driveType) === "documentLibrary");
  if (!drive?.id || !drive?.webUrl) throw new Error("sharepoint_document_library_not_found");

  const drivePath = normalizeDecodedPath(new URL(drive.webUrl).pathname);
  if (!(targetPath === drivePath || targetPath.startsWith(`${drivePath}/`))) {
    throw new Error("employee_folder_not_in_document_library");
  }
  const employeeRoot = targetPath.slice(drivePath.length).replace(/^\/+/, "");
  if (!employeeRoot) throw new Error("employee_folder_path_missing");

  return await Promise.all(COMPONENT_PATHS.map(async ([componentKey, suffix]) => {
    const itemCount = await listFolderFiles(token, clean(drive.id), `${employeeRoot}/${suffix}`);
    return {
      component_key: componentKey,
      completed: itemCount > 0,
      item_count: componentKey === "payroll_reports" ? itemCount : 0,
    };
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const empId = Number(body?.empId ?? body?.emp_id);
    const schoolYear = clean(body?.schoolYear ?? body?.school_year) || "2027";
    const refresh = body?.refresh === true;
    if (!Number.isInteger(empId) || empId <= 0) return json({ error: "employee_file_emp_id_required" }, 400);

    const snapshot = await loadSnapshot(req, empId, schoolYear);
    if (!refresh) {
      return json({ ...snapshot, live: false, source: "stored", reason: "snapshot_only" });
    }
    if (!snapshot?.mapped || !clean(snapshot?.folder_web_url)) {
      return json({ ...snapshot, live: false, source: "sharepoint", reason: "folder_not_mapped" });
    }

    const token = await graphToken();
    if (!token) {
      return json({ ...snapshot, live: false, source: "stored", reason: "graph_not_configured" });
    }

    const components = await liveComponents(token, clean(snapshot.folder_web_url));
    await persistComponents(empId, schoolYear, components);
    return json({
      ...snapshot,
      emp_id: empId,
      components,
      live: true,
      source: "sharepoint",
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[instructor-employee-file-live]", error);
    return json({ error: clean((error as Error)?.message) || "employee_file_live_failed" }, 500);
  }
});

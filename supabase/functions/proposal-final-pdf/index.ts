import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const BUCKET = "proposal-final-pdfs";
const TIMEOUT_MS = 45_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function safeId(value: unknown) {
  return String(value ?? "").trim().replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80);
}

function printableDocument(fragment: string, cssUrl: string, baseUrl: string) {
  const css = cssUrl ? `<link rel="stylesheet" href="${cssUrl.replaceAll('"', '&quot;')}">` : "";
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><base href="${baseUrl}">${css}<style>@page{size:A4;margin:10mm}html,body{direction:rtl}body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body class="is-print-preview"><main class="proposal-preview-area">${fragment}</main></body></html>`;
}

async function generate(proposalId: string, htmlSnapshot: string, documentSnapshot: Record<string, unknown>) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const browserlessUrl = Deno.env.get("BROWSERLESS_URL")!;
  const browserlessToken = Deno.env.get("BROWSERLESS_TOKEN")!;
  const publicBase = Deno.env.get("DASHBOARD_PUBLIC_BASE_URL") || "https://taasiyeda.github.io/dashboard_system/";
    let cssUrl = Deno.env.get("DASHBOARD_PROPOSAL_PRINT_CSS_URL") || "";
    if (!cssUrl) {
      const indexHtml = await fetch(publicBase).then((response) => response.ok ? response.text() : "");
      const stylesheet = indexHtml.match(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/i)?.[1]
        || indexHtml.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']stylesheet["']/i)?.[1];
      if (!stylesheet) throw new Error("proposal_print_css_not_found");
      cssUrl = new URL(stylesheet, publicBase).href;
    }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const log = (stage: string, extra: Record<string, unknown> = {}) => console.info("[proposal-final-pdf]", { proposalId, stage, ...extra });
  try {
    const { data: claimed, error: claimError } = await admin.from("proposals_agreements")
      .update({ final_pdf_generation_status: "generating", final_pdf_generation_error: null })
      .eq("id", proposalId).eq("status", "approved").in("final_pdf_generation_status", ["idle", "queued", "failed"])
      .is("final_pdf_path", null).select("id,quote_number").maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) { log("duplicate-skipped"); return; }

    log("chromium-request");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("proposal_pdf_timeout"), TIMEOUT_MS);
    const endpoint = `${browserlessUrl.replace(/\/$/, "")}/pdf?token=${encodeURIComponent(browserlessToken)}`;
    const response = await fetch(endpoint, {
      method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        html: printableDocument(htmlSnapshot, cssUrl, publicBase),
        waitForTimeout: 1500,
        options: { format: "A4", printBackground: true, preferCSSPageSize: true, timeout: TIMEOUT_MS }
      })
    }).finally(() => clearTimeout(timer));
    if (!response.ok) throw new Error(`chromium_pdf_http_${response.status}`);
    const pdf = new Uint8Array(await response.arrayBuffer());
    if (pdf.length < 5 || new TextDecoder().decode(pdf.slice(0, 5)) !== "%PDF-") throw new Error("chromium_pdf_invalid");

    const filename = `proposal-${safeId(proposalId)}-${Date.now()}.pdf`;
    const path = `${safeId(proposalId)}/${filename}`;
    log("storage-upload", { bytes: pdf.length, path });
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, pdf, { contentType: "application/pdf", upsert: false });
    if (uploadError) throw uploadError;
    const now = new Date().toISOString();
    const { error: updateError } = await admin.from("proposals_agreements").update({
      final_pdf_path: path, final_pdf_file_name: filename, final_pdf_created_at: now,
      final_pdf_created_by: "proposal-final-pdf", final_pdf_generation_status: "completed",
      final_pdf_generation_error: null, document_snapshot: documentSnapshot,
      document_html_snapshot: htmlSnapshot, updated_at: now
    }).eq("id", proposalId).eq("final_pdf_generation_status", "generating");
    if (updateError) throw updateError;
    log("completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[proposal-final-pdf]", { proposalId, stage: "failed", message });
    await admin.from("proposals_agreements").update({
      final_pdf_generation_status: "failed", final_pdf_generation_error: message.slice(0, 1000), updated_at: new Date().toISOString()
    }).eq("id", proposalId).is("final_pdf_path", null);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const auth = req.headers.get("Authorization") || "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } }, auth: { persistSession: false }
    });
    const body = await req.json();
    const proposalId = safeId(body?.proposalId);
    const htmlSnapshot = String(body?.documentHtmlSnapshot || "").trim();
    const documentSnapshot = body?.documentSnapshot;
    if (!proposalId || !htmlSnapshot || !documentSnapshot || typeof documentSnapshot !== "object") return json({ error: "invalid_payload" }, 400);
    const { data: proposal, error } = await userClient.from("proposals_agreements").select("id,status,final_pdf_path,final_pdf_generation_status,final_pdf_generation_attempts").eq("id", proposalId).single();
    if (error || !proposal) return json({ error: "proposal_not_found" }, 404);
    if (proposal.status !== "approved") return json({ error: "proposal_not_approved" }, 409);
    if (proposal.final_pdf_path || ["queued", "generating", "completed"].includes(proposal.final_pdf_generation_status)) {
      return json({ ok: true, queued: false, duplicate: true }, 202);
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    await admin.from("proposals_agreements").update({
      final_pdf_generation_status: "queued", final_pdf_generation_error: null,
      final_pdf_generation_attempts: Number(proposal.final_pdf_generation_attempts || 0) + 1,
      document_snapshot: documentSnapshot, document_html_snapshot: htmlSnapshot
    }).eq("id", proposalId).in("final_pdf_generation_status", ["idle", "failed"]);
    EdgeRuntime.waitUntil(generate(proposalId, htmlSnapshot, documentSnapshot));
    return json({ ok: true, queued: true }, 202);
  } catch (error) {
    console.error("[proposal-final-pdf]", { stage: "enqueue-failed", message: error instanceof Error ? error.message : String(error) });
    return json({ error: "proposal_pdf_enqueue_failed" }, 500);
  }
});

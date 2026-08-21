import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, PDFFont, PDFPage, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import bidiFactory from "npm:bidi-js@1.0.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type"
};
const clean = (value: unknown) => String(value ?? "").trim();
const bidi = bidiFactory();

function rtl(value: unknown) {
  const source = clean(value);
  const chars = source.split("");
  for (const [left, right] of bidi.getReorderSegments(source, bidi.getEmbeddingLevels(source, "rtl"))) {
    let i = left;
    let j = right;
    while (i < j) {
      [chars[i], chars[j]] = [chars[j], chars[i]];
      i += 1;
      j -= 1;
    }
  }
  return chars.join("");
}

const money = (value: unknown) => `${Number(value || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;
const date = (value: unknown) => {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : clean(value);
};
const base64 = (bytes: Uint8Array) => {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
};

async function graphToken() {
  const tenant = clean(Deno.env.get("MS_TENANT_ID"));
  const client = clean(Deno.env.get("MS_CLIENT_ID"));
  const secret = clean(Deno.env.get("MS_CLIENT_SECRET"));
  if (!tenant || !client || !secret) throw new Error("graph_not_configured");
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client,
      client_secret: secret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default"
    })
  });
  if (!response.ok) throw new Error("graph_auth_failed");
  return clean((await response.json()).access_token);
}

async function graph(token: string, path: string, options: RequestInit = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`graph_request_failed:${response.status}:${(await response.text()).slice(0, 160)}`);
  return response.status === 204 ? null : response.json();
}

function drawRight(page: PDFPage, font: PDFFont, value: string, y: number, size = 9, rightX = 565) {
  const rendered = rtl(value);
  page.drawText(rendered, { x: rightX - font.widthOfTextAtSize(rendered, size), y, size, font, color: rgb(0.08, 0.12, 0.18) });
}

function drawCell(page: PDFPage, font: PDFFont, value: string, x: number, y: number, width: number, size = 8.5) {
  const rendered = rtl(value);
  page.drawText(rendered, {
    x: x + width - font.widthOfTextAtSize(rendered, size) - 5,
    y: y + 7,
    size,
    font,
    color: rgb(0.08, 0.12, 0.18),
    maxWidth: Math.max(10, width - 10)
  });
}

function drawTableRow(page: PDFPage, font: PDFFont, values: string[], widths: number[], y: number, height = 24, fill = false) {
  let x = 30;
  values.forEach((value, index) => {
    const width = widths[index];
    page.drawRectangle({
      x, y, width, height,
      borderWidth: 0.6,
      borderColor: rgb(0.72, 0.76, 0.8),
      ...(fill ? { color: rgb(0.95, 0.97, 0.98) } : {})
    });
    drawCell(page, font, value, x, y, width, fill ? 8.2 : 8.5);
    x += width;
  });
}

async function buildPdf(account: any) {
  const [regularBytes, boldBytes, logoBytes] = await Promise.all([
    fetch("https://raw.githubusercontent.com/Taasiyeda2026/dashboard_system/main/frontend/assets/fonts/Arimo-Regular.ttf").then((r) => r.arrayBuffer()),
    fetch("https://raw.githubusercontent.com/Taasiyeda2026/dashboard_system/main/frontend/assets/fonts/Arimo-Bold.ttf").then((r) => r.arrayBuffer()),
    fetch("https://raw.githubusercontent.com/Taasiyeda2026/dashboard_system/main/frontend/assets/logo1.png").then((r) => r.arrayBuffer())
  ]);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  const logo = await doc.embedPng(logoBytes);
  let page = doc.addPage([595, 842]);
  let y = 805;

  page.drawImage(logo, { x: 32, y: 754, width: 112, height: 48 });
  drawRight(page, bold, 'תעשיידע – תעשייה למען חינוך מתקדם ע"ר', y, 9); y -= 14;
  drawRight(page, regular, "דניאל פריש 3, תל אביב", y); y -= 13;
  drawRight(page, regular, "טלפון: 03-5370368", y); y -= 13;
  drawRight(page, regular, "עמותה מס': 580210094", y); y -= 13;
  drawRight(page, regular, "אימייל: toni@think.org.il", y); y -= 25;
  drawRight(page, regular, `תאריך: ${date(account.issue_date)}`, y, 10); y -= 28;
  drawRight(page, bold, `חשבון עסקה | ${account.transaction_account_number} | מקור`, y, 17);
  page.drawLine({ start: { x: 30, y: y - 7 }, end: { x: 565, y: y - 7 }, thickness: 1, color: rgb(0.1, 0.35, 0.55) });
  y -= 34;
  drawRight(page, bold, `לכבוד: ${account.customer_name_snapshot}`, y, 11); y -= 16;
  drawRight(page, regular, `מספר לקוח: ${account.institution_symbol}`, y, 10); y -= 26;
  drawRight(page, bold, 'תוכניות חינוכיות – שנת תשפ"ז', y, 13); y -= 32;

  const widths = [205, 78, 78, 84, 90];
  drawTableRow(page, bold, ['תוכנית / פעילות', 'מס׳ גפ״ן', 'שעות לחיוב', 'מחיר לשעה', 'סכום'], widths, y, 25, true);
  y -= 25;

  for (const line of account.finance_transaction_account_lines || []) {
    const detailRows = line.finance_transaction_account_meetings || [];
    const needed = 25 + 22 + 20 + (detailRows.length * 18) + 14;
    if (y - needed < 55) {
      page = doc.addPage([595, 842]);
      y = 800;
      drawTableRow(page, bold, ['תוכנית / פעילות', 'מס׳ גפ״ן', 'שעות לחיוב', 'מחיר לשעה', 'סכום'], widths, y, 25, true);
      y -= 25;
    }
    drawTableRow(page, regular, [
      clean(line.activity_name_snapshot),
      clean(line.gefen_number_snapshot) || '—',
      clean(line.billed_hours),
      money(line.hourly_rate_snapshot),
      money(line.amount)
    ], widths, y, 25, false);
    y -= 34;
    drawRight(page, bold, 'פירוט ביצוע לחיוב', y, 9); y -= 20;
    const detailWidths = [390, 145];
    drawTableRow(page, bold, ['תאריך', 'שעות'], detailWidths, y, 20, true);
    y -= 20;
    for (const meeting of detailRows) {
      drawTableRow(page, regular, [date(meeting.meeting_date), '1.5'], detailWidths, y, 18, false);
      y -= 18;
    }
    y -= 12;
  }

  if (y < 70) { page = doc.addPage([595, 842]); y = 800; }
  drawRight(page, bold, `סה"כ לתשלום: ${money(account.total_amount)}`, y, 13);
  return new Uint8Array(await doc.save());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("authorization") || "";
    const url = clean(Deno.env.get("SUPABASE_URL"));
    const anon = clean(Deno.env.get("SUPABASE_ANON_KEY"));
    const service = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: allowed, error: allowError } = await userClient.rpc("app_can_access_finance");
    if (allowError || !allowed) throw new Error("not_authorized");

    const body = await req.json();
    const accountId = clean(body.accountId);
    const driveId = clean(body.driveId);
    const folderId = clean(body.folderItemId);
    if (!accountId || !driveId || !folderId) throw new Error("account_and_sharepoint_folder_required");

    const admin = createClient(url, service);
    const { data: account, error } = await admin
      .from("finance_transaction_accounts")
      .select("*,finance_transaction_account_lines(*,finance_transaction_account_meetings(*))")
      .eq("id", accountId)
      .single();
    if (error) throw error;
    if (!["generating", "issued", "mail_draft_ready"].includes(account.document_status)) throw new Error("account_not_dispatchable");

    // An already-created draft is idempotent: do not create a second Outlook message.
    if (account.outlook_status === "draft_ready" && account.outlook_message_id) {
      return new Response(JSON.stringify({ accountId, filename: account.generated_filename, outlookStatus: "draft_ready", messageId: account.outlook_message_id }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    let bytes: Uint8Array;
    let filename = account.generated_filename;
    if (account.document_status === "generating") {
      bytes = await buildPdf(account);
      filename = `חשבון עסקה ${account.transaction_account_number} - ${clean(account.customer_name_snapshot).replace(/[\\/:*?\"<>|]/g, " ")} - ${date(account.issue_date)}.pdf`;
      const token = await graphToken();
      // Same-account retries overwrite the same unique account-number filename instead of getting stuck on 409.
      const upload = await fetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(filename)}:/content?@microsoft.graph.conflictBehavior=replace`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf" },
        body: bytes
      });
      if (!upload.ok) throw new Error(`sharepoint_upload_failed:${upload.status}`);
      const item = await upload.json();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((x) => x.toString(16).padStart(2, "0")).join("");
      const { data: finalized, error: finalizeError } = await userClient.rpc("finalize_finance_transaction_account", {
        p_account_id: accountId,
        p_filename: filename,
        p_pdf_sha256: hash,
        p_drive_id: driveId,
        p_folder_item_id: folderId,
        p_item_id: item.id,
        p_web_url: item.webUrl
      });
      if (finalizeError) throw finalizeError;
      Object.assign(account, finalized);
    } else {
      bytes = await buildPdf(account);
    }

    const recipient = clean(account.customer_email_snapshot);
    if (!recipient) {
      await userClient.rpc("mark_finance_transaction_outlook", { p_account_id: accountId, p_status: "missing_recipient" });
      return new Response(JSON.stringify({ accountId, filename, outlookStatus: "missing_recipient" }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    try {
      const token = await graphToken();
      const sender = clean(Deno.env.get("MS_MAIL_SENDER"));
      if (!sender) throw new Error("mail_sender_not_configured");
      const draft = await graph(token, `/users/${encodeURIComponent(sender)}/messages`, {
        method: "POST",
        body: JSON.stringify({
          subject: `חשבון עסקה ${account.transaction_account_number} – תעשיידע – ${account.customer_name_snapshot}`,
          body: {
            contentType: "Text",
            content: `שלום,\n\nמצורף חשבון עסקה מס׳ ${account.transaction_account_number} עבור הפעילויות שבוצעו בתקופה הרלוונטית.\n\nנשמח להסדרת התשלום בהתאם לתנאי התשלום המפורטים בחשבון.`
          },
          toRecipients: [{ emailAddress: { address: recipient } }],
          attachments: [{
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: filename,
            contentType: "application/pdf",
            contentBytes: base64(bytes)
          }]
        })
      });
      await userClient.rpc("mark_finance_transaction_outlook", { p_account_id: accountId, p_status: "draft_ready", p_message_id: draft.id });
      return new Response(JSON.stringify({ accountId, filename, outlookStatus: "draft_ready" }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    } catch (mailError) {
      await userClient.rpc("mark_finance_transaction_outlook", {
        p_account_id: accountId,
        p_status: "failed",
        p_error: clean((mailError as Error).message)
      });
      return new Response(JSON.stringify({
        accountId,
        filename,
        outlookStatus: "failed",
        warning: "החשבון הופק ונשמר, אך יצירת טיוטת המייל נכשלה."
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: clean((error as Error).message) }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
});

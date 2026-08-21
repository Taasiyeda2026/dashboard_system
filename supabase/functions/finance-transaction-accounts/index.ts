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

// חשבונות עסקה - תשפז
// Site9 / Shared Documents / עידן - טוני / חשבונות עסקה - תשפז
const TRANSACTION_DRIVE_ID = "b!AtuGFxdZBk6FLP0KPlKdH27mOwNzeTRErL1YKP0yl5EP6fDqQimqQ4QpOG6yQbMh";
const TRANSACTION_FOLDER_ID = "01LT7GPE6FW7O7REM6WJBIXX6II2IDYTXM";

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

function recipientAddresses(value: unknown) {
  const unique = new Map<string, string>();
  for (const part of clean(value).split(/[;,]/)) {
    const email = clean(part);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    unique.set(email.toLowerCase(), email);
  }
  return [...unique.values()];
}

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
  if (!response.ok) throw new Error(`graph_request_failed:${response.status}:${(await response.text()).slice(0, 180)}`);
  return response.status === 204 ? null : response.json();
}

async function validateTransactionFolder(token: string) {
  const item = await graph(
    token,
    `/drives/${encodeURIComponent(TRANSACTION_DRIVE_ID)}/items/${encodeURIComponent(TRANSACTION_FOLDER_ID)}?$select=id,name,folder,parentReference`
  );
  if (!item?.id || item.id !== TRANSACTION_FOLDER_ID || !item?.folder) throw new Error("transaction_sharepoint_folder_invalid");
  if (clean(item?.parentReference?.driveId) && clean(item.parentReference.driveId) !== TRANSACTION_DRIVE_ID) {
    throw new Error("transaction_sharepoint_folder_invalid");
  }
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
    fetch("https://raw.githubusercontent.com/Taasiyeda2026/dashboard_system/main/frontend/assets/fonts/Arimo-Regular.ttf").then((r) => {
      if (!r.ok) throw new Error("pdf_regular_font_load_failed");
      return r.arrayBuffer();
    }),
    fetch("https://raw.githubusercontent.com/Taasiyeda2026/dashboard_system/main/frontend/assets/fonts/Arimo-Bold.ttf").then((r) => {
      if (!r.ok) throw new Error("pdf_bold_font_load_failed");
      return r.arrayBuffer();
    }),
    fetch("https://raw.githubusercontent.com/Taasiyeda2026/dashboard_system/main/frontend/assets/logo1.png").then((r) => {
      if (!r.ok) throw new Error("pdf_logo_load_failed");
      return r.arrayBuffer();
    })
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

  if (y < 155) { page = doc.addPage([595, 842]); y = 800; }
  drawRight(page, bold, `סה"כ לתשלום: ${money(account.total_amount)}`, y, 13); y -= 26;
  drawRight(page, bold, `לתשלום עד: ${date(account.payment_due_date)}`, y, 11); y -= 30;
  drawRight(page, bold, 'פרטי חשבון בנק להעברה:', y, 10); y -= 17;
  drawRight(page, regular, 'בנק הפועלים סניף 611 חשבון 300120', y, 10); y -= 19;
  drawRight(page, regular, 'או בשיק לפקודת: תעשיידע - תעשייה למען חינוך מתקדם (ע"ר)', y, 10); y -= 19;
  drawRight(page, regular, 'יש לציין: "למוטב בלבד" עם קרוס.', y, 10);

  return new Uint8Array(await doc.save());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let accountId = "";
  let userClient: ReturnType<typeof createClient> | null = null;
  let graphAccessToken = "";
  let uploadedItemId = "";
  let finalized = false;

  try {
    const auth = req.headers.get("authorization") || "";
    const url = clean(Deno.env.get("SUPABASE_URL"));
    const anon = clean(Deno.env.get("SUPABASE_ANON_KEY"));
    const service = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    if (!url || !anon || !service) throw new Error("supabase_function_not_configured");

    userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: allowed, error: allowError } = await userClient.rpc("app_can_access_finance");
    if (allowError || !allowed) throw new Error("not_authorized");

    const body = await req.json();
    accountId = clean(body.accountId);
    if (!accountId) throw new Error("account_required");

    const admin = createClient(url, service);
    const { data: account, error } = await admin
      .from("finance_transaction_accounts")
      .select("*,finance_transaction_account_lines(*,finance_transaction_account_meetings(*))")
      .eq("id", accountId)
      .single();
    if (error) throw error;
    if (!["generating", "issued", "mail_draft_ready"].includes(account.document_status)) throw new Error("account_not_dispatchable");

    if (account.outlook_status === "draft_ready" && account.outlook_message_id) {
      return new Response(JSON.stringify({
        accountId,
        filename: account.generated_filename,
        outlookStatus: "draft_ready",
        messageId: account.outlook_message_id
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    graphAccessToken = await graphToken();
    await validateTransactionFolder(graphAccessToken);

    let bytes: Uint8Array;
    let filename = account.generated_filename;
    if (account.document_status === "generating") {
      bytes = await buildPdf(account);
      filename = `חשבון עסקה ${account.transaction_account_number} - ${clean(account.customer_name_snapshot).replace(/[\\/:*?\"<>|]/g, " ")} - ${date(account.issue_date)}.pdf`;
      const upload = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(TRANSACTION_DRIVE_ID)}/items/${encodeURIComponent(TRANSACTION_FOLDER_ID)}:/${encodeURIComponent(filename)}:/content?@microsoft.graph.conflictBehavior=replace`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${graphAccessToken}`, "Content-Type": "application/pdf" },
          body: bytes
        }
      );
      if (!upload.ok) throw new Error(`sharepoint_upload_failed:${upload.status}:${(await upload.text()).slice(0, 180)}`);
      const item = await upload.json();
      uploadedItemId = clean(item.id);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      const { data: finalizedAccount, error: finalizeError } = await admin.rpc("finalize_finance_transaction_account", {
        p_account_id: accountId,
        p_filename: filename,
        p_pdf_sha256: hash,
        p_drive_id: TRANSACTION_DRIVE_ID,
        p_folder_item_id: TRANSACTION_FOLDER_ID,
        p_item_id: item.id,
        p_web_url: item.webUrl
      });
      if (finalizeError) throw finalizeError;
      Object.assign(account, finalizedAccount);
      finalized = true;
    } else {
      finalized = true;
      bytes = await buildPdf(account);
    }

    const recipients = recipientAddresses(account.customer_email_snapshot);
    if (!recipients.length) {
      await admin.rpc("mark_finance_transaction_outlook", { p_account_id: accountId, p_status: "missing_recipient" });
      return new Response(JSON.stringify({ accountId, filename, outlookStatus: "missing_recipient" }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    try {
      const sender = clean(Deno.env.get("MS_MAIL_SENDER"));
      if (!sender) throw new Error("mail_sender_not_configured");
      const draft = await graph(graphAccessToken, `/users/${encodeURIComponent(sender)}/messages`, {
        method: "POST",
        body: JSON.stringify({
          subject: `חשבון עסקה ${account.transaction_account_number} – תעשיידע – ${account.customer_name_snapshot}`,
          body: {
            contentType: "Text",
            content: `שלום,\n\nמצורף חשבון עסקה מס׳ ${account.transaction_account_number} עבור הפעילויות שבוצעו בתקופה הרלוונטית.\n\nנשמח להסדרת התשלום בהתאם לתנאי התשלום המפורטים בחשבון.`
          },
          toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
          attachments: [{
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: filename,
            contentType: "application/pdf",
            contentBytes: base64(bytes)
          }]
        })
      });
      await admin.rpc("mark_finance_transaction_outlook", {
        p_account_id: accountId,
        p_status: "draft_ready",
        p_message_id: draft.id
      });
      return new Response(JSON.stringify({ accountId, filename, outlookStatus: "draft_ready", recipients }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    } catch (mailError) {
      await admin.rpc("mark_finance_transaction_outlook", {
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
    const message = clean((error as Error).message) || "transaction_dispatch_failed";
    if (!finalized && uploadedItemId && graphAccessToken) {
      try {
        await graph(graphAccessToken, `/drives/${encodeURIComponent(TRANSACTION_DRIVE_ID)}/items/${encodeURIComponent(uploadedItemId)}`, { method: "DELETE" });
      } catch { /* best-effort orphan cleanup */ }
    }
    if (!finalized && accountId && userClient) {
      try {
        await userClient.rpc("cancel_generating_finance_transaction_account", {
          p_account_id: accountId,
          p_reason: `dispatch_failed:${message.slice(0, 240)}`
        });
      } catch { /* a concurrently finalized account must not be cancelled */ }
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, PDFFont, PDFPage, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import bidiFactory from "npm:bidi-js@1.0.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  // The browser's Supabase client always sends x-client-info. Without it Chrome
  // accepts OPTIONS but blocks the PDF POST before it reaches this function.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const clean = (value: unknown) => String(value ?? "").trim();
// Hebrew is placed explicitly from right to left in the PDF. Do not let
// fontkit re-run bidirectional layout on already-reversed mixed text.

// חשבונות עסקה - תשפז
// Site9 / Shared Documents / עידן - טוני / חשבונות עסקה - תשפז
const TRANSACTION_DRIVE_ID = "b!AtuGFxdZBk6FLP0KPlKdH27mOwNzeTRErL1YKP0yl5EP6fDqQimqQ4QpOG6yQbMh";
const TRANSACTION_FOLDER_ID = "01LT7GPE6FW7O7REM6WJBIXX6II2IDYTXM";

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

// pdf-lib/fontkit cannot reliably render a pre-reordered Hebrew + number string:
// it applies another bidi pass, reversing dates and dispersing glyphs. Place each
// Hebrew glyph explicitly RTL; leave contiguous Latin/numeric tokens in LTR order.
// This remains selectable/vector text in the PDF, not an image or screenshot.
function logicalRuns(value: unknown): string[] {
  return clean(value).match(/[A-Za-z0-9][A-Za-z0-9.,/@%:+\-]*|./gu) || [];
}
function logicalTextWidth(font: PDFFont, value: unknown, size: number): number {
  return logicalRuns(value).reduce((width, run) => width + font.widthOfTextAtSize(run, size), 0);
}
function drawLogicalRight(page: PDFPage, font: PDFFont, value: unknown, y: number, size: number, rightX: number, leftX: number) {
  const runs = logicalRuns(value);
  const measured = logicalTextWidth(font, value, size);
  // Keep table values inside their actual column, rather than silently
  // overlapping the adjacent cell when a school or activity name is long.
  const effectiveSize = measured > rightX - leftX
    ? size * (rightX - leftX) / measured : size;
  let cursor = rightX;
  for (const run of runs) {
    cursor -= font.widthOfTextAtSize(run, effectiveSize);
    if (!run.trim()) continue;
    page.drawText(run, {
      x: cursor, y, size: effectiveSize, font,
      color: rgb(0.08, 0.12, 0.18)
    });
  }
}
function drawRight(page: PDFPage, font: PDFFont, value: string, y: number, size = 9, rightX = 565) {
  drawLogicalRight(page, font, value, y, size, rightX, 30);
}
// Calculate wrapping once, then size each row to its real contents. Normal
// invoice rows stay compact; only long school/course names grow modestly.
function invoiceCellLines(font: PDFFont, value: string, width: number, size: number): string[] {
  const maxWidth = width - 10;
  const lines: string[] = [];
  for (const text of String(value ?? '').split('\n')) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && logicalTextWidth(font, candidate, size) > maxWidth && lines.length < 2) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines.slice(0, 3);
}
function invoiceRowHeight(font: PDFFont, values: string[], widths: number[], size = 8.5): number {
  const mostLines = Math.max(1, ...values.map((value, index) =>
    invoiceCellLines(font, value, widths[index], size).length));
  return 25 + (mostLines - 1) * 9; // 25 / 34 / 43 pt, never 43 for every course
}
function drawCell(page: PDFPage, font: PDFFont, value: string, x: number, y: number, width: number, size = 8.5, height = 25) {
  const parts = invoiceCellLines(font, value, width, size);
  const lineSpacing = 10.5;
  const firstBaseline = y + (height + (parts.length - 1) * lineSpacing) / 2 - 4;
  parts.forEach((line, index) =>
    drawLogicalRight(page, font, line, firstBaseline - index * lineSpacing, size, x + width - 5, x + 5));
}

function drawTableRow(page: PDFPage, font: PDFFont, values: string[], widths: number[], y: number, height = 24, fill = false) {
  let x = 565;
  values.forEach((value, index) => {
    const width = widths[index];
    x -= width;
    page.drawRectangle({
      x, y, width, height,
      borderWidth: 0.6,
      borderColor: rgb(0.72, 0.76, 0.8),
      ...(fill ? { color: rgb(0.95, 0.97, 0.98) } : {})
    });
    drawCell(page, font, value, x, y, width, fill ? 8.2 : 8.5, height);
  });
}


type InvoiceRenderRow = { category: string; name: string; school: string; gefen: string; quantity: number; hours: number; amount: number; unitPrice: number; hourlyPrice: number; };
function invoiceRenderRows(lines: any[], keepDistinctActivities = false): { courses: InvoiceRenderRow[]; services: InvoiceRenderRow[] } {
  const courses = new Map<string, InvoiceRenderRow>();
  const services = new Map<string, InvoiceRenderRow>();
  for (const line of lines || []) {
    const category = clean(line.activity_type_snapshot || line.activity_type).toLowerCase();
    // Unknown legacy snapshots use the course layout; live issuance and
    // previews resolve every activity's actual type before calling buildPdf.
    const service = ['workshop', 'tour', 'סדנה', 'סיור'].includes(category);
    const amount = Number(line.amount || 0);
    const statedQty = Number(line.quantity_snapshot);
    const quantity = Number.isFinite(statedQty) && statedQty > 0 ? statedQty
      : (line.finance_transaction_account_meetings?.length || 1);
    const hours = Math.max(0, Number(line.billed_hours || 0));
    const name = clean(line.service_description_snapshot || line.activity_name_snapshot);
    const school = clean(line.school_name_snapshot);
    const gefen = clean(line.gefen_number_snapshot);
    const unitPrice = Number(line.unit_price_snapshot) > 0
      ? Number(line.unit_price_snapshot) : amount / quantity;
    const group = service ? services : courses;
    // Workshops/tours: identical items at the same unit price + school
    // combine into one quantity row, even across separate activity records.
    // Courses: one line per actual course ID, combining all billed meetings.
    const key = service
      ? (keepDistinctActivities && clean(line.activity_row_id)
        ? `activity:${clean(line.activity_row_id)}`
        : JSON.stringify([category, name, school, Number(unitPrice.toFixed(6))]))
      : clean(line.activity_row_id) || JSON.stringify([name, school, gefen, Number(line.hourly_rate_snapshot || 0)]);
    const existing = group.get(key);
    if (existing) {
      existing.quantity += quantity;
      existing.hours += hours;
      existing.amount += amount;
      existing.unitPrice = existing.amount / existing.quantity;
      existing.hourlyPrice = existing.hours > 0 ? existing.amount / existing.hours : 0;
    } else {
      group.set(key, {
        category: service ? 'service' : 'course', name, school, gefen,
        quantity, hours, amount, unitPrice,
        hourlyPrice: hours > 0 ? amount / hours : Number(line.hourly_rate_snapshot || 0)
      });
    }
  }
  return { courses: [...courses.values()], services: [...services.values()] };
}
async function attachActivityTypes(account: any, client: ReturnType<typeof createClient>) {
  const lines = account?.finance_transaction_account_lines || [];
  const ids = [...new Set(lines.map((line: any) => clean(line.activity_row_id)).filter(Boolean))];
  if (!ids.length) return account;
  const { data, error } = await client.from('activities')
    .select('row_id,activity_type,activity_season').in('row_id', ids);
  if (error) throw new Error('invoice_activity_types_unavailable');
  const byId = new Map((data || []).filter((a: any) => a.activity_season === 'school_2027')
    .map((a: any) => [clean(a.row_id), clean(a.activity_type)]));
  for (const line of lines) {
    const type = byId.get(clean(line.activity_row_id));
    if (!type) throw new Error('invoice_activity_type_missing');
    line.activity_type_snapshot = type;
  }
  return account;
}

async function buildPdf(account: any) {
  const [regularBytes, boldBytes, logoBytes] = await Promise.all([
    fetch("https://raw.githubusercontent.com/Taasiyeda2026/dashboard_system/main/frontend/assets/fonts/Alef-Regular.ttf").then((r) => {
      if (!r.ok) throw new Error("pdf_regular_font_load_failed");
      return r.arrayBuffer();
    }),
    fetch("https://raw.githubusercontent.com/Taasiyeda2026/dashboard_system/main/frontend/assets/fonts/Alef-Bold.ttf").then((r) => {
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
  const regular = await doc.embedFont(regularBytes, { subset: false });
  const bold = await doc.embedFont(boldBytes, { subset: false });
  const logo = await doc.embedPng(logoBytes);
  const draft = clean(account.transaction_account_number) === 'טיוטה';
  doc.setTitle(draft
    ? `טיוטת חשבון עסקה - ${clean(account.customer_name_snapshot)}`
    : `חשבון עסקה ${clean(account.transaction_account_number)} - ${clean(account.customer_name_snapshot)}`);
  // A single letterhead for every account type, matching the workshop invoice
  // reference: logo left, publisher details right, divider, document title,
  // date, customer and academic-year heading. Repeat on continuation pages.
  const drawInvoiceHeader = (targetPage: PDFPage, continuation = false): number => {
    const logoScale = Math.min(132 / logo.width, 70 / logo.height);
    const logoWidth = logo.width * logoScale;
    const logoHeight = logo.height * logoScale;
    targetPage.drawImage(logo, {
      x: 35, y: 804 - logoHeight, width: logoWidth, height: logoHeight
    });

    drawRight(targetPage, bold, 'תעשיידע – תעשייה למען חינוך מתקדם ע"ר', 797, 11);
    drawRight(targetPage, regular, 'דניאל פריש 3, תל אביב | טלפון: 055-4548890', 776, 9.5);
    drawRight(targetPage, regular, "עמותה מס': 580210094 | אימייל: toni@think.org.il", 758, 9.5);

    // Unlike the older course PDF, the dividing rule belongs below the
    // publisher's letterhead, not below the invoice title.
    targetPage.drawLine({
      start: { x: 30, y: 719 }, end: { x: 565, y: 719 },
      thickness: 1.2, color: rgb(0.83, 0.88, 0.92)
    });

    drawRight(targetPage, bold, draft
      ? (continuation ? 'טיוטת חשבון עסקה | המשך' : 'טיוטת חשבון עסקה | לבדיקה בלבד')
      : `חשבון עסקה מס׳ ${account.transaction_account_number} | ${continuation ? 'המשך' : 'מקור'}`, 687, 17);
    drawRight(targetPage, regular, `תאריך הפקה: ${date(account.issue_date)}`, 659, 10);
    // Recipient/customer information belongs to the first page ONLY.
    // Do not repeat "לכבוד" above bank details on a continuation page.
    if (continuation) return 625;
    drawRight(targetPage, bold, `לכבוד: ${account.customer_name_snapshot}`, 629, 11);

    if (clean(account.institution_symbol)) {
      const schoolBilling = account.finance_transaction_account_lines?.some(
        (line: { billing_rule?: string }) => line.billing_rule === 'monthly');
      drawRight(targetPage, regular,
        `${schoolBilling ? 'סמל מוסד' : 'מספר לקוח'}: ${clean(account.institution_symbol)}`, 608, 10);
    }
    drawRight(targetPage, bold, 'תוכניות חינוכיות – שנת תשפ"ז', 573, 13);
    return 545;
  };
  let page = doc.addPage([595, 842]);
  let y = drawInvoiceHeader(page);

  const consolidatedFunder = (account.billing_basis === 'consolidated' || account.issue_mode === 'manual')
    && (account.finance_transaction_account_lines || []).length > 1
    && (account.finance_transaction_account_lines || []).every((line: { billing_rule?: string }) => line.billing_rule === 'completion');
  const { courses, services } = invoiceRenderRows(account.finance_transaction_account_lines || [], consolidatedFunder);
  // Each section uses the appropriate, minimal accounting columns. Both
  // sections may appear on one invoice for the same payer.
  const drawSection = (title: string, columns: string[], widths: number[],
    rows: InvoiceRenderRow[], values: (row: InvoiceRenderRow) => string[]) => {
    if (!rows.length) return;
    const headerHeight = columns.length === 7 ? 30 : 25;
    const firstRowHeight = invoiceRowHeight(regular, values(rows[0]), widths);
    if (y < 55 + headerHeight + firstRowHeight + 22) {
      page = doc.addPage([595, 842]);
      y = drawInvoiceHeader(page, true);
    }
    drawRight(page, bold, title, y, 11);
    y -= 23;
    drawTableRow(page, bold, columns, widths, y - headerHeight, headerHeight, true);
    y -= headerHeight;
    for (const row of rows) {
      const cellValues = values(row);
      const rowHeight = invoiceRowHeight(regular, cellValues, widths);
      if (y < 55 + rowHeight) {
        page = doc.addPage([595, 842]);
        y = drawInvoiceHeader(page, true);
        drawTableRow(page, bold, columns, widths, y - headerHeight, headerHeight, true);
        y -= headerHeight;
      }
      drawTableRow(page, regular, cellValues, widths, y - rowHeight, rowHeight, false);
      y -= rowHeight;
    }
    y -= 17;
  };
  const displayName = (row: InvoiceRenderRow) =>
    row.school ? (consolidatedFunder ? `${row.name}\n${row.school}` : `${row.name} - ${row.school}`) : row.name;
  const count = (number: number) => Number.isInteger(number)
    ? String(number) : String(Number(number.toFixed(2)));
  // Course invoices use the seven accounting columns requested by finance.
  // Workshops and tours retain their own four-column quantity-based table.
  // Both share the exact same letterhead, typography and grid styling.
  const courseWidths = [94, 119, 56, 42, 46, 80, 98]; // A4 printable width: 535
  const serviceWidths = [265, 65, 100, 105];
  drawSection('קורסים',
    ['שם בית הספר', 'תוכנית / קורס', 'מספר גפ״ן', 'שעות', 'מפגשים', 'מחיר לשעה', 'סה״כ'],
    courseWidths, courses,
    (row) => [row.school || '—', row.name, row.gefen || '—',
      count(row.hours), count(row.quantity), money(row.hourlyPrice), money(row.amount)]);
  drawSection('סדנאות וסיורים',
    ['פעילות', 'כמות', 'מחיר ליחידה', 'סה״כ'],
    serviceWidths, services,
    (row) => [displayName(row), count(row.quantity), money(row.unitPrice), money(row.amount)]);
  // Invoices never reveal funding source, activity-completion period or
  // internal meeting-level billing details; those remain in the database.

  // Keep payment details together. On a payment-only continuation page use
  // only the document heading, never a second "לכבוד" customer block.
  if (y < 173) { page = doc.addPage([595, 842]); y = drawInvoiceHeader(page, true); }
  drawRight(page, bold, `סה"כ לתשלום: ${money(account.total_amount)}`, y, 13); y -= 26;
  drawRight(page, bold, `לתשלום עד: ${date(account.payment_due_date)}`, y, 11); y -= 27;
  // A quiet separator between the total/due date and the bank transfer info.
  page.drawLine({
    start: { x: 30, y: y + 7 }, end: { x: 565, y: y + 7 },
    thickness: 0.6, color: rgb(0.86, 0.89, 0.92)
  });
  y -= 11;
  drawRight(page, bold, 'פרטי חשבון בנק להעברה:', y, 10); y -= 17;
  drawRight(page, regular, 'בנק הפועלים 12  |  סניף 500 הרימון  |  חשבון 300120', y, 10); y -= 19;
  drawRight(page, regular, 'או בשיק לפקודת: תעשיידע - תעשייה למען חינוך מתקדם ע"ר', y, 10); y -= 19;
  drawRight(page, regular, 'יש לציין: "למוטב בלבד" עם קרוס.', y, 10);
  const pages = doc.getPages();
  pages.forEach((part, index) => {
    drawLogicalRight(part, regular, `עמוד ${index + 1} מתוך ${pages.length}`, 26, 8, 565, 30);
  });

  return new Uint8Array(await doc.save());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let accountId = "";
  let userClient: ReturnType<typeof createClient> | null = null;
  let graphAccessToken = "";
  let uploadedItemId = "";
  let finalized = false;
  let admin: ReturnType<typeof createClient> | null = null;
  const dispatchToken = crypto.randomUUID();
  let leaseAcquired = false;

  try {
    const auth = req.headers.get("authorization") || "";
    const url = clean(Deno.env.get("SUPABASE_URL"));
    const anon = clean(Deno.env.get("SUPABASE_ANON_KEY"));
    const service = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    if (!url || !anon || !service) throw new Error("supabase_function_not_configured");

    userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: allowed, error: allowError } = await userClient.rpc("finance_transaction_can_issue");
    if (allowError || !allowed) throw new Error("not_authorized");

    const body = await req.json();
    if (body.preview === true) {
      const consolidated = Array.isArray(body.funderBatch);
      const manual = body.manual || {};
      const { data: quote, error: quoteError } = consolidated
        ? await userClient.rpc("finance_funder_batch_quote", { p_items: body.funderBatch })
        : await userClient.rpc("finance_manual_account_quote", {
          p_activity: manual.activity, p_funder: manual.funder, p_month: manual.month, p_draft: manual.draft || {}
        });
      if (quoteError) throw quoteError;
      await attachActivityTypes(quote, createClient(url, service));
      const previewBytes = await buildPdf(quote);
      return new Response(JSON.stringify({ quote, pdfBase64: base64(previewBytes) }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    accountId = clean(body.accountId);
    if (!accountId) throw new Error("account_required");

    admin = createClient(url, service);
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

    const { error: leaseError } = await admin.rpc("acquire_finance_dispatch", { p_account_id: accountId, p_token: dispatchToken });
    if (leaseError) throw leaseError;
    leaseAcquired = true;
    const { error: validationError } = await admin.rpc("validate_finance_dispatch", { p_account_id: accountId, p_token: dispatchToken });
    if (validationError) throw validationError;
    graphAccessToken = await graphToken();
    await validateTransactionFolder(graphAccessToken);

    let bytes: Uint8Array;
    let filename = account.generated_filename;
    if (account.document_status === "generating") {
      await attachActivityTypes(account, admin);
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
      const { data: finalizedAccount, error: finalizeError } = await admin.rpc("finalize_finance_billing", {
        p_token: dispatchToken,
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
      const stored = await fetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(account.sharepoint_drive_id)}/items/${encodeURIComponent(account.sharepoint_item_id)}/content`, { headers: { Authorization: `Bearer ${graphAccessToken}` } });
      if (!stored.ok) throw new Error("issued_pdf_download_failed");
      bytes = new Uint8Array(await stored.arrayBuffer());
      const storedHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((x) => x.toString(16).padStart(2, "0")).join("");
      if (storedHash !== account.pdf_sha256) throw new Error("issued_pdf_hash_mismatch");
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
      const propertyId = "String {fe840b5e-3427-421b-a522-224fbb1c2c65} Name FinanceAccountId";
      const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${propertyId}' and ep/value eq '${accountId}')`;
      const previous = await graph(graphAccessToken, `/users/${encodeURIComponent(sender)}/messages?$filter=${encodeURIComponent(filter)}&$select=id&$top=1`);
      const draft = previous.value?.[0] || await graph(graphAccessToken, `/users/${encodeURIComponent(sender)}/messages`, {
        method: "POST",
        body: JSON.stringify({
          subject: `חשבון עסקה ${account.transaction_account_number} – תעשיידע – ${account.customer_name_snapshot}`,
          body: {
            contentType: "Text",
            content: account.collection_status === "paid" ? `שלום,\n\nמצורף חשבון עסקה מס׳ ${account.transaction_account_number}. יתרת החשבון שולמה במלואה.` : `שלום,\n\nמצורף חשבון עסקה מס׳ ${account.transaction_account_number} עבור הפעילויות שבוצעו בתקופה הרלוונטית.\n\nנשמח להסדרת התשלום בהתאם לתנאי התשלום המפורטים בחשבון.`
          },
          singleValueExtendedProperties: [{ id: propertyId, value: accountId }],
          toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
          attachments: [{
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: filename,
            contentType: "application/pdf",
            contentBytes: base64(bytes)
          }]
        })
      });
      const { error: markError } = await admin.rpc("mark_finance_transaction_outlook", {
        p_account_id: accountId,
        p_status: "draft_ready",
        p_message_id: draft.id
      });
      if (markError) throw markError;
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
    if (leaseAcquired && !finalized && accountId && admin) {
      try {
        const { error: cancelError } = await admin.rpc("cancel_finance_dispatch", {
          p_token: dispatchToken,
          p_account_id: accountId,
          p_reason: `dispatch_failed:${message.slice(0, 240)}`
        });
        // Only remove the upload after the server confirms this dispatch still
        // owns a generating reservation. A lost finalize response must never
        // delete an already-issued document, or another worker's upload.
        if (!cancelError && uploadedItemId && graphAccessToken) {
          await graph(graphAccessToken, `/drives/${encodeURIComponent(TRANSACTION_DRIVE_ID)}/items/${encodeURIComponent(uploadedItemId)}`, { method: "DELETE" });
        }
      } catch { /* preserve any document whose cancellation was not confirmed */ }
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  } finally {
    if (leaseAcquired && admin) await admin.rpc("release_finance_dispatch", { p_account_id: accountId, p_token: dispatchToken });
  }
});

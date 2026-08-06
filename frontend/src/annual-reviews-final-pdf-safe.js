import { supabase } from './supabase-client.js';
import { escapeHtml } from './screens/shared/html.js';
import { registerAnnualReviewExtension } from './annual-reviews-safe-runtime.js';

const BUCKET = 'annual-review-final-pdfs';
const TABLE = 'annual_review_final_documents';
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function formatFileSize(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function friendlyError(error) {
  const message = String(error?.message || error || '');
  const mappings = [
    ['annual_review_final_pdf_manager_forbidden', 'רק המנהל המשויך למשוב רשאי להעלות את הקובץ הסופי.'],
    ['annual_review_final_pdf_review_not_completed', 'ניתן להעלות את הקובץ רק לאחר שהמשוב הושלם וננעל.'],
    ['annual_review_final_pdf_already_registered', 'כבר נשמר קובץ PDF סופי למשוב זה.'],
    ['annual_review_final_pdf_object_missing', 'הקובץ לא נמצא באחסון. יש לנסות להעלות אותו מחדש.'],
    ['annual_review_final_pdf_size_mismatch', 'גודל הקובץ שנשמר אינו תואם. יש לפנות למנהל המערכת.'],
    ['annual_review_final_pdf_invalid_size', 'גודל הקובץ אינו תקין.'],
    ['annual_review_final_pdf_invalid_sha256', 'בדיקת תקינות הקובץ נכשלה.']
  ];
  return mappings.find(([key]) => message.includes(key))?.[1] || message || 'הפעולה נכשלה.';
}

async function loadDocument(reviewId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('review_id,file_path,original_file_name,mime_type,file_size,sha256,uploaded_at')
    .eq('review_id', reviewId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function assertPdf(file) {
  if (!(file instanceof File)) throw new Error('יש לבחור קובץ PDF.');
  if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error('ניתן להעלות קובץ PDF בלבד.');
  if (file.size <= 0) throw new Error('הקובץ ריק.');
  if (file.size > MAX_FILE_SIZE) throw new Error('גודל הקובץ המרבי הוא 20 MB.');

  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const signature = String.fromCharCode(...header);
  if (signature !== '%PDF-') throw new Error('הקובץ שנבחר אינו קובץ PDF תקין.');
}

async function sha256Hex(blob) {
  if (!globalThis.crypto?.subtle) throw new Error('הדפדפן אינו מאפשר לבצע בדיקת תקינות לקובץ.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isDuplicateUpload(error) {
  const message = String(error?.message || '').toLowerCase();
  return Number(error?.statusCode || error?.status || 0) === 409
    || message.includes('duplicate')
    || message.includes('already exists')
    || message.includes('resource already exists');
}

async function verifyExistingObject(path, file, expectedSha256) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw error;
  if (Number(data?.size || 0) !== file.size) throw new Error('קיים כבר קובץ אחר עבור המשוב. יש לפנות למנהל המערכת.');
  const storedSha256 = await sha256Hex(data);
  if (storedSha256 !== expectedSha256) throw new Error('קיים כבר קובץ אחר עבור המשוב. יש לפנות למנהל המערכת.');
}

async function signedUrl(document, download = false) {
  const options = download ? { download: document.original_file_name || 'משוב-סופי.pdf' } : undefined;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(document.file_path, 120, options);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('לא ניתן לפתוח את הקובץ.');
  return data.signedUrl;
}

async function openDocument(document, download = false) {
  const popup = window.open('about:blank', '_blank');
  try {
    const url = await signedUrl(document, download);
    if (popup) {
      popup.opener = null;
      popup.location.replace(url);
    } else {
      window.location.assign(url);
    }
  } catch (error) {
    popup?.close();
    throw error;
  }
}

function documentCardHtml(document) {
  const uploadedAt = formatDate(document.uploaded_at);
  const fileSize = formatFileSize(document.file_size);
  return `<section class="ar2-card" data-final-pdf-card>
    <div class="ar2-card__head">
      <div>
        <h2>מסמך המשוב הסופי</h2>
        <p class="ar2-muted">הקובץ נשמר בארכיון פרטי וזמין לעובד ולמנהל לצפייה בלבד.</p>
      </div>
      <span class="ar2-status is-complete">הועלה וננעל</span>
    </div>
    <div class="ar2-private" style="display:grid;gap:5px">
      <strong>${escapeHtml(document.original_file_name || 'משוב סופי.pdf')}</strong>
      <span>${escapeHtml([fileSize, uploadedAt].filter(Boolean).join(' · '))}</span>
      <span>לא ניתן להחליף, לערוך או למחוק את הקובץ דרך המערכת.</span>
    </div>
    <div class="ar2-actions ar2-no-print">
      <button type="button" class="ar2-btn ar2-btn--primary" data-final-pdf-view>צפייה בקובץ</button>
      <button type="button" class="ar2-btn ar2-btn--ghost" data-final-pdf-download>הורדת הקובץ</button>
    </div>
  </section>`;
}

function uploadCardHtml(isManager) {
  return `<section class="ar2-card" data-final-pdf-card>
    <div class="ar2-card__head">
      <div>
        <h2>מסמך המשוב הסופי</h2>
        <p class="ar2-muted">לאחר השלמת המשוב נשמר עותק PDF סופי לצפייה עתידית.</p>
      </div>
      <span class="ar2-status is-waiting">ממתין להעלאה</span>
    </div>
    ${isManager ? `<div class="ar2-private" style="display:grid;gap:8px">
      <span>יש להפיק את המשוב באמצעות הכפתור „הדפסת המשוב המלא”, לשמור כ־PDF ולהעלות כאן.</span>
      <strong>לאחר ההעלאה לא ניתן להחליף או למחוק את הקובץ.</strong>
      <label class="ar2-field">
        <span>בחירת קובץ PDF עד 20 MB</span>
        <input class="ar2-input" type="file" accept="application/pdf,.pdf" data-final-pdf-file>
      </label>
      <span class="ar2-muted" data-final-pdf-selection>לא נבחר קובץ.</span>
      <div class="ar2-save" data-final-pdf-state aria-live="polite"></div>
    </div>
    <div class="ar2-actions ar2-no-print">
      <button type="button" class="ar2-btn ar2-btn--primary" data-final-pdf-upload disabled>העלאת הקובץ הסופי ונעילתו</button>
    </div>` : '<div class="ar2-private">המנהל טרם העלה את קובץ המשוב הסופי.</div>'}
  </section>`;
}

function insertCard(root, html) {
  root.querySelector('[data-final-pdf-card]')?.remove();
  const footer = root.querySelector('footer.ar2-signatures');
  if (!footer) return null;
  footer.insertAdjacentHTML('beforebegin', html);
  return root.querySelector('[data-final-pdf-card]');
}

function setUploadState(card, message, isError = false) {
  const node = card.querySelector('[data-final-pdf-state]');
  if (!node) return;
  node.textContent = message;
  node.dataset.state = isError ? 'error' : '';
}

function bindDocumentCard(card, document) {
  card.querySelector('[data-final-pdf-view]')?.addEventListener('click', async () => {
    try {
      await openDocument(document, false);
    } catch (error) {
      window.alert(friendlyError(error));
    }
  });
  card.querySelector('[data-final-pdf-download]')?.addEventListener('click', async () => {
    try {
      await openDocument(document, true);
    } catch (error) {
      window.alert(friendlyError(error));
    }
  });
}

function bindUploadCard(root, card, context) {
  const input = card.querySelector('[data-final-pdf-file]');
  const button = card.querySelector('[data-final-pdf-upload]');
  const selection = card.querySelector('[data-final-pdf-selection]');
  if (!input || !button) return;

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    button.disabled = !file;
    if (selection) selection.textContent = file ? `${file.name} · ${formatFileSize(file.size)}` : 'לא נבחר קובץ.';
    setUploadState(card, '');
  });

  button.addEventListener('click', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (!window.confirm('הקובץ יישמר כגרסה הסופית ולא ניתן יהיה להחליפו או למחוק אותו. להמשיך?')) return;

    input.disabled = true;
    button.disabled = true;
    try {
      setUploadState(card, 'בודק את הקובץ…');
      await assertPdf(file);
      const digest = await sha256Hex(file);
      const path = `${context.review.id}/final.pdf`;

      setUploadState(card, 'מעלה את הקובץ…');
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: '31536000',
        contentType: 'application/pdf',
        upsert: false
      });
      if (uploadError) {
        if (!isDuplicateUpload(uploadError)) throw uploadError;
        await verifyExistingObject(path, file, digest);
      }

      setUploadState(card, 'נועל ושומר בארכיון…');
      const { data, error } = await supabase.rpc('register_annual_review_final_document', {
        p_review_id: context.review.id,
        p_original_file_name: file.name,
        p_file_size: file.size,
        p_sha256: digest
      });
      if (error && !String(error.message || '').includes('annual_review_final_pdf_already_registered')) throw error;

      const document = data || await loadDocument(context.review.id);
      if (!document) throw new Error('הקובץ הועלה אך רישום הארכיון לא הושלם.');
      const newCard = insertCard(root, documentCardHtml(document));
      if (newCard) bindDocumentCard(newCard, document);
    } catch (error) {
      input.disabled = false;
      button.disabled = !input.files?.[0];
      setUploadState(card, friendlyError(error), true);
    }
  });
}

registerAnnualReviewExtension(async (root, context) => {
  if (context.review.status !== 'completed_locked' || root.dataset.finalPdfSafe === 'true') return;
  root.dataset.finalPdfSafe = 'true';

  const document = await loadDocument(context.review.id);
  if (document) {
    const card = insertCard(root, documentCardHtml(document));
    if (card) bindDocumentCard(card, document);
    return;
  }

  const card = insertCard(root, uploadCardHtml(context.isManager));
  if (card && context.isManager) bindUploadCard(root, card, context);
});

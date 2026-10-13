import { supabase } from './supabase-client.js';
import { escapeHtml } from './screens/shared/html.js';

const BUCKET = 'client-external-documents';
const MAX_BYTES = 15 * 1024 * 1024;
const text = value => String(value ?? '').trim();
const safe = value => escapeHtml(text(value));
const kindLabel = kind => kind === 'agreement' ? 'הסכם חיצוני' : 'הצעת מחיר חיצונית';
const dateLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value).slice(0, 10))
  ? text(value).slice(0, 10).split('-').reverse().join('.') : '';
const amountLabel = value => value == null || value === '' ? '' : '₪' + Number(value).toLocaleString('he-IL', { maximumFractionDigits: 2 });

function ensureStyles() {
  if (document.getElementById('client-external-documents-style-v1')) return;
  const node = document.createElement('style');
  node.id = 'client-external-documents-style-v1';
  node.textContent = `
    .ds-client-external{grid-column:1/-1;border:1px solid #d3e4eb;border-radius:16px;padding:16px;background:#fff;min-width:0}
    .ds-client-external__head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}
    .ds-client-external__head h3{margin:0}
    .ds-client-external__list{display:grid;gap:8px}
    .ds-client-external__item{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;border:1px solid #dce8ed;border-radius:10px;flex-wrap:wrap}
    .ds-client-external__details{min-width:0;flex:1;overflow-wrap:anywhere}
    .ds-client-external__details strong,.ds-client-external__details small{display:block}
    .ds-client-external__details small{font-size:.77rem;color:#596b7d;margin-top:3px}
    .ds-client-external__actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
    .ds-client-external__form{margin-top:10px;border:1px solid #dce8ed;border-radius:12px;background:#f8fbfd;padding:12px;display:grid;gap:10px}
    .ds-client-external__fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .ds-client-external__form label{display:grid;gap:5px;font-size:.78rem;font-weight:600;color:#475569}
    .ds-client-external__form input,.ds-client-external__form select,.ds-client-external__form textarea{width:100%;box-sizing:border-box;min-height:34px;border:1px solid #cad9e3;border-radius:7px;padding:6px;background:#fff;font:inherit}
    .ds-client-external__form [data-ext-full]{grid-column:1/-1}
    .ds-client-external__form-actions{display:flex;align-items:center;gap:10px}
    .ds-client-external__message{font-size:.8rem;color:#526679}
    .ds-client-external__error{font-size:.8rem;color:#b42318}
    @media(max-width:640px){.ds-client-external__fields{grid-template-columns:1fr}}
  `;
  document.head.appendChild(node);
}

export function externalClientDocumentsHtml(canManage = false) {
  return `<section class="ds-client-external" data-pa-external-documents aria-label="הסכמים והצעות מחיר חיצוניים">
    <div class="ds-client-external__head"><h3>הסכמים והצעות מחיר חיצוניים</h3>
      ${canManage ? '<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-ext-add>＋ מסמך חיצוני</button>' : ''}</div>
    <div class="ds-client-external__list" data-ext-list><p class="ds-client-external__message">טוען מסמכים…</p></div>
    <div data-ext-editor></div>
    <p class="ds-client-external__error" data-ext-error role="alert" hidden></p>
  </section>`;
}

export function externalClientDocumentFormHtml() {
  return `<form class="ds-client-external__form" data-ext-form>
    <div class="ds-client-external__fields">
      <label>סוג מסמך<select name="document_kind" required><option value="agreement">הסכם חיצוני</option><option value="quote">הצעת מחיר חיצונית</option></select></label>
      <label>כותרת המסמך<input name="title" maxlength="200" placeholder="לדוגמה: הסכם תוכנית יישומי AI" required></label>
      <label>מספר מסמך חיצוני (אם קיים)<input name="external_number" maxlength="100"></label>
      <label>תאריך המסמך<input type="date" name="document_date"></label>
      <label>סכום בש״ח (אופציונלי)<input type="number" name="amount" min="0" step="0.01"></label>
      <label data-ext-full>קובץ PDF<input type="file" name="document_file" accept=".pdf,application/pdf" required></label>
      <label data-ext-full>הערות (אופציונלי)<textarea name="notes" maxlength="2000" rows="2"></textarea></label>
    </div>
    <div class="ds-client-external__form-actions">
      <button type="submit" class="ds-btn ds-btn--sm ds-btn--primary" data-ext-save>שמירת מסמך</button>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-ext-cancel>ביטול</button>
      <span class="ds-client-external__message" data-ext-progress aria-live="polite"></span>
    </div>
  </form>`;
}

export function externalClientDocumentRowsHtml(rows = [], canManage = false) {
  if (!rows.length) return '<p class="ds-client-external__message">עדיין לא צורפו הסכמים או הצעות מחיר חיצוניים.</p>';
  return rows.map(row => {
    const summary = [kindLabel(row.document_kind), text(row.external_number) ? 'מס׳ חיצוני: ' + text(row.external_number) : '',
      dateLabel(row.document_date), amountLabel(row.amount)].filter(Boolean).join(' · ');
    return `<article class="ds-client-external__item" data-ext-row="${safe(row.id)}">
      <div class="ds-client-external__details"><strong>${safe(row.title)}</strong><small>${safe(summary)} · קובץ PDF</small></div>
      <div class="ds-client-external__actions">
        <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-ext-view="${safe(row.id)}">צפייה ב־PDF</button>
        ${canManage ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-ext-delete="${safe(row.id)}">מחיקה</button>` : ''}
      </div>
    </article>`;
  }).join('');
}

/** Dedicated client-file section; no proposal or finance workflows are invoked. */
export async function mountClientExternalDocuments(workspace, file, { canManage = false, signal } = {}) {
  const host = workspace?.querySelector?.('[data-pa-external-documents]');
  if (!host || !file?.key) return;
  ensureStyles();
  const list = host.querySelector('[data-ext-list]');
  const editor = host.querySelector('[data-ext-editor]');
  const errorBox = host.querySelector('[data-ext-error]');
  let rows = [];
  const active = () => host.isConnected && !signal?.aborted;
  const message = value => {
    if (!active()) return;
    errorBox.textContent = value || '';
    errorBox.hidden = !value;
  };
  const refresh = async () => {
    const { data, error } = await supabase.from('client_external_documents')
      .select('id,client_key,document_kind,title,external_number,document_date,amount,notes,file_name,file_path,created_at')
      .eq('client_key', file.key).order('created_at', { ascending: false });
    if (!active()) return;
    if (error) {
      list.innerHTML = '<p class="ds-client-external__error">טעינת המסמכים נכשלה. נא לרענן את תיק הלקוח.</p>';
      return;
    }
    rows = Array.isArray(data) ? data.filter(row => row.client_key === file.key) : [];
    list.innerHTML = externalClientDocumentRowsHtml(rows, canManage);
  };

  host.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-ext-add],[data-ext-cancel],[data-ext-view],[data-ext-delete]');
    if (!button) return;
    event.stopPropagation();
    message('');
    if (button.hasAttribute('data-ext-add') && canManage) {
      editor.innerHTML = externalClientDocumentFormHtml();
      editor.querySelector('[name="title"]')?.focus();
      return;
    }
    if (button.hasAttribute('data-ext-cancel')) {
      editor.replaceChildren();
      return;
    }
    const id = button.dataset.extView || button.dataset.extDelete;
    const row = rows.find(item => item.id === id);
    if (!row) return;
    if (button.hasAttribute('data-ext-view')) {
      const tab = window.open('', '_blank');
      if (tab) tab.opener = null;
      try {
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(row.file_path, 90);
        if (error || !data?.signedUrl) throw error || new Error('Missing signed URL');
        if (tab && !tab.closed) tab.location.replace(data.signedUrl);
        else message('הדפדפן חסם פתיחת חלון. יש לאפשר חלונות קופצים ולנסות שוב.');
      } catch {
        tab?.close();
        message('פתיחת הקובץ נכשלה. יש לנסות שוב.');
      }
      return;
    }
    if (!canManage || !window.confirm('למחוק את המסמך "' + row.title + '" מתיק הלקוח?')) return;
    button.disabled = true;
    try {
      const { error } = await supabase.from('client_external_documents').delete()
        .eq('id', row.id).eq('client_key', file.key);
      if (error) throw error;
      const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([row.file_path]);
      await refresh();
      if (cleanupError) message('הרשומה הוסרה, אך ניקוי קובץ האחסון דורש טיפול.');
    } catch {
      if (active()) button.disabled = false;
      message('מחיקת המסמך נכשלה.');
    }
  });

  host.addEventListener('submit', async event => {
    const form = event.target.closest?.('[data-ext-form]');
    if (!form) return;
    event.preventDefault();
    event.stopPropagation();
    if (!canManage) return;
    message('');
    const fields = new FormData(form);
    const pdf = fields.get('document_file');
    const title = text(fields.get('title'));
    if (!title || !pdf || typeof pdf.size !== 'number' || !/\.pdf$/i.test(pdf.name || '') || !pdf.size || pdf.size > MAX_BYTES ||
        (pdf.type && pdf.type !== 'application/pdf')) {
      message('יש לבחור קובץ PDF תקין עד 15MB ולהזין כותרת.');
      return;
    }
    const id = globalThis.crypto?.randomUUID?.();
    if (!id) { message('לא ניתן ליצור מזהה מאובטח למסמך. יש לנסות בדפדפן מעודכן.'); return; }
    const path = 'documents/' + id + '.pdf';
    const saveButton = form.querySelector('[data-ext-save]');
    const progress = form.querySelector('[data-ext-progress]');
    saveButton.disabled = true;
    progress.textContent = 'מעלה ושומר…';
    let uploaded = false;
    try {
      const { error: uploadError } = await supabase.storage.from(BUCKET)
        .upload(path, pdf, { contentType: 'application/pdf', upsert: false });
      if (uploadError) throw uploadError;
      uploaded = true;
      const amountValue = text(fields.get('amount'));
      const { error: insertError } = await supabase.from('client_external_documents').insert({
        id, client_key: file.key, document_kind: fields.get('document_kind'), title,
        external_number: text(fields.get('external_number')) || null,
        document_date: text(fields.get('document_date')) || null,
        amount: amountValue ? Number(amountValue) : null,
        notes: text(fields.get('notes')) || null,
        file_path: path, file_name: pdf.name
      });
      if (insertError) throw insertError;
      if (!active()) return;
      editor.replaceChildren();
      await refresh();
    } catch {
      if (uploaded) {
        try { await supabase.storage.from(BUCKET).remove([path]); } catch { /* best effort */ }
      }
      message('שמירת המסמך נכשלה. לא שונתה הצעת מחיר במערכת.');
    } finally {
      if (active() && saveButton.isConnected) {
        saveButton.disabled = false;
        progress.textContent = '';
      }
    }
  });

  await refresh();
}

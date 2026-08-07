import { supabase, waitForSupabaseAuthSession } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';

const STYLE_ID = 'contacts-multi-email-style';
const PAGE_SIZE = 1000;
let recordsPromise = null;
let scheduled = false;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalize(value) {
  return text(value).toLowerCase().normalize('NFKC').replace(/\s+/g, ' ');
}

function parseEmails(row) {
  let raw = row?.emails;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  const seen = new Set();
  const emails = (Array.isArray(raw) ? raw : [])
    .map((item) => ({
      id: text(item?.id),
      email: text(item?.email),
      isPrimary: Boolean(item?.is_primary)
    }))
    .filter((item) => {
      const key = normalize(item.email);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const legacy = text(row?.email);
  if (legacy && !seen.has(normalize(legacy))) {
    emails.push({ id: '', email: legacy, isPrimary: true });
  }
  if (emails.length && !emails.some((item) => item.isPrimary)) emails[0].isPrimary = true;
  return emails.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}

async function readAll() {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('contacts_unified_view')
      .select('source_table,source_id,contact_name,email,emails')
      .eq('source_table', 'contacts_schools')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = Array.isArray(data) ? data : [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadRecords() {
  if (!supabase) return { byNameAndEmail: new Map(), byEmail: new Map(), bySourceId: new Map() };
  await waitForSupabaseAuthSession({ timeoutMs: 8000 }).catch(() => null);
  const rows = await readAll();
  const byNameAndEmail = new Map();
  const byEmail = new Map();
  const bySourceId = new Map();

  rows.forEach((row) => {
    const emails = parseEmails(row);
    if (emails.length < 2) return;
    const record = {
      sourceId: text(row.source_id),
      name: text(row.contact_name),
      emails
    };
    bySourceId.set(record.sourceId, record);
    emails.forEach((item) => {
      byNameAndEmail.set(`${normalize(record.name)}|${normalize(item.email)}`, record);
      const emailKey = normalize(item.email);
      if (!byEmail.has(emailKey)) byEmail.set(emailKey, record);
      else byEmail.set(emailKey, null);
    });
  });

  return { byNameAndEmail, byEmail, bySourceId };
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .cme-picker{position:relative;min-width:0}
    .cme-picker>summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:30px;padding:5px 8px;border:1px solid #dce8ef;border-radius:9px;background:#f8fcff;color:var(--ds-accent,#0292b7);font-weight:700;cursor:pointer}
    .cme-picker>summary::-webkit-details-marker{display:none}
    .cme-picker[open]>summary{border-color:var(--ds-accent,#0292b7);background:#eefaff}
    .cme-menu{position:absolute;z-index:80;inset-inline-end:0;top:calc(100% + 5px);width:min(430px,86vw);display:grid;gap:7px;padding:10px;border:1px solid #dbe6ee;border-radius:12px;background:#fff;box-shadow:0 14px 35px rgba(15,23,42,.2)}
    .cme-option{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;padding:6px;border-radius:8px}
    .cme-option:hover{background:#f8fafc}
    .cme-address{direction:ltr;text-align:left;overflow-wrap:anywhere;color:#0f172a}
    .cme-primary{font-size:11px;font-weight:800;color:#166534;background:#dcfce7;border-radius:999px;padding:2px 7px}
    .cme-set-primary{border:0;background:transparent;color:#64748b;cursor:pointer;font:inherit;font-size:12px;text-decoration:underline}
    .cme-set-primary:hover{color:var(--ds-accent,#0292b7)}
    .cme-actions{display:flex;justify-content:flex-end;border-top:1px solid #edf2f7;padding-top:8px}
    .cme-send{border:0;border-radius:9px;padding:7px 12px;background:var(--ds-accent,#0292b7);color:#fff;font:inherit;font-weight:800;cursor:pointer}
    .cme-set-primary:disabled{opacity:.55;cursor:wait}
    @media(max-width:760px){.cme-menu{position:static;width:auto;margin-top:6px}}
  `;
  document.head.appendChild(style);
}

function pickerHtml(record) {
  const primary = record.emails.find((item) => item.isPrimary) || record.emails[0];
  const options = record.emails.map((item) => {
    const control = item.isPrimary
      ? '<span class="cme-primary">ראשי</span>'
      : item.id
        ? `<button type="button" class="cme-set-primary" data-cme-primary="${escapeHtml(item.id)}">הגדר כראשי</button>`
        : '';
    return `<label class="cme-option">
      <input type="checkbox" data-cme-choice value="${escapeHtml(item.email)}"${item.isPrimary ? ' checked' : ''} />
      <span class="cme-address">${escapeHtml(item.email)}</span>
      ${control}
    </label>`;
  }).join('');

  return `<details class="cme-picker" data-cme-picker data-source-id="${escapeHtml(record.sourceId)}">
    <summary><span dir="ltr">${escapeHtml(primary.email)}</span><span>${record.emails.length} כתובות</span></summary>
    <div class="cme-menu">${options}<div class="cme-actions"><button type="button" class="cme-send" data-cme-send>פתיחת מייל לכתובות שנבחרו</button></div></div>
  </details>`;
}

function mailAddress(link) {
  const href = text(link?.getAttribute('href'));
  if (!href.toLowerCase().startsWith('mailto:')) return '';
  try { return decodeURIComponent(href.slice(7).split('?')[0]); } catch { return href.slice(7).split('?')[0]; }
}

async function enhance() {
  scheduled = false;
  const cards = [...document.querySelectorAll('.cfd-contact:not([data-cme-enhanced])')];
  if (!cards.length) return;
  ensureStyle();
  if (!recordsPromise) recordsPromise = loadRecords();
  const index = await recordsPromise;

  cards.forEach((card) => {
    const link = card.querySelector('a[href^="mailto:"]');
    if (!link) return;
    const email = mailAddress(link);
    const name = text(card.querySelector('.cfd-contact__name')?.textContent);
    const record = index.byNameAndEmail.get(`${normalize(name)}|${normalize(email)}`)
      || index.byEmail.get(normalize(email));
    if (!record) return;
    const cell = link.parentElement;
    if (!cell) return;
    cell.innerHTML = pickerHtml(record);
    card.setAttribute('data-cme-enhanced', 'yes');
  });
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  window.setTimeout(() => enhance().catch((error) => console.error('[contacts-multi-email]', error)), 50);
}

document.addEventListener('click', async (event) => {
  const sendButton = event.target?.closest?.('[data-cme-send]');
  if (sendButton) {
    event.preventDefault();
    const picker = sendButton.closest('[data-cme-picker]');
    const selected = [...picker.querySelectorAll('[data-cme-choice]:checked')]
      .map((input) => text(input.value))
      .filter(Boolean);
    const unique = [...new Set(selected)];
    if (!unique.length) return window.alert('יש לבחור לפחות כתובת מייל אחת.');
    window.location.href = `mailto:${unique.join(',')}`;
    return;
  }

  const primaryButton = event.target?.closest?.('[data-cme-primary]');
  if (!primaryButton) return;
  event.preventDefault();
  event.stopPropagation();
  const picker = primaryButton.closest('[data-cme-picker]');
  const sourceId = text(picker?.dataset?.sourceId);
  const emailId = text(primaryButton.dataset.cmePrimary);
  if (!sourceId || !emailId || !supabase) return;

  primaryButton.disabled = true;
  primaryButton.textContent = 'מעדכן…';
  const { error } = await supabase.from('contact_emails').update({ is_primary: true }).eq('id', emailId);
  if (error) {
    console.error('[contacts-multi-email] primary update failed', error);
    primaryButton.disabled = false;
    primaryButton.textContent = 'הגדר כראשי';
    return window.alert('לא ניתן היה להגדיר את כתובת המייל כראשית.');
  }

  const index = await recordsPromise;
  const record = index.bySourceId.get(sourceId);
  if (record) {
    record.emails.forEach((item) => { item.isPrimary = item.id === emailId; });
    picker.outerHTML = pickerHtml(record);
  }
});

const app = document.getElementById('app');
if (app) new MutationObserver(schedule).observe(app, { childList: true, subtree: true });
window.addEventListener('hashchange', schedule);
window.addEventListener('popstate', schedule);
schedule();

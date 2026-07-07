import { escapeHtml } from './html.js';

const SUMMER_CONTACT_COLS = [
  ['external_key', 'מספר ייחודי'],
  ['authority', 'רשות'],
  ['school', 'שם בית ספר'],
  ['contact_name', 'איש קשר'],
  ['contact_phone', 'טלפון'],
  ['school_address', 'כתובת בית הספר'],
  ['city_or_authority', 'רשות / עיר']
];

export function normalizeSummerContactRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === 'object')
    .map((row) => ({
      external_key: String(row.external_key || '').trim(),
      authority: String(row.authority || '').trim(),
      school: String(row.school || '').trim(),
      contact_name: String(row.contact_name || '').trim(),
      contact_phone: String(row.contact_phone || '').trim(),
      school_address: String(row.school_address || '').trim(),
      city_or_authority: String(row.city_or_authority || '').trim()
    }));
}

function phoneHref(phone) {
  const cleaned = String(phone || '').replace(/[^0-9+]/g, '');
  return cleaned ? `tel:${cleaned}` : '';
}

export function summerContactsModalHtml(rows) {
  const contacts = normalizeSummerContactRows(rows);
  if (!contacts.length) return `<p class="instr-summer-contacts-empty">לא נמצאו אנשי קשר להצגה</p>`;
  const head = SUMMER_CONTACT_COLS.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('');
  const body = contacts.map((row) => {
    const cells = SUMMER_CONTACT_COLS.map(([key]) => {
      const value = row[key] || '—';
      if (key === 'contact_phone' && row.contact_phone) {
        return `<td class="instr-summer-contact-phone"><a href="${escapeHtml(phoneHref(row.contact_phone))}" dir="ltr">${escapeHtml(row.contact_phone)}</a></td>`;
      }
      return `<td class="instr-summer-contact-${key.replace(/_/g, '-')}">${escapeHtml(value)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<div class="instr-summer-contacts-wrap"><table class="ds-table instr-summer-contacts-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderSummerContactsButton(extraAttributes = '') {
  const attrs = String(extraAttributes || '').trim();
  return `<button type="button" class="ds-btn ds-btn--primary instr-summer-contacts-btn" data-summer-contacts-open aria-haspopup="dialog"${attrs ? ` ${attrs}` : ''}>אנשי קשר</button>`;
}

export function bindSummerContactsModalEvents(root, { ui, api, rows = [], logPrefix = 'summer-contacts' } = {}) {
  let summerContacts = normalizeSummerContactRows(rows);
  const openSummerContacts = async () => {
    if (!ui) return;
    if (!summerContacts.length && api?.instructorSchedulePrintContacts) {
      try {
        const payload = await api.instructorSchedulePrintContacts();
        summerContacts = normalizeSummerContactRows(payload?.rows || []);
      } catch (err) {
        console.warn(`[${logPrefix}] instructorSchedulePrintContacts failed`, err?.message || err);
      }
    }
    ui.openModal({
      title: 'אנשי קשר',
      content: summerContactsModalHtml(summerContacts),
      modalClass: 'ds-modal--summer-contacts'
    });
  };
  root?.querySelectorAll?.('[data-summer-contacts-open]')?.forEach((btn) => {
    btn.addEventListener('click', openSummerContacts);
  });
}

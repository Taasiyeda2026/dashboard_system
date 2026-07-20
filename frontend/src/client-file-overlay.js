import { api } from './api.js';
import { state } from './state.js';
import { supabase } from './supabase-client.js';
import { escapeHtml } from './screens/shared/html.js';

const ROUTE = 'proposals-agreements';
const ROOT_ATTR = 'data-client-file-shell';
const LEGACY_ATTR = 'data-client-file-legacy';
const mountedRoots = new WeakSet();
let loadToken = 0;

const STATUS_LABELS = {
  draft: 'טיוטה',
  pending_approval: 'ממתינה לאישור',
  returned_for_changes: 'הוחזרה לתיקון',
  approved: 'ממתינה לשליחה',
  sent: 'נשלחה',
  cancelled: 'בוטלה'
};

const BOARD_COLUMNS = [
  { key: 'draft', title: 'טיוטות', statuses: ['draft'] },
  { key: 'pending', title: 'ממתינות לאישור', statuses: ['pending_approval'] },
  { key: 'returned', title: 'הוחזרו לתיקון', statuses: ['returned_for_changes'] },
  { key: 'approved', title: 'מאושרות וממתינות לשליחה', statuses: ['approved'] }
];

function text(value) {
  const raw = String(value == null ? '' : value).trim();
  return raw === 'null' || raw === 'undefined' ? '' : raw;
}

function normalize(value) {
  return text(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[^\p{L}\p{N}@.+-]+/gu, ' ')
    .trim();
}

function normalizeStatus(value) {
  const raw = normalize(value).replace(/\s+/g, '_');
  if (!raw) return 'draft';
  if (['pending', 'pending_approval', 'awaiting_approval', 'submitted', 'waiting_approval'].includes(raw)) return 'pending_approval';
  if (['returned', 'returned_for_changes', 'returned_for_correction', 'revision_requested', 'rejected'].includes(raw)) return 'returned_for_changes';
  if (['approved', 'approved_pending_send', 'pending_send'].includes(raw)) return 'approved';
  if (['sent', 'delivered'].includes(raw)) return 'sent';
  if (['cancelled', 'canceled', 'deleted', 'archived'].includes(raw)) return 'cancelled';
  return raw;
}

function safeArray(...values) {
  return values.find(Array.isArray) || [];
}

function proposalRows(data) {
  return safeArray(data?.rows, data?.proposals, data?.proposalsAgreements);
}

function contactRows(data) {
  return safeArray(
    data?.contactsSchools,
    data?.contacts_schools,
    data?.contactRows,
    data?.contacts,
    data?.schoolContacts
  );
}

function schoolRows(data) {
  return safeArray(data?.catalogSchools, data?.schools, data?.schoolCatalog);
}

function authorityRows(data) {
  return safeArray(data?.catalogAuthorities, data?.authorities, data?.authorityCatalog);
}

function first(...values) {
  return values.map(text).find(Boolean) || '';
}

function proposalAuthority(row) {
  return first(row?.client_authority, row?.authority_name, row?.authority, row?.client_name);
}

function proposalSchool(row) {
  return first(row?.school_framework, row?.school_name, row?.school);
}

function proposalClientType(row) {
  const type = normalize(row?.client_type);
  if (type === 'other') return 'other';
  return proposalSchool(row) ? 'school' : 'authority';
}

function clientKey(row = {}) {
  const clientType = first(row.client_type, proposalClientType(row));
  const schoolId = first(row.school_id, row.source_school_id);
  const authorityId = first(row.authority_id, row.source_authority_id);
  const semel = first(row.semel_mosad, row.institution_symbol);
  const authority = first(row.authority_name, row.authority, row.client_authority, row.client_name);
  const school = first(row.school_name, row.school, row.school_framework);
  if (clientType === 'other') return `other:${normalize(first(row.client_name, school, authority))}`;
  if (schoolId) return `school-id:${schoolId}`;
  if (semel) return `school-symbol:${semel}`;
  if (school) return `school-name:${normalize(authority)}|${normalize(school)}`;
  if (authorityId) return `authority-id:${authorityId}`;
  return `authority-name:${normalize(authority)}`;
}

function emptyClient(key) {
  return {
    key,
    client_type: 'school',
    authority_id: '',
    school_id: '',
    semel_mosad: '',
    authority: '',
    school: '',
    client_name: '',
    authority_type: '',
    district: '',
    contacts: [],
    proposals: []
  };
}

function mergeClient(client, row = {}) {
  client.client_type = first(row.client_type, client.client_type, proposalClientType(row));
  client.authority_id = first(client.authority_id, row.authority_id, row.source_authority_id);
  client.school_id = first(client.school_id, row.school_id, row.source_school_id);
  client.semel_mosad = first(client.semel_mosad, row.semel_mosad, row.institution_symbol);
  client.authority = first(client.authority, row.authority_name, row.authority, row.client_authority);
  client.school = first(client.school, row.school_name, row.school, row.school_framework);
  client.client_name = first(client.client_name, row.client_name, client.school, client.authority);
  client.authority_type = first(client.authority_type, row.authority_type);
  client.district = first(client.district, row.district);
  return client;
}

function dedupeContacts(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = [row.id, row.source_id, normalize(row.contact_name), normalize(row.mobile || row.phone), normalize(row.email)].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(first(row.contact_name, row.mobile, row.phone, row.email));
  });
}

function buildClients(data) {
  const map = new Map();
  const ensure = (row) => {
    const key = clientKey(row);
    if (!map.has(key)) map.set(key, emptyClient(key));
    return mergeClient(map.get(key), row);
  };

  authorityRows(data).forEach((row) => ensure({ ...row, client_type: 'authority' }));
  schoolRows(data).forEach((row) => ensure({ ...row, client_type: 'school' }));
  contactRows(data).forEach((row) => {
    const client = ensure(row);
    client.contacts.push(row);
  });
  proposalRows(data).forEach((row) => {
    const client = ensure({
      ...row,
      authority: proposalAuthority(row),
      school: proposalSchool(row),
      client_type: proposalClientType(row)
    });
    client.proposals.push(row);
  });

  return [...map.values()]
    .map((client) => ({ ...client, contacts: dedupeContacts(client.contacts) }))
    .filter((client) => first(client.school, client.authority, client.client_name))
    .sort((a, b) => `${a.authority}|${a.school}`.localeCompare(`${b.authority}|${b.school}`, 'he'));
}

function formatDate(value) {
  const raw = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || 'ללא תאריך';
  const [year, month, day] = raw.split('-');
  return `${day}.${month}.${year}`;
}

function formatAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'ללא סכום';
  return `${new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(amount)} ₪`;
}

function proposalType(row) {
  return first(row.activity_type_group, row.proposal_group, row.document_type, 'הצעת מחיר');
}

function proposalDate(row) {
  return first(row.proposal_date, row.updated_at, row.created_at);
}

function proposalTitle(row) {
  const quote = first(row.quote_number);
  return quote ? `הצעה ${quote}` : proposalType(row);
}

function boardCardHtml(row) {
  const authority = proposalAuthority(row) || 'ללא רשות';
  const school = proposalSchool(row);
  return `<button type="button" class="ds-cf-proposal-card" data-cf-open-proposal="${escapeHtml(text(row.id))}">
    <span class="ds-cf-proposal-card__client"><strong>${escapeHtml(school || authority)}</strong>${school ? `<small>${escapeHtml(authority)}</small>` : ''}</span>
    <span class="ds-cf-proposal-card__meta"><span>${escapeHtml(proposalType(row))}</span><span>${escapeHtml(formatDate(proposalDate(row)))}</span></span>
    <span class="ds-cf-proposal-card__amount">${escapeHtml(formatAmount(row.total_amount))}</span>
  </button>`;
}

function boardColumnHtml(column, rows) {
  const matching = rows.filter((row) => column.statuses.includes(normalizeStatus(row.status)));
  return `<section class="ds-cf-board-column" data-cf-column="${column.key}">
    <header><span>${escapeHtml(column.title)}</span><strong>${matching.length}</strong></header>
    <div class="ds-cf-board-column__cards">${matching.length ? matching.map(boardCardHtml).join('') : '<p class="ds-cf-empty-column">אין הצעות</p>'}</div>
  </section>`;
}

function mainDashboardHtml(data) {
  const rows = proposalRows(data);
  return `<div class="ds-cf-home" data-cf-home>
    <div class="ds-cf-search-row">
      <div class="ds-cf-search-wrap">
        <input type="search" class="ds-input" data-cf-search placeholder="חיפוש לפי רשות, בית ספר, סמל מוסד, איש קשר, נייד או דוא״ל" autocomplete="off">
        <button type="button" class="ds-cf-search-clear" data-cf-search-clear aria-label="ניקוי חיפוש">×</button>
        <div class="ds-cf-search-results" data-cf-search-results hidden></div>
      </div>
      <button type="button" class="ds-btn ds-btn--primary" data-cf-new-other>+ לקוח אחר</button>
    </div>
    <div class="ds-cf-board">${BOARD_COLUMNS.map((column) => boardColumnHtml(column, rows)).join('')}</div>
  </div>`;
}

function contactHtml(contact) {
  const name = first(contact.contact_name, contact.principal_name, 'איש קשר');
  const role = first(contact.contact_role, contact.role);
  const mobile = first(contact.mobile, contact.phone);
  const email = first(contact.email);
  const editable = normalize(contact.source_table) === 'contacts_schools' || Boolean(contact.id && !contact.source_table);
  return `<article class="ds-cf-contact-row">
    <div class="ds-cf-contact-row__main">
      <strong>${escapeHtml(name)}${role ? ` · ${escapeHtml(role)}` : ''}</strong>
      <span>${mobile ? escapeHtml(mobile) : 'ללא נייד'}${email ? ` · ${escapeHtml(email)}` : ''}</span>
    </div>
    ${editable ? `<button type="button" class="ds-cf-icon-btn" data-cf-edit-contact="${escapeHtml(text(contact.id || contact.source_id))}" aria-label="עריכת איש קשר">✎</button>` : ''}
  </article>`;
}

function proposalMiniCardHtml(row) {
  const status = normalizeStatus(row.status);
  const hasPdf = Boolean(first(row.final_pdf_path, row.final_pdf_file_name));
  return `<button type="button" class="ds-cf-mini-proposal" data-cf-open-proposal="${escapeHtml(text(row.id))}">
    <span><strong>${escapeHtml(proposalTitle(row))}</strong><small>${escapeHtml(formatDate(proposalDate(row)))}</small></span>
    <span class="ds-cf-mini-proposal__status">${escapeHtml(STATUS_LABELS[status] || text(row.status))}</span>
    <strong class="ds-cf-mini-proposal__amount">${escapeHtml(formatAmount(row.total_amount))}</strong>
    <span class="ds-cf-mini-proposal__view" aria-hidden="true">${hasPdf ? 'PDF' : 'צפייה'}</span>
  </button>`;
}

function clientFileHtml(client) {
  const current = client.proposals.filter((row) => !['sent', 'cancelled'].includes(normalizeStatus(row.status)));
  const archive = client.proposals.filter((row) => ['sent', 'cancelled'].includes(normalizeStatus(row.status)));
  return `<div class="ds-cf-client" data-cf-client data-client-key="${escapeHtml(client.key)}">
    <div class="ds-cf-client-toolbar">
      <button type="button" class="ds-btn ds-btn--ghost" data-cf-close-client>× סגירה</button>
      <div>
        <button type="button" class="ds-btn ds-btn--primary" data-cf-new-proposal>+ הצעת מחיר</button>
        <button type="button" class="ds-btn ds-btn--ghost" data-cf-add-contact>+ איש קשר</button>
      </div>
    </div>
    <div class="ds-cf-client-grid">
      <aside class="ds-cf-client-profile">
        <span class="ds-cf-eyebrow">${escapeHtml(client.client_type === 'other' ? 'לקוח אחר' : 'תיק לקוח')}</span>
        <h2>${escapeHtml(client.school || client.client_name || client.authority)}</h2>
        ${client.school ? `<p><strong>רשות:</strong> ${escapeHtml(client.authority || 'לא הוגדרה')}</p>` : ''}
        ${client.district ? `<p><strong>תחום/מחוז:</strong> ${escapeHtml(client.district)}</p>` : ''}
        ${client.semel_mosad ? `<p><strong>סמל מוסד:</strong> ${escapeHtml(client.semel_mosad)}</p>` : ''}
        <section class="ds-cf-contacts">
          <header><h3>אנשי קשר</h3><span>${client.contacts.length}</span></header>
          <div>${client.contacts.length ? client.contacts.map(contactHtml).join('') : '<p class="ds-cf-empty">לא הוגדרו אנשי קשר.</p>'}</div>
        </section>
      </aside>
      <main class="ds-cf-proposals-panel">
        <section>
          <header class="ds-cf-section-title"><h3>הצעות עדכניות</h3><span>${current.length}</span></header>
          <div class="ds-cf-proposals-list">${current.length ? current.map(proposalMiniCardHtml).join('') : '<p class="ds-cf-empty">אין הצעות עדכניות.</p>'}</div>
        </section>
        <details class="ds-cf-archive">
          <summary>ארכיון הצעות מחיר — ${archive.length}</summary>
          <div class="ds-cf-proposals-list">${archive.length ? archive.map(proposalMiniCardHtml).join('') : '<p class="ds-cf-empty">הארכיון ריק.</p>'}</div>
        </details>
      </main>
    </div>
  </div>`;
}

function searchResultHtml(client) {
  const title = client.school || client.client_name || client.authority;
  const secondary = [client.authority && client.school ? client.authority : '', client.semel_mosad ? `סמל מוסד ${client.semel_mosad}` : ''].filter(Boolean).join(' · ');
  return `<button type="button" data-cf-open-client="${escapeHtml(client.key)}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(secondary)}</span></button>`;
}

function searchMatches(client, query) {
  if (!query) return false;
  const haystack = [
    client.authority,
    client.school,
    client.client_name,
    client.semel_mosad,
    ...client.contacts.flatMap((contact) => [contact.contact_name, contact.contact_role, contact.mobile, contact.phone, contact.email])
  ].map(normalize).join(' ');
  return haystack.includes(query);
}

function setPageTitle() {
  document.querySelectorAll('[data-route="contacts"]').forEach((button) => {
    button.closest('.ds-act-nav-item, li, .nav-item')?.setAttribute('hidden', '');
    if (button.matches('.ds-act-nav-item')) button.hidden = true;
  });
  document.querySelectorAll('[data-route="proposals-agreements"] .ds-act-nav-item__label').forEach((label) => {
    const badge = label.querySelector('.ds-nav-count-badge');
    label.textContent = 'תיק לקוח ';
    if (badge) label.appendChild(badge);
  });
  const pageHeader = document.querySelector('#screenRoot .ds-page-header h1, #screenRoot .ds-page-header__title, #screenRoot h1');
  if (pageHeader && text(pageHeader.textContent).includes('הצעות')) pageHeader.textContent = 'תיק לקוח';
}

function legacySection(root) {
  return root.querySelector(`[${LEGACY_ATTR}]`);
}

function showLegacy(root, title = 'עריכת הצעה') {
  const legacy = legacySection(root);
  if (!legacy) return;
  legacy.hidden = false;
  root.classList.add('is-legacy-open');
  const status = root.querySelector('[data-cf-workspace-status]');
  if (status) {
    status.hidden = false;
    status.querySelector('strong').textContent = title;
  }
  root.querySelector('[data-cf-content]').hidden = true;
  legacy.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

function showWorkspace(root) {
  const legacy = legacySection(root);
  if (legacy) legacy.hidden = true;
  root.classList.remove('is-legacy-open');
  root.querySelector('[data-cf-content]').hidden = false;
  const status = root.querySelector('[data-cf-workspace-status]');
  if (status) status.hidden = true;
  root.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

function dispatchInput(element) {
  element?.dispatchEvent(new Event('input', { bubbles: true }));
  element?.dispatchEvent(new Event('change', { bubbles: true }));
}

function openProposalInLegacy(root, row) {
  showLegacy(root, proposalTitle(row));
  const legacy = legacySection(root);
  const status = normalizeStatus(row.status);
  const tab = legacy?.querySelector(`[data-pa-tab="${status === 'sent' ? 'sent' : 'records'}"]`);
  tab?.click();
  window.setTimeout(() => {
    const search = legacy?.querySelector('[data-pa-search]');
    const query = first(row.quote_number, proposalSchool(row), proposalAuthority(row));
    if (search) {
      search.value = query;
      dispatchInput(search);
    }
    window.setTimeout(() => {
      const rows = [...(legacy?.querySelectorAll('[data-pa-table-body] tr, .ds-table tbody tr') || [])];
      const target = rows.find((tr) => {
        const content = normalize(tr.textContent);
        return [row.quote_number, proposalSchool(row), proposalAuthority(row)].filter(Boolean).some((value) => content.includes(normalize(value)));
      });
      const button = target?.querySelector('button[data-pa-view], button[data-pa-action], button');
      button?.click();
    }, 420);
  }, 80);
}

function prefillProposalForm(form, client) {
  if (!form || !client) return;
  const values = {
    client_authority: client.authority,
    school_framework: client.school,
    contact_source_authority_id: client.authority_id,
    contact_source_school_id: client.school_id,
    contact_source_semel_mosad: client.semel_mosad,
    contact_source_client_type: client.client_type,
    contact_source_client_name: client.client_name || client.school || client.authority,
    contact_source_authority: client.authority,
    contact_source_school: client.school
  };
  Object.entries(values).forEach(([name, value]) => {
    const input = form.querySelector(`[name="${name}"]`);
    if (input) input.value = text(value);
  });
  const contact = client.contacts[0];
  if (contact) {
    const contactValues = {
      contact_source_id: first(contact.id, contact.source_id),
      contact_source_name: contact.contact_name,
      contact_source_role: contact.contact_role,
      contact_source_phone: first(contact.mobile, contact.phone),
      contact_source_mobile: first(contact.mobile, contact.phone),
      contact_source_email: contact.email,
      contact_name: contact.contact_name,
      contact_role: contact.contact_role,
      phone: first(contact.mobile, contact.phone),
      email: contact.email
    };
    Object.entries(contactValues).forEach(([name, value]) => {
      const input = form.querySelector(`[name="${name}"]`);
      if (input) input.value = text(value);
    });
  }
  form.querySelector('[data-pa-client-card]')?.removeAttribute('hidden');
}

function openNewProposal(root, client = null) {
  showLegacy(root, 'הצעת מחיר חדשה');
  const legacy = legacySection(root);
  legacy?.querySelector('[data-pa-tab="new"]')?.click();
  if (!client) return;
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    const form = legacy?.querySelector('[data-pa-form]');
    if (form) {
      window.clearInterval(timer);
      prefillProposalForm(form, client);
    } else if (attempts > 20) {
      window.clearInterval(timer);
    }
  }, 100);
}

function contactModalHtml(client, contact = null) {
  const isEdit = Boolean(contact);
  return `<div class="ds-cf-modal" data-cf-contact-modal role="dialog" aria-modal="true" aria-label="${isEdit ? 'עריכת' : 'הוספת'} איש קשר">
    <form class="ds-cf-modal__panel" data-cf-contact-form>
      <header><h3>${isEdit ? 'עריכת איש קשר' : 'איש קשר חדש'}</h3><button type="button" data-cf-close-contact-modal>×</button></header>
      <input type="hidden" name="id" value="${escapeHtml(first(contact?.id, contact?.source_id))}">
      <label><span>שם מלא</span><input class="ds-input" name="contact_name" required value="${escapeHtml(first(contact?.contact_name))}"></label>
      <label><span>תפקיד</span><input class="ds-input" name="contact_role" value="${escapeHtml(first(contact?.contact_role))}"></label>
      <label><span>נייד</span><input class="ds-input" name="mobile" value="${escapeHtml(first(contact?.mobile, contact?.phone))}"></label>
      <label><span>דוא״ל</span><input class="ds-input" type="email" name="email" value="${escapeHtml(first(contact?.email))}"></label>
      <p class="ds-cf-form-error" data-cf-contact-error></p>
      <footer><button type="button" class="ds-btn ds-btn--ghost" data-cf-close-contact-modal>ביטול</button><button type="submit" class="ds-btn ds-btn--primary">שמירה</button></footer>
    </form>
  </div>`;
}

async function saveContact(client, form) {
  if (!supabase) throw new Error('החיבור למסד הנתונים אינו זמין.');
  const formData = new FormData(form);
  const id = text(formData.get('id'));
  const row = {
    authority: client.authority || null,
    school: client.school || null,
    authority_id: client.authority_id ? Number(client.authority_id) : null,
    school_id: client.school_id ? Number(client.school_id) : null,
    semel_mosad: client.semel_mosad ? Number(client.semel_mosad) : null,
    client_type: client.client_type || (client.school ? 'school' : 'authority'),
    client_name: client.client_name || client.school || client.authority || null,
    contact_name: text(formData.get('contact_name')),
    contact_role: text(formData.get('contact_role')) || null,
    mobile: text(formData.get('mobile')) || null,
    phone: text(formData.get('mobile')) || null,
    email: text(formData.get('email')) || null,
    active: 'yes'
  };
  if (!row.contact_name) throw new Error('יש להזין שם מלא.');
  let query;
  if (id) query = supabase.from('contacts_schools').update(row).eq('id', id).select('*').single();
  else query = supabase.from('contacts_schools').insert(row).select('*').single();
  const { data, error } = await query;
  if (error) throw new Error(error.message || 'שמירת איש הקשר נכשלה.');
  return data;
}

function styleHtml() {
  return `<style data-cf-style>
    [${ROOT_ATTR}]{direction:rtl}.ds-cf-legacy[hidden]{display:none!important}
    .ds-cf-workspace-status{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;margin-bottom:10px;border:1px solid #cbd5e1;border-radius:14px;background:#f8fafc}.ds-cf-workspace-status[hidden]{display:none}
    .ds-cf-search-row{display:flex;align-items:flex-start;justify-content:center;gap:10px;margin:0 auto 18px;max-width:940px}.ds-cf-search-wrap{position:relative;flex:1}.ds-cf-search-wrap input{width:100%;min-height:46px;padding-inline-start:18px;padding-inline-end:42px}.ds-cf-search-clear{position:absolute;left:8px;top:7px;border:0;background:transparent;font-size:24px;color:#64748b;cursor:pointer}
    .ds-cf-search-results{position:absolute;z-index:80;top:52px;right:0;left:0;max-height:340px;overflow:auto;border:1px solid #cbd5e1;border-radius:14px;background:white;box-shadow:0 18px 42px rgba(15,23,42,.16);padding:6px}.ds-cf-search-results button{display:flex;width:100%;flex-direction:column;align-items:flex-start;border:0;border-radius:10px;background:white;padding:10px 12px;text-align:right;cursor:pointer}.ds-cf-search-results button:hover{background:#f1f5f9}.ds-cf-search-results span{font-size:.78rem;color:#64748b;margin-top:2px}
    .ds-cf-board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:start}.ds-cf-board-column{min-height:210px;border:1px solid #dbe4ee;border-radius:16px;background:#f8fafc;overflow:hidden}.ds-cf-board-column>header{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;border-bottom:1px solid #e2e8f0;background:white;font-weight:700}.ds-cf-board-column>header strong,.ds-cf-section-title span,.ds-cf-contacts header span{display:inline-flex;min-width:25px;height:25px;align-items:center;justify-content:center;border-radius:999px;background:#e2e8f0;color:#475569;font-size:.76rem}.ds-cf-board-column__cards{display:grid;gap:8px;padding:9px}.ds-cf-empty-column,.ds-cf-empty{margin:12px 4px;color:#94a3b8;font-size:.84rem;text-align:center}
    .ds-cf-proposal-card{display:grid;gap:7px;width:100%;border:1px solid #dbe4ee;border-radius:12px;background:white;padding:10px;text-align:right;cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.04)}.ds-cf-proposal-card:hover{border-color:#60a5fa;box-shadow:0 7px 18px rgba(37,99,235,.1)}.ds-cf-proposal-card__client{display:flex;flex-direction:column}.ds-cf-proposal-card__client small{color:#64748b;margin-top:2px}.ds-cf-proposal-card__meta{display:flex;justify-content:space-between;gap:8px;color:#64748b;font-size:.75rem}.ds-cf-proposal-card__amount{font-size:.9rem;color:#0f766e}
    .ds-cf-client-toolbar{display:flex;justify-content:space-between;gap:12px;margin-bottom:12px}.ds-cf-client-toolbar>div{display:flex;gap:8px}.ds-cf-client-grid{display:grid;grid-template-columns:minmax(270px,36%) minmax(0,1fr);gap:16px}.ds-cf-client-profile,.ds-cf-proposals-panel{border:1px solid #dbe4ee;border-radius:18px;background:white;padding:18px}.ds-cf-client-profile h2{margin:4px 0 12px;font-size:1.45rem}.ds-cf-client-profile>p{margin:5px 0;color:#475569}.ds-cf-eyebrow{font-size:.74rem;font-weight:700;color:#2563eb}.ds-cf-contacts{margin-top:22px}.ds-cf-contacts header,.ds-cf-section-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}.ds-cf-contacts h3,.ds-cf-section-title h3{margin:0;font-size:1rem}.ds-cf-contact-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 0;border-bottom:1px solid #eef2f7}.ds-cf-contact-row__main{display:flex;min-width:0;flex-direction:column;gap:2px}.ds-cf-contact-row__main strong{font-size:.85rem}.ds-cf-contact-row__main span{color:#64748b;font-size:.76rem;overflow-wrap:anywhere}.ds-cf-icon-btn{border:0;background:#f1f5f9;border-radius:8px;padding:5px 8px;cursor:pointer}
    .ds-cf-proposals-panel{display:grid;gap:20px}.ds-cf-proposals-list{display:grid;gap:8px}.ds-cf-mini-proposal{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;align-items:center;gap:10px;width:100%;border:1px solid #dbe4ee;border-radius:13px;background:#fff;padding:10px 12px;text-align:right;cursor:pointer}.ds-cf-mini-proposal:hover{border-color:#60a5fa;background:#f8fbff}.ds-cf-mini-proposal>span:first-child{display:flex;min-width:0;flex-direction:column}.ds-cf-mini-proposal small{color:#64748b;margin-top:2px}.ds-cf-mini-proposal__status{border-radius:999px;background:#eff6ff;color:#1d4ed8;padding:4px 8px;font-size:.72rem}.ds-cf-mini-proposal__amount{color:#0f766e;white-space:nowrap}.ds-cf-mini-proposal__view{color:#2563eb;font-size:.76rem}.ds-cf-archive{border-top:1px solid #e2e8f0;padding-top:16px}.ds-cf-archive summary{cursor:pointer;font-weight:700;margin-bottom:10px}
    .ds-cf-modal{position:fixed;z-index:1200;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.45);padding:20px}.ds-cf-modal__panel{width:min(480px,100%);display:grid;gap:12px;border-radius:18px;background:white;padding:18px;box-shadow:0 24px 70px rgba(15,23,42,.25)}.ds-cf-modal__panel header,.ds-cf-modal__panel footer{display:flex;align-items:center;justify-content:space-between;gap:10px}.ds-cf-modal__panel header h3{margin:0}.ds-cf-modal__panel header button{border:0;background:transparent;font-size:26px;cursor:pointer}.ds-cf-modal__panel label{display:grid;gap:5px}.ds-cf-modal__panel label span{font-size:.8rem;font-weight:700;color:#475569}.ds-cf-form-error{min-height:18px;margin:0;color:#dc2626;font-size:.8rem}.ds-cf-modal__panel footer{justify-content:flex-end}
    @media(max-width:1100px){.ds-cf-board{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.ds-cf-search-row,.ds-cf-client-toolbar{flex-direction:column}.ds-cf-search-row>button,.ds-cf-client-toolbar>div,.ds-cf-client-toolbar .ds-btn{width:100%}.ds-cf-board{grid-template-columns:1fr}.ds-cf-client-grid{grid-template-columns:1fr}.ds-cf-mini-proposal{grid-template-columns:1fr auto}.ds-cf-mini-proposal__amount,.ds-cf-mini-proposal__view{justify-self:start}}
  </style>`;
}

function renderClient(root, client) {
  root._cfActiveClientKey = client.key;
  root.querySelector('[data-cf-content]').innerHTML = clientFileHtml(client);
}

function renderHome(root, data) {
  root._cfActiveClientKey = '';
  root.querySelector('[data-cf-content]').innerHTML = mainDashboardHtml(data);
}

async function refreshWorkspace(root, preferredClientKey = '') {
  const token = ++loadToken;
  const content = root.querySelector('[data-cf-content]');
  content.innerHTML = '<div class="ds-loading-card"><div class="ds-spinner"></div><p>טוען תיקי לקוחות…</p></div>';
  const data = await api.proposalsAgreements();
  if (token !== loadToken || !document.contains(root)) return;
  root._cfData = data;
  root._cfClients = buildClients(data);
  const client = preferredClientKey ? root._cfClients.find((item) => item.key === preferredClientKey) : null;
  if (client) renderClient(root, client);
  else renderHome(root, data);
}

function bindWorkspace(root) {
  root.addEventListener('input', (event) => {
    const input = event.target.closest('[data-cf-search]');
    if (!input) return;
    const query = normalize(input.value);
    const host = root.querySelector('[data-cf-search-results]');
    if (!host) return;
    if (!query) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    const matches = (root._cfClients || []).filter((client) => searchMatches(client, query)).slice(0, 12);
    host.innerHTML = matches.length ? matches.map(searchResultHtml).join('') : '<p class="ds-cf-empty">לא נמצאו לקוחות.</p>';
    host.hidden = false;
  });

  root.addEventListener('click', (event) => {
    const clear = event.target.closest('[data-cf-search-clear]');
    if (clear) {
      const input = root.querySelector('[data-cf-search]');
      if (input) input.value = '';
      root.querySelector('[data-cf-search-results]')?.setAttribute('hidden', '');
      return;
    }
    const openClient = event.target.closest('[data-cf-open-client]');
    if (openClient) {
      const client = (root._cfClients || []).find((item) => item.key === openClient.dataset.cfOpenClient);
      if (client) renderClient(root, client);
      return;
    }
    const closeClient = event.target.closest('[data-cf-close-client]');
    if (closeClient) {
      renderHome(root, root._cfData || {});
      return;
    }
    const back = event.target.closest('[data-cf-back-workspace]');
    if (back) {
      showWorkspace(root);
      return;
    }
    const proposalButton = event.target.closest('[data-cf-open-proposal]');
    if (proposalButton) {
      const row = proposalRows(root._cfData).find((item) => text(item.id) === proposalButton.dataset.cfOpenProposal);
      if (row) openProposalInLegacy(root, row);
      return;
    }
    const newOther = event.target.closest('[data-cf-new-other]');
    if (newOther) {
      openNewProposal(root, null);
      return;
    }
    const newProposal = event.target.closest('[data-cf-new-proposal]');
    if (newProposal) {
      const client = (root._cfClients || []).find((item) => item.key === root._cfActiveClientKey);
      openNewProposal(root, client || null);
      return;
    }
    const addContact = event.target.closest('[data-cf-add-contact]');
    if (addContact) {
      const client = (root._cfClients || []).find((item) => item.key === root._cfActiveClientKey);
      if (client) root.insertAdjacentHTML('beforeend', contactModalHtml(client));
      return;
    }
    const editContact = event.target.closest('[data-cf-edit-contact]');
    if (editContact) {
      const client = (root._cfClients || []).find((item) => item.key === root._cfActiveClientKey);
      const contact = client?.contacts.find((item) => first(item.id, item.source_id) === editContact.dataset.cfEditContact);
      if (client && contact) root.insertAdjacentHTML('beforeend', contactModalHtml(client, contact));
      return;
    }
    if (event.target.closest('[data-cf-close-contact-modal]')) {
      event.target.closest('[data-cf-contact-modal]')?.remove();
    }
  });

  root.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-cf-contact-form]');
    if (!form) return;
    event.preventDefault();
    const client = (root._cfClients || []).find((item) => item.key === root._cfActiveClientKey);
    const errorHost = form.querySelector('[data-cf-contact-error]');
    const submit = form.querySelector('[type="submit"]');
    if (!client) return;
    try {
      if (submit) submit.disabled = true;
      if (errorHost) errorHost.textContent = '';
      await saveContact(client, form);
      form.closest('[data-cf-contact-modal]')?.remove();
      await refreshWorkspace(root, client.key);
    } catch (error) {
      if (errorHost) errorHost.textContent = error?.message || 'שמירת איש הקשר נכשלה.';
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

async function mountUnifiedClientFile(legacy) {
  if (!legacy || mountedRoots.has(legacy)) return;
  mountedRoots.add(legacy);
  legacy.setAttribute(LEGACY_ATTR, '');
  legacy.classList.add('ds-cf-legacy');
  legacy.hidden = true;
  const shell = document.createElement('section');
  shell.setAttribute(ROOT_ATTR, '');
  shell.className = 'ds-cf-shell';
  shell.innerHTML = `${styleHtml()}
    <div class="ds-cf-workspace-status" data-cf-workspace-status hidden><strong>עריכת הצעה</strong><button type="button" class="ds-btn ds-btn--ghost" data-cf-back-workspace>חזרה לתיק הלקוח</button></div>
    <div data-cf-content></div>`;
  legacy.parentNode.insertBefore(shell, legacy);
  shell.appendChild(legacy);
  bindWorkspace(shell);
  setPageTitle();
  try {
    await refreshWorkspace(shell);
  } catch (error) {
    shell.querySelector('[data-cf-content]').innerHTML = `<div class="ds-empty"><h3>לא ניתן לטעון את תיקי הלקוחות</h3><p>${escapeHtml(error?.message || 'שגיאה לא ידועה')}</p></div>`;
  }
}

function findProposalScreen() {
  if (state.route !== ROUTE) return null;
  return document.querySelector('#screenRoot .ds-pa-screen:not([data-client-file-legacy])');
}

function scan() {
  setPageTitle();
  const legacy = findProposalScreen();
  if (legacy) mountUnifiedClientFile(legacy);
}

const observer = new MutationObserver(() => window.requestAnimationFrame(scan));
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('popstate', scan);
window.addEventListener('hashchange', scan);
window.setInterval(scan, 1200);
scan();

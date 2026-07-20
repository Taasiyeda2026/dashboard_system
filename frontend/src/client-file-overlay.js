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
  approved: 'מאושרת',
  sent: 'נשלחה',
  cancelled: 'בוטלה'
};

const BOARD_COLUMNS = [
  { key: 'draft', title: 'טיוטות', statuses: ['draft'] },
  { key: 'pending', title: 'ממתינות לאישור', statuses: ['pending_approval'] },
  { key: 'returned', title: 'הוחזרו לתיקון', statuses: ['returned_for_changes'] },
  { key: 'approved', title: 'מאושרות וממתינות לשליחה', statuses: ['approved'] }
];

const TYPE_LABELS = Object.freeze({
  summer: 'קיץ',
  next_year: 'תשפ״ז',
  tour: 'סיור',
  combined: 'הצעה משולבת'
});

const TYPE_ALIASES = Object.freeze({
  summer: 'summer',
  'קיץ': 'summer',
  'קיץ תשפ״ו': 'summer',
  'פעילויות קיץ': 'summer',
  next_year: 'next_year',
  'next-year': 'next_year',
  'שנה הבאה': 'next_year',
  'תשפ״ז': 'next_year',
  'תשפ"ז': 'next_year',
  'שנת הלימודים תשפ״ז': 'next_year',
  'תוכניות תשפ״ז': 'next_year',
  tour: 'tour',
  'סיור': 'tour',
  'סיורים': 'tour',
  'סיור לימודי': 'tour',
  combined: 'combined',
  'הצעה משולבת': 'combined'
});

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

function statusLabel(value) {
  const key = normalizeStatus(value);
  return STATUS_LABELS[key] || '—';
}

function safeArray(...values) {
  return values.find(Array.isArray) || [];
}

function proposalRows(data) {
  return dedupeById(safeArray(data?.rows, data?.proposals, data?.proposalsAgreements));
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

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}

function dedupeById(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const id = text(row?.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
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

function proposalTypeKey(row = {}) {
  const raw = first(row.activity_type_group, row.proposal_group, row.document_type, row.template_key);
  if (!raw) return '';
  const alias = TYPE_ALIASES[raw] || TYPE_ALIASES[normalize(raw)] || TYPE_ALIASES[raw.toLowerCase?.() || ''];
  if (alias) return alias;
  const lowered = normalize(raw).replace(/\s+/g, '_');
  if (TYPE_LABELS[lowered]) return lowered;
  if (TYPE_ALIASES[lowered]) return TYPE_ALIASES[lowered];
  return '';
}

function proposalTypeLabel(row = {}) {
  const key = proposalTypeKey(row);
  if (key && TYPE_LABELS[key]) return TYPE_LABELS[key];
  const raw = first(row.activity_type_group, row.proposal_group, row.document_type);
  if (!raw) return '—';
  if (TYPE_LABELS[raw] || TYPE_ALIASES[raw] || /^[a-z0-9_]+$/i.test(raw)) {
    // eslint-disable-next-line no-console
    console.warn('[client-file] unknown proposal type value', raw);
    return '—';
  }
  return raw;
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
    domain: '',
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
  client.domain = first(client.domain, row.proposal_domain, row.contact_domain, row.domain);
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
    .map((client) => ({
      ...client,
      contacts: dedupeContacts(client.contacts),
      proposals: dedupeById(client.proposals)
    }))
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

function proposalDate(row) {
  return first(row.proposal_date, row.updated_at, row.created_at);
}

function proposalHasPdf(row) {
  return Boolean(first(row.final_pdf_path, row.final_pdf_file_name));
}

function versionNumber(row) {
  return Math.max(1, Number(row?.version_number) || 1);
}

function seriesId(row) {
  return first(row?.proposal_series_id);
}

/** Archive only when superseded / older version / archived_at / cancelled — NOT merely because status is sent. */
function isArchivedProposal(row, allRows = []) {
  if (text(row?.archived_at)) return true;
  if (normalizeStatus(row?.status) === 'cancelled') return true;
  const id = text(row?.id);
  if (!id) return false;
  if (allRows.some((other) => text(other?.supersedes_proposal_id) === id)) return true;
  const series = seriesId(row);
  if (series) {
    const siblings = allRows.filter((other) => seriesId(other) === series);
    const maxVersion = Math.max(0, ...siblings.map(versionNumber));
    if (versionNumber(row) < maxVersion) return true;
  }
  return false;
}

function splitCurrentAndArchive(proposals = []) {
  const rows = dedupeById(proposals);
  const current = [];
  const archive = [];
  rows.forEach((row) => {
    if (isArchivedProposal(row, rows)) archive.push(row);
    else current.push(row);
  });
  current.sort((a, b) => text(proposalDate(b)).localeCompare(text(proposalDate(a))));
  archive.sort((a, b) => text(proposalDate(b)).localeCompare(text(proposalDate(a))));
  return { current, archive };
}

function boardCardHtml(row) {
  const authority = proposalAuthority(row) || 'ללא רשות';
  const school = proposalSchool(row);
  const typeLabel = proposalTypeLabel(row);
  return `<button type="button" class="ds-cf-proposal-card" data-cf-open-proposal="${escapeHtml(text(row.id))}" data-cf-client-key="${escapeHtml(clientKey(row))}">
    <span class="ds-cf-proposal-card__client"><strong>${escapeHtml(school || authority)}</strong>${school ? `<small>${escapeHtml(authority)}</small>` : ''}</span>
    <span class="ds-cf-proposal-card__meta"><span>${escapeHtml(typeLabel)}</span><span>${escapeHtml(formatDate(proposalDate(row)))}</span></span>
    <span class="ds-cf-proposal-card__amount">${escapeHtml(formatAmount(row.total_amount))}</span>
  </button>`;
}

function boardColumnHtml(column, rows) {
  const matching = rows.filter((row) => column.statuses.includes(normalizeStatus(row.status)) && !isArchivedProposal(row, rows));
  return `<section class="ds-cf-board-column" data-cf-column="${column.key}">
    <header><span>${escapeHtml(column.title)}</span><strong>${matching.length}</strong></header>
    <div class="ds-cf-board-column__cards">${matching.length ? matching.map(boardCardHtml).join('') : '<p class="ds-cf-empty-column">אין הצעות</p>'}</div>
  </section>`;
}

function mainDashboardHtml(data) {
  const rows = proposalRows(data);
  return `<div class="ds-cf-home" data-cf-home>
    <div class="ds-cf-toolbar">
      <div class="ds-cf-search-row">
        <div class="ds-cf-search-wrap">
          <label class="sr-only" for="cf-home-search">חיפוש תיק לקוח</label>
          <input id="cf-home-search" type="search" class="ds-input" data-cf-search placeholder="חיפוש לפי רשות, בית ספר, סמל מוסד, איש קשר, נייד או דוא״ל" autocomplete="off">
          <button type="button" class="ds-cf-search-clear" data-cf-search-clear hidden aria-label="ניקוי חיפוש">×</button>
          <div class="ds-cf-search-results" data-cf-search-results hidden></div>
        </div>
        <button type="button" class="ds-btn ds-btn--ghost ds-cf-secondary-btn" data-cf-all-proposals>כל ההצעות</button>
        <button type="button" class="ds-btn ds-btn--ghost ds-cf-secondary-btn" data-cf-new-other title="חברה, עמותה או גוף שאינם בית ספר או רשות קיימים">+ לקוח אחר</button>
      </div>
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
  const hasPdf = proposalHasPdf(row);
  return `<article class="ds-cf-mini-proposal" data-cf-proposal-card="${escapeHtml(text(row.id))}">
    <button type="button" class="ds-cf-mini-proposal__main" data-cf-open-proposal="${escapeHtml(text(row.id))}">
      <span><strong>${escapeHtml(proposalTypeLabel(row))}</strong><small>${escapeHtml(formatDate(proposalDate(row)))}</small></span>
      <span class="ds-cf-mini-proposal__status">${escapeHtml(statusLabel(status))}</span>
      <strong class="ds-cf-mini-proposal__amount">${escapeHtml(formatAmount(row.total_amount))}</strong>
    </button>
    <div class="ds-cf-mini-proposal__actions">
      <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-cf-open-proposal="${escapeHtml(text(row.id))}">צפייה</button>
      ${hasPdf ? `<button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-cf-open-pdf="${escapeHtml(text(row.id))}">PDF</button>` : ''}
    </div>
  </article>`;
}

function clientFileHtml(client) {
  const { current, archive } = splitCurrentAndArchive(client.proposals);
  return `<div class="ds-cf-client" data-cf-client data-client-key="${escapeHtml(client.key)}">
    <div class="ds-cf-client-toolbar">
      <button type="button" class="ds-btn ds-btn--ghost ds-cf-close-btn" data-cf-close-client aria-label="סגירת תיק לקוח">× סגירה</button>
      <div>
        <button type="button" class="ds-btn ds-btn--ghost ds-cf-secondary-btn" data-cf-all-proposals>כל ההצעות</button>
        <button type="button" class="ds-btn ds-btn--primary" data-cf-new-proposal>+ הצעת מחיר</button>
        <button type="button" class="ds-btn ds-btn--ghost" data-cf-add-contact>+ איש קשר</button>
      </div>
    </div>
    <div class="ds-cf-client-grid">
      <aside class="ds-cf-client-profile">
        <span class="ds-cf-eyebrow">${escapeHtml(client.client_type === 'other' ? 'לקוח אחר' : 'תיק לקוח')}</span>
        <h2>${escapeHtml(client.school || client.client_name || client.authority)}</h2>
        ${client.school || client.client_type !== 'authority' ? `<p><strong>רשות:</strong> ${escapeHtml(client.authority || 'לא הוגדרה')}</p>` : ''}
        ${client.domain ? `<p><strong>תחום:</strong> ${escapeHtml(client.domain)}</p>` : ''}
        ${client.district ? `<p><strong>מחוז:</strong> ${escapeHtml(client.district)}</p>` : ''}
        ${client.semel_mosad ? `<p><strong>סמל מוסד:</strong> ${escapeHtml(client.semel_mosad)}</p>` : ''}
        <section class="ds-cf-contacts">
          <header><h3>אנשי קשר</h3><span>${client.contacts.length}</span></header>
          <div>${client.contacts.length ? client.contacts.map(contactHtml).join('') : '<p class="ds-cf-empty">לא הוגדרו אנשי קשר.</p>'}</div>
          <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-cf-add-contact>+ איש קשר</button>
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
    ...client.contacts.flatMap((contact) => [contact.contact_name, contact.contact_role, contact.role, contact.mobile, contact.phone, contact.email])
  ].map(normalize).join(' ');
  return haystack.includes(query);
}

function uniqueSorted(values) {
  return [...new Set(values.map(text).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
}

function allProposalsHtml(data, filters = {}) {
  const rows = proposalRows(data);
  const authorities = uniqueSorted(rows.map(proposalAuthority));
  const schools = uniqueSorted(rows.map(proposalSchool));
  const types = [
    { value: 'next_year', label: 'תשפ״ז' },
    { value: 'summer', label: 'קיץ' },
    { value: 'tour', label: 'סיור' }
  ];
  const statuses = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));
  const q = normalize(filters.q);
  const filtered = rows.filter((row) => {
    if (filters.authority && proposalAuthority(row) !== filters.authority) return false;
    if (filters.school && proposalSchool(row) !== filters.school) return false;
    if (filters.type && proposalTypeKey(row) !== filters.type) return false;
    if (filters.status && normalizeStatus(row.status) !== filters.status) return false;
    const date = text(proposalDate(row)).slice(0, 10);
    if (filters.from && date && date < filters.from) return false;
    if (filters.to && date && date > filters.to) return false;
    if (q) {
      const hay = [
        proposalAuthority(row),
        proposalSchool(row),
        proposalTypeLabel(row),
        statusLabel(row.status),
        row.quote_number,
        row.total_amount
      ].map(normalize).join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => text(proposalDate(b)).localeCompare(text(proposalDate(a))));

  const cards = filtered.map((row) => {
    const archived = isArchivedProposal(row, rows);
    const status = normalizeStatus(row.status);
    const statusText = archived && status !== 'cancelled' ? `${statusLabel(status)} · ארכיון` : statusLabel(status);
    return `<button type="button" class="ds-cf-all-row" data-cf-open-proposal="${escapeHtml(text(row.id))}" data-cf-client-key="${escapeHtml(clientKey(row))}">
      <span><strong>${escapeHtml(proposalAuthority(row) || '—')}</strong><small>${escapeHtml(proposalSchool(row) || '—')}</small></span>
      <span>${escapeHtml(proposalTypeLabel(row))}</span>
      <span>${escapeHtml(formatDate(proposalDate(row)))}</span>
      <span class="ds-cf-mini-proposal__status">${escapeHtml(statusText)}</span>
      <strong>${escapeHtml(formatAmount(row.total_amount))}</strong>
    </button>`;
  }).join('');

  return `<div class="ds-cf-all" data-cf-all-proposals-view>
    <div class="ds-cf-client-toolbar">
      <button type="button" class="ds-btn ds-btn--ghost ds-cf-close-btn" data-cf-close-all aria-label="חזרה">× חזרה</button>
      <h2 class="ds-cf-all-title">כל ההצעות <span>${filtered.length}</span></h2>
    </div>
    <form class="ds-cf-all-filters" data-cf-all-filters>
      <label><span class="sr-only">חיפוש</span><input class="ds-input" name="q" type="search" placeholder="חיפוש חופשי" value="${escapeHtml(filters.q || '')}"></label>
      <label><span>רשות</span><select class="ds-input" name="authority"><option value="">הכול</option>${authorities.map((v) => `<option value="${escapeHtml(v)}"${filters.authority === v ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('')}</select></label>
      <label><span>בית ספר / גוף</span><select class="ds-input" name="school"><option value="">הכול</option>${schools.map((v) => `<option value="${escapeHtml(v)}"${filters.school === v ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('')}</select></label>
      <label><span>סוג הצעה</span><select class="ds-input" name="type"><option value="">הכול</option>${types.map((t) => `<option value="${escapeHtml(t.value)}"${filters.type === t.value ? ' selected' : ''}>${escapeHtml(t.label)}</option>`).join('')}</select></label>
      <label><span>סטטוס</span><select class="ds-input" name="status"><option value="">הכול</option>${statuses.map((s) => `<option value="${escapeHtml(s.value)}"${filters.status === s.value ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}</select></label>
      <label><span>מתאריך</span><input class="ds-input" type="date" name="from" value="${escapeHtml(filters.from || '')}"></label>
      <label><span>עד תאריך</span><input class="ds-input" type="date" name="to" value="${escapeHtml(filters.to || '')}"></label>
      <button type="button" class="ds-btn ds-btn--ghost" data-cf-clear-all-filters>ניקוי סינונים</button>
    </form>
    <div class="ds-cf-all-list">${cards || '<p class="ds-cf-empty">לא נמצאו הצעות לסינון זה</p>'}</div>
  </div>`;
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
  if (pageHeader) {
    const raw = text(pageHeader.textContent);
    if (raw.includes('הצעות') || raw.includes('תיק לקוח')) pageHeader.textContent = 'תיק לקוח';
  }
  const pageSub = document.querySelector('#screenRoot .ds-page-header p, #screenRoot .ds-page-header__subtitle');
  if (pageSub && /לקוחות/.test(pageSub.textContent || '')) {
    pageSub.textContent = String(pageSub.textContent || '').replace(/\d+\s*לקוחות\s*·?\s*/g, '');
  }
}

function legacySection(root) {
  return root.querySelector(`[${LEGACY_ATTR}]`);
}

function hideNativeClientWorkspace(legacy) {
  legacy?.querySelectorAll('[data-pa-client-workspace]').forEach((node) => {
    node.hidden = true;
    node.setAttribute('aria-hidden', 'true');
  });
}

function showLegacy(root, title = 'עריכת הצעה') {
  const legacy = legacySection(root);
  if (!legacy) return;
  legacy.hidden = false;
  hideNativeClientWorkspace(legacy);
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

function findClientForProposal(root, row) {
  if (!row) return null;
  const key = clientKey(row);
  return (root._cfClients || []).find((item) => item.key === key) || null;
}

function openProposalInLegacy(root, row, { preferClient = true } = {}) {
  if (!row) return;
  if (preferClient) {
    const client = findClientForProposal(root, row);
    if (client) root._cfActiveClientKey = client.key;
  }
  showLegacy(root, proposalTypeLabel(row) === '—' ? (first(row.quote_number) ? `הצעה ${row.quote_number}` : 'הצעת מחיר') : proposalTypeLabel(row));
  const legacy = legacySection(root);
  hideNativeClientWorkspace(legacy);
  const status = normalizeStatus(row.status);
  const tab = legacy?.querySelector(`[data-pa-tab="${status === 'sent' ? 'sent' : 'records'}"]`);
  tab?.click();
  window.setTimeout(() => {
    const id = text(row.id);
    const rowEl = legacy?.querySelector(`[data-pa-row-id="${cssEscape(id)}"]`);
    if (rowEl) {
      rowEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      rowEl.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      return;
    }
    const search = legacy?.querySelector('[data-pa-search]');
    const query = first(row.quote_number, proposalSchool(row), proposalAuthority(row));
    if (search) {
      search.value = query;
      dispatchInput(search);
    }
    window.setTimeout(() => {
      const fallback = legacy?.querySelector(`[data-pa-row-id="${cssEscape(id)}"]`);
      fallback?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, 200);
  }, 80);
}

function openProposalPdf(root, row) {
  openProposalInLegacy(root, row);
  window.setTimeout(() => {
    const legacy = legacySection(root);
    const pdfBtn = legacy?.querySelector(`[data-pa-view-final-pdf="${cssEscape(text(row.id))}"]`)
      || legacy?.querySelector('#pa-view-final-pdf-btn');
    pdfBtn?.click();
  }, 220);
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
  hideNativeClientWorkspace(legacy);
  legacy?.querySelector('[data-pa-tab="new"]')?.click();
  if (!client) {
    // Mark as "other" client path when no existing school/authority was selected.
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const form = legacy?.querySelector('[data-pa-form]');
      if (form) {
        window.clearInterval(timer);
        const otherRadio = form.querySelector('input[name="client_type_selector"][value="other"]');
        if (otherRadio) {
          otherRadio.checked = true;
          otherRadio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else if (attempts > 20) {
        window.clearInterval(timer);
      }
    }, 100);
    return;
  }
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
    [${ROOT_ATTR}]{direction:rtl}
    .ds-cf-legacy[hidden]{display:none!important}
    [${ROOT_ATTR}] [data-pa-client-workspace]{display:none!important}
    [${ROOT_ATTR}].is-legacy-open .ds-pa-legacy-list{display:block!important}
    .ds-cf-workspace-status{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;margin-bottom:10px;border:1px solid #cbd5e1;border-radius:14px;background:#f8fafc}
    .ds-cf-workspace-status[hidden]{display:none}
    .ds-cf-toolbar{margin:0 auto 18px;max-width:1100px}
    .ds-cf-search-row{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap}
    .ds-cf-search-wrap{position:relative;flex:1 1 520px;min-width:min(100%,280px)}
    .ds-cf-search-wrap input{width:100%;min-height:48px;padding-inline-start:18px;padding-inline-end:42px;border:2px solid #0797bf;border-radius:999px}
    .ds-cf-search-wrap input:focus{outline:3px solid rgba(7,151,191,.28);outline-offset:2px}
    .ds-cf-search-clear{position:absolute;left:8px;top:50%;transform:translateY(-50%);border:0;background:transparent;font-size:24px;color:#64748b;cursor:pointer}
    .ds-cf-search-clear[hidden]{display:none}
    .ds-cf-secondary-btn{white-space:nowrap;font-weight:600}
    .ds-cf-search-results{position:absolute;z-index:80;top:54px;right:0;left:0;max-height:340px;overflow:auto;border:1px solid #cbd5e1;border-radius:14px;background:white;box-shadow:0 18px 42px rgba(15,23,42,.16);padding:6px}
    .ds-cf-search-results button{display:flex;width:100%;flex-direction:column;align-items:flex-start;border:0;border-radius:10px;background:white;padding:10px 12px;text-align:right;cursor:pointer}
    .ds-cf-search-results button:hover,.ds-cf-search-results button:focus-visible{background:#eefaff;outline:2px solid #0797bf;outline-offset:1px}
    .ds-cf-search-results span{font-size:.78rem;color:#64748b;margin-top:2px}
    .ds-cf-board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:start}
    .ds-cf-board-column{min-height:0;border:1px solid #dbe4ee;border-radius:16px;background:#f8fafc;overflow:hidden}
    .ds-cf-board-column>header{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;border-bottom:1px solid #e2e8f0;background:white;font-weight:700}
    .ds-cf-board-column>header strong,.ds-cf-section-title span,.ds-cf-contacts header span,.ds-cf-all-title span{display:inline-flex;min-width:25px;height:25px;align-items:center;justify-content:center;border-radius:999px;background:#e2e8f0;color:#475569;font-size:.76rem}
    .ds-cf-board-column__cards{display:grid;gap:8px;padding:9px}
    .ds-cf-empty-column,.ds-cf-empty{margin:8px 4px;color:#94a3b8;font-size:.84rem;text-align:center}
    .ds-cf-proposal-card{display:grid;gap:7px;width:100%;border:1px solid #dbe4ee;border-radius:12px;background:white;padding:10px;text-align:right;cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.04);transition:border-color .15s,box-shadow .15s,transform .15s}
    .ds-cf-proposal-card:hover{border-color:#0797bf;box-shadow:0 8px 20px rgba(7,151,191,.14);transform:translateY(-1px)}
    .ds-cf-proposal-card:focus-visible{outline:3px solid rgba(7,151,191,.35);outline-offset:2px}
    .ds-cf-proposal-card__client{display:flex;flex-direction:column}
    .ds-cf-proposal-card__client small{color:#64748b;margin-top:2px}
    .ds-cf-proposal-card__meta{display:flex;justify-content:space-between;gap:8px;color:#64748b;font-size:.75rem}
    .ds-cf-proposal-card__amount{font-size:.9rem;color:#0f766e}
    .ds-cf-client-toolbar{display:flex;justify-content:space-between;gap:12px;margin-bottom:12px;align-items:center;flex-wrap:wrap}
    .ds-cf-client-toolbar>div{display:flex;gap:8px;flex-wrap:wrap}
    .ds-cf-close-btn{color:#b91c1c}
    .ds-cf-client-grid{display:grid;grid-template-columns:minmax(270px,36%) minmax(0,1fr);gap:16px}
    .ds-cf-client-profile,.ds-cf-proposals-panel{border:1px solid #dbe4ee;border-radius:18px;background:white;padding:18px}
    .ds-cf-client-profile h2{margin:4px 0 12px;font-size:1.45rem}
    .ds-cf-client-profile>p{margin:5px 0;color:#475569}
    .ds-cf-eyebrow{font-size:.74rem;font-weight:700;color:#0369a1}
    .ds-cf-contacts{margin-top:22px}
    .ds-cf-contacts header,.ds-cf-section-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
    .ds-cf-contacts h3,.ds-cf-section-title h3{margin:0;font-size:1rem}
    .ds-cf-contact-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 0;border-bottom:1px solid #eef2f7}
    .ds-cf-contact-row__main{display:flex;min-width:0;flex-direction:column;gap:2px}
    .ds-cf-contact-row__main strong{font-size:.85rem}
    .ds-cf-contact-row__main span{color:#64748b;font-size:.76rem;overflow-wrap:anywhere}
    .ds-cf-icon-btn{border:0;background:#f1f5f9;border-radius:8px;padding:5px 8px;cursor:pointer}
    .ds-cf-icon-btn:hover,.ds-cf-icon-btn:focus-visible{background:#e2e8f0}
    .ds-cf-proposals-panel{display:grid;gap:20px}
    .ds-cf-proposals-list{display:grid;gap:8px}
    .ds-cf-mini-proposal{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border:1px solid #dbe4ee;border-radius:13px;background:#fff;padding:8px 10px}
    .ds-cf-mini-proposal__main{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;width:100%;border:0;background:transparent;padding:2px;text-align:right;cursor:pointer}
    .ds-cf-mini-proposal__main:hover,.ds-cf-mini-proposal__main:focus-visible{background:#f8fbff;border-radius:10px;outline:2px solid #0797bf}
    .ds-cf-mini-proposal__main>span:first-child{display:flex;min-width:0;flex-direction:column}
    .ds-cf-mini-proposal small{color:#64748b;margin-top:2px}
    .ds-cf-mini-proposal__status{border-radius:999px;background:#eff6ff;color:#1d4ed8;padding:4px 8px;font-size:.72rem}
    .ds-cf-mini-proposal__amount{color:#0f766e;white-space:nowrap}
    .ds-cf-mini-proposal__actions{display:flex;gap:4px;flex-wrap:wrap}
    .ds-cf-archive{border-top:1px solid #e2e8f0;padding-top:16px}
    .ds-cf-archive summary{cursor:pointer;font-weight:700;margin-bottom:10px}
    .ds-cf-all-title{margin:0;font-size:1.15rem;display:flex;align-items:center;gap:8px}
    .ds-cf-all-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;padding:12px;border:1px solid #dbe4ee;border-radius:14px;background:#f8fafc}
    .ds-cf-all-filters label{display:grid;gap:4px;font-size:.78rem;color:#475569;font-weight:600}
    .ds-cf-all-list{display:grid;gap:8px}
    .ds-cf-all-row{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(70px,.7fr) minmax(70px,.7fr) auto auto;gap:10px;align-items:center;width:100%;border:1px solid #dbe4ee;border-radius:12px;background:#fff;padding:10px 12px;text-align:right;cursor:pointer}
    .ds-cf-all-row:hover,.ds-cf-all-row:focus-visible{border-color:#0797bf;background:#f0fbff;outline:2px solid rgba(7,151,191,.25)}
    .ds-cf-all-row span:first-child{display:flex;flex-direction:column;min-width:0}
    .ds-cf-all-row small{color:#64748b;margin-top:2px}
    .ds-cf-modal{position:fixed;z-index:1200;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.45);padding:20px}
    .ds-cf-modal__panel{width:min(480px,100%);display:grid;gap:12px;border-radius:18px;background:white;padding:18px;box-shadow:0 24px 70px rgba(15,23,42,.25)}
    .ds-cf-modal__panel header,.ds-cf-modal__panel footer{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .ds-cf-modal__panel header h3{margin:0}
    .ds-cf-modal__panel header button{border:0;background:transparent;font-size:26px;cursor:pointer}
    .ds-cf-modal__panel label{display:grid;gap:5px}
    .ds-cf-modal__panel label span{font-size:.8rem;font-weight:700;color:#475569}
    .ds-cf-form-error{min-height:18px;margin:0;color:#dc2626;font-size:.8rem}
    .ds-cf-modal__panel footer{justify-content:flex-end}
    .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    @media(max-width:1100px){.ds-cf-board{grid-template-columns:repeat(2,minmax(0,1fr))}.ds-cf-all-row{grid-template-columns:1fr 1fr}}
    @media(max-width:760px){.ds-cf-search-row,.ds-cf-client-toolbar{flex-direction:column;align-items:stretch}.ds-cf-search-row>button,.ds-cf-client-toolbar>div,.ds-cf-client-toolbar .ds-btn{width:100%}.ds-cf-board{grid-template-columns:1fr}.ds-cf-client-grid{grid-template-columns:1fr}.ds-cf-mini-proposal,.ds-cf-all-row{grid-template-columns:1fr}.ds-cf-mini-proposal__main{grid-template-columns:1fr auto}}
  </style>`;
}

function renderClient(root, client) {
  root._cfActiveClientKey = client.key;
  root._cfView = 'client';
  root.querySelector('[data-cf-content]').innerHTML = clientFileHtml(client);
}

function renderHome(root, data) {
  root._cfActiveClientKey = '';
  root._cfView = 'home';
  root.querySelector('[data-cf-content]').innerHTML = mainDashboardHtml(data);
}

function renderAllProposals(root, data, filters = {}) {
  root._cfView = 'all';
  root._cfAllFilters = filters;
  root.querySelector('[data-cf-content]').innerHTML = allProposalsHtml(data, filters);
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
  else if (root._cfView === 'all') renderAllProposals(root, data, root._cfAllFilters || {});
  else renderHome(root, data);
}

function readAllFilters(form) {
  if (!form) return {};
  const data = new FormData(form);
  return {
    q: text(data.get('q')),
    authority: text(data.get('authority')),
    school: text(data.get('school')),
    type: text(data.get('type')),
    status: text(data.get('status')),
    from: text(data.get('from')),
    to: text(data.get('to'))
  };
}

function bindWorkspace(root) {
  root.addEventListener('input', (event) => {
    const input = event.target.closest('[data-cf-search]');
    if (input) {
      const query = normalize(input.value);
      const host = root.querySelector('[data-cf-search-results]');
      const clearBtn = root.querySelector('[data-cf-search-clear]');
      if (clearBtn) clearBtn.hidden = !text(input.value);
      if (!host) return;
      if (!query) {
        host.hidden = true;
        host.innerHTML = '';
        return;
      }
      const matches = (root._cfClients || []).filter((client) => searchMatches(client, query)).slice(0, 12);
      host.innerHTML = matches.length ? matches.map(searchResultHtml).join('') : '<p class="ds-cf-empty">לא נמצאו לקוחות.</p>';
      host.hidden = false;
      return;
    }
    const allForm = event.target.closest('[data-cf-all-filters]');
    if (allForm) {
      renderAllProposals(root, root._cfData || {}, readAllFilters(allForm));
    }
  });

  root.addEventListener('change', (event) => {
    const allForm = event.target.closest('[data-cf-all-filters]');
    if (!allForm) return;
    renderAllProposals(root, root._cfData || {}, readAllFilters(allForm));
  });

  root.addEventListener('click', (event) => {
    const clear = event.target.closest('[data-cf-search-clear]');
    if (clear) {
      const input = root.querySelector('[data-cf-search]');
      if (input) input.value = '';
      clear.hidden = true;
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
    const closeAll = event.target.closest('[data-cf-close-all]');
    if (closeAll) {
      const client = root._cfActiveClientKey
        ? (root._cfClients || []).find((item) => item.key === root._cfActiveClientKey)
        : null;
      if (client) renderClient(root, client);
      else renderHome(root, root._cfData || {});
      return;
    }
    const allBtn = event.target.closest('[data-cf-all-proposals]');
    if (allBtn) {
      renderAllProposals(root, root._cfData || {}, {});
      return;
    }
    const clearAllFilters = event.target.closest('[data-cf-clear-all-filters]');
    if (clearAllFilters) {
      renderAllProposals(root, root._cfData || {}, {});
      return;
    }
    const back = event.target.closest('[data-cf-back-workspace]');
    if (back) {
      showWorkspace(root);
      const preferred = root._cfActiveClientKey;
      if (preferred) {
        const client = (root._cfClients || []).find((item) => item.key === preferred);
        if (client) renderClient(root, client);
      }
      return;
    }
    const pdfButton = event.target.closest('[data-cf-open-pdf]');
    if (pdfButton) {
      event.preventDefault();
      event.stopPropagation();
      const row = proposalRows(root._cfData).find((item) => text(item.id) === pdfButton.dataset.cfOpenPdf);
      if (row) openProposalPdf(root, row);
      return;
    }
    const proposalButton = event.target.closest('[data-cf-open-proposal]');
    if (proposalButton) {
      event.preventDefault();
      const row = proposalRows(root._cfData).find((item) => text(item.id) === proposalButton.dataset.cfOpenProposal);
      if (row) {
        const clientKeyHint = text(proposalButton.dataset.cfClientKey);
        if (clientKeyHint) root._cfActiveClientKey = clientKeyHint;
        openProposalInLegacy(root, row);
      }
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
  hideNativeClientWorkspace(legacy);
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

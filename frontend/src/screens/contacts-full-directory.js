import { supabase, waitForSupabaseAuthSession } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';

const PAGE_SIZE = 1000;
const CONTACTS_VIEW_TABLE = 'contacts_directory_view';
const CONTACTS_FALLBACK_TABLE = 'contacts_schools';
const AUTHORITIES_TABLE = 'authorities';
const SCHOOLS_TABLE = 'schools';
const STYLE_ID = 'contacts-full-directory-style';
const ENHANCED_ATTR = 'data-contacts-full-directory';

let directoryPromise = null;
let lastSearch = '';
let isRendering = false;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function key(value) {
  return text(value).toLowerCase().normalize('NFKC').replace(/[\u05F3\u05F4'"`´”“„״׳]/g, '').replace(/[\u2010-\u2015\u2212\-_/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isActive(value) {
  const raw = text(value).toLowerCase();
  return raw !== 'no' && raw !== '0' && raw !== 'false';
}

function hasContact(row) {
  return Boolean(text(row?.contact_name) || text(row?.mobile || row?.phone) || text(row?.email));
}

function contactKey(row) {
  return [
    key(row?.authority_id || row?.authority_name || row?.authority),
    key(row?.school_id || row?.semel_mosad || row?.school_name || row?.school),
    key(row?.client_type),
    key(row?.client_name),
    key(row?.contact_name),
    key(row?.mobile || row?.phone),
    key(row?.email)
  ].join('|');
}

async function readAll(table, columns, orderColumn) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
    if (orderColumn) query = query.order(orderColumn, { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    const chunk = Array.isArray(data) ? data : [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
  }
  return rows;
}

async function readContactsRows() {
  try {
    return await readAll(CONTACTS_VIEW_TABLE, '*', 'authority_name');
  } catch (error) {
    console.warn('[contacts-full-directory] contacts_directory_view failed, using contacts_schools fallback', error);
    return readAll(CONTACTS_FALLBACK_TABLE, '*', 'authority');
  }
}

async function loadDirectory() {
  if (!supabase) throw new Error('supabase_not_available');
  await waitForSupabaseAuthSession({ timeoutMs: 8000 }).catch(() => null);

  const [authoritiesRaw, schoolsRaw, contactsRaw] = await Promise.all([
    readAll(AUTHORITIES_TABLE, 'id,authority_code,authority_name,authority_type,hp_number,long_name,district,active', 'authority_name'),
    readAll(SCHOOLS_TABLE, 'id,semel_mosad,school_name,authority,authority_id,city,district,sector,principal_name,school_phone,institution_address,active', 'authority'),
    readContactsRows()
  ]);

  const authorities = authoritiesRaw
    .filter((row) => text(row.authority_name))
    .map((row) => ({
      id: text(row.id),
      authority_code: text(row.authority_code),
      authority_name: text(row.authority_name),
      authority_type: text(row.authority_type),
      district: text(row.district),
      active: text(row.active) || 'yes'
    }))
    .sort((a, b) => a.authority_name.localeCompare(b.authority_name, 'he'));

  const authorityById = new Map(authorities.map((row) => [text(row.id), row]));
  const authorityByName = new Map(authorities.map((row) => [key(row.authority_name), row]));

  const buckets = new Map();
  const ensureBucket = (authority) => {
    const name = text(authority?.authority_name || authority?.authority || authority?.client_name) || '—';
    const id = text(authority?.id || authority?.authority_id);
    const bucketKey = id || key(name);
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, {
        key: bucketKey,
        authority_id: id,
        authority_name: name,
        authority_code: text(authority?.authority_code),
        schools: new Map(),
        authorityContacts: [],
        otherGroups: new Map(),
        _contactKeys: new Set()
      });
    }
    const bucket = buckets.get(bucketKey);
    if (!bucket.authority_code && authority?.authority_code) bucket.authority_code = text(authority.authority_code);
    if (!bucket.authority_id && id) bucket.authority_id = id;
    return bucket;
  };

  authorities.forEach((authority) => ensureBucket(authority));

  const resolveAuthority = (row = {}) => {
    const authorityId = text(row.authority_id);
    const authorityName = text(row.authority_name || row.authority || row.client_name);
    return (authorityId && authorityById.get(authorityId)) || authorityByName.get(key(authorityName)) || {
      id: authorityId,
      authority_name: authorityName || '—',
      authority_code: text(row.authority_code)
    };
  };

  const schools = schoolsRaw
    .filter((row) => text(row.school_name) && isActive(row.active))
    .map((row) => {
      const authority = resolveAuthority(row);
      return {
        id: text(row.id),
        semel_mosad: text(row.semel_mosad),
        school_name: text(row.school_name),
        authority_id: text(row.authority_id || authority.id),
        authority_name: text(row.authority || authority.authority_name),
        city: text(row.city),
        district: text(row.district),
        sector: text(row.sector),
        contacts: []
      };
    })
    .sort((a, b) => a.school_name.localeCompare(b.school_name, 'he'));

  const schoolById = new Map();
  const schoolBySemel = new Map();
  const schoolByAuthorityName = new Map();

  schools.forEach((school) => {
    const authority = resolveAuthority({ authority_id: school.authority_id, authority: school.authority_name });
    const bucket = ensureBucket(authority);
    const schoolKey = school.id || school.semel_mosad || `${key(bucket.authority_name)}|${key(school.school_name)}`;
    if (!bucket.schools.has(schoolKey)) bucket.schools.set(schoolKey, { ...school, contacts: [] });
    const storedSchool = bucket.schools.get(schoolKey);
    if (school.id) schoolById.set(school.id, storedSchool);
    if (school.semel_mosad) schoolBySemel.set(school.semel_mosad, storedSchool);
    schoolByAuthorityName.set(`${key(bucket.authority_name)}|${key(school.school_name)}`, storedSchool);
    schoolByAuthorityName.set(`${key(school.authority_name)}|${key(school.school_name)}`, storedSchool);
  });

  const normalizeContact = (row) => {
    const authority = resolveAuthority(row);
    return {
      id: text(row.id),
      client_type: text(row.client_type || (text(row.school_name || row.school) ? 'school' : 'authority')),
      client_name: text(row.client_name),
      authority_id: text(row.authority_id || authority.id),
      authority_name: text(row.authority_name || row.authority || authority.authority_name),
      authority_code: text(row.authority_code || authority.authority_code),
      school_id: text(row.school_id),
      semel_mosad: text(row.semel_mosad),
      school_name: text(row.school_name || row.school),
      contact_name: text(row.contact_name),
      contact_role: text(row.contact_role),
      phone: text(row.phone),
      mobile: text(row.mobile),
      email: text(row.email),
      notes: text(row.notes),
      active: text(row.active) || 'yes',
      _raw: row
    };
  };

  contactsRaw
    .map(normalizeContact)
    .filter((row) => hasContact(row) && isActive(row.active))
    .forEach((contact) => {
      const bucket = ensureBucket(resolveAuthority(contact));
      const cKey = contactKey(contact);
      if (bucket._contactKeys.has(cKey)) return;
      bucket._contactKeys.add(cKey);
      const type = key(contact.client_type);

      if (type === 'school' || contact.school_id || contact.semel_mosad || contact.school_name) {
        const school = (contact.school_id && schoolById.get(contact.school_id))
          || (contact.semel_mosad && schoolBySemel.get(contact.semel_mosad))
          || schoolByAuthorityName.get(`${key(bucket.authority_name)}|${key(contact.school_name)}`)
          || schoolByAuthorityName.get(`${key(contact.authority_name)}|${key(contact.school_name)}`);
        if (school) {
          school.contacts.push(contact);
          return;
        }
      }

      if (type === 'authority' || !contact.client_name || key(contact.client_name) === key(bucket.authority_name)) {
        bucket.authorityContacts.push(contact);
        return;
      }

      const groupName = contact.client_name || contact.school_name || 'אחר';
      const groupKey = key(groupName);
      if (!bucket.otherGroups.has(groupKey)) bucket.otherGroups.set(groupKey, { name: groupName, contacts: [] });
      bucket.otherGroups.get(groupKey).contacts.push(contact);
    });

  const bucketsList = [...buckets.values()].sort((a, b) => a.authority_name.localeCompare(b.authority_name, 'he'));
  return {
    authorities: bucketsList,
    authorityCount: authorities.length,
    schoolCount: schools.length,
    contactCount: bucketsList.reduce((sum, bucket) => sum + bucket._contactKeys.size, 0)
  };
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .contacts-full-toolbar{display:flex;align-items:center;gap:8px;width:100%}
    .contacts-full-search{width:min(560px,100%);height:38px;border:1px solid #d8e2ea;border-radius:12px;padding:0 14px;background:#fff;font:inherit;color:#0f172a;box-shadow:0 1px 2px rgba(15,23,42,.04)}
    .contacts-full-search:focus{outline:2px solid rgba(2,146,183,.18);border-color:var(--ds-accent,#0292b7)}
    .contacts-full-summary{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 14px;color:#334155;font-size:14px}
    .contacts-full-summary__chip{display:inline-flex;align-items:center;gap:4px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:999px;padding:7px 12px;font-weight:700;color:#0f172a}
    .contacts-full-list{display:grid;gap:10px}
    .cfd-authority{border:1px solid #dbe6ee;border-radius:16px;background:#fff;box-shadow:0 6px 18px rgba(15,23,42,.045);overflow:hidden}
    .cfd-authority[open]{border-color:rgba(2,146,183,.34);box-shadow:0 8px 22px rgba(2,146,183,.08)}
    .cfd-authority__head{cursor:pointer;list-style:none;display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;padding:13px 16px;background:#fff}
    .cfd-authority[open]>.cfd-authority__head{background:#f0fbff;border-bottom:1px solid #dbeafe}
    .cfd-authority__head::-webkit-details-marker,.cfd-card__head::-webkit-details-marker{display:none}
    .cfd-chevron{font-size:22px;line-height:1;color:#64748b;transform:rotate(180deg);transition:transform .18s ease}
    details[open]>.cfd-authority__head .cfd-chevron,details[open]>.cfd-card__head .cfd-chevron{transform:rotate(270deg)}
    .cfd-authority__name{font-weight:800;color:#0f172a;font-size:16px}
    .cfd-authority__meta{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;color:#475569;font-size:12px}
    .cfd-pill{background:#f8fafc;border:1px solid #e2e8f0;border-radius:999px;padding:4px 8px;white-space:nowrap}
    .cfd-authority__body{padding:12px 14px 16px;display:grid;gap:12px;background:#fbfdff}
    .cfd-group{border-radius:14px;border:1px solid #e2e8f0;background:#fff;overflow:hidden}
    .cfd-group__title{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;font-weight:800;color:#0f172a;background:#f8fafc;border-bottom:1px solid #e2e8f0}
    .cfd-group--schools .cfd-group__title{background:#eef9ff}
    .cfd-group--authority .cfd-group__title{background:#edfff8}
    .cfd-group--other .cfd-group__title{background:#fff8e8}
    .cfd-group__count{font-size:12px;color:#475569;background:#fff;border:1px solid #dbe3ea;border-radius:999px;padding:3px 8px}
    .cfd-items{display:grid;gap:8px;padding:10px}
    .cfd-card{border:1px solid #e5edf3;border-radius:12px;background:#fff;overflow:hidden}
    .cfd-card__head{cursor:pointer;list-style:none;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;padding:10px 12px}
    .cfd-card__name{font-weight:700;color:#1e293b;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cfd-card__meta{font-size:12px;color:#64748b;white-space:nowrap}
    .cfd-card__body{border-top:1px solid #e5edf3;padding:10px;background:#fcfdff}
    .cfd-contact-grid{display:grid;gap:8px}
    .cfd-contact{display:grid;grid-template-columns:minmax(150px,1.2fr) minmax(130px,1fr) minmax(110px,.8fr) minmax(160px,1.2fr);gap:10px;align-items:center;border:1px solid #e8eef5;border-radius:12px;background:#fff;padding:9px 10px;font-size:13px}
    .cfd-contact__name{font-weight:800;color:#0f172a}
    .cfd-contact__muted{color:#64748b;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cfd-contact a{color:var(--ds-accent,#0292b7);text-decoration:none;font-weight:600}
    .cfd-empty{color:#94a3b8;font-size:13px;padding:8px 2px}
    .cfd-match{background:#fff3b0;border-radius:4px;padding-inline:2px}
    @media (max-width: 760px){.cfd-authority__head,.cfd-card__head{grid-template-columns:auto 1fr}.cfd-authority__meta,.cfd-card__meta{grid-column:2}.cfd-contact{grid-template-columns:1fr}.contacts-full-search{width:100%}}
  `;
  document.head.appendChild(style);
}

function highlight(value, search) {
  const safe = escapeHtml(text(value) || '—');
  const q = text(search);
  if (!q) return safe;
  const lower = text(value).toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return safe;
  const original = text(value);
  return `${escapeHtml(original.slice(0, idx))}<mark class="cfd-match">${escapeHtml(original.slice(idx, idx + q.length))}</mark>${escapeHtml(original.slice(idx + q.length))}`;
}

function contactSearchText(contact) {
  return [contact.contact_name, contact.contact_role, contact.phone, contact.mobile, contact.email, contact.notes].map(text).join(' ');
}

function schoolSearchText(school) {
  return [school.school_name, school.semel_mosad, school.city, school.district, ...school.contacts.map(contactSearchText)].map(text).join(' ');
}

function groupSearchText(group) {
  return [group.name, ...group.contacts.map(contactSearchText)].map(text).join(' ');
}

function matches(value, search) {
  if (!search) return true;
  return key(value).includes(key(search));
}

function contactHtml(contact, search) {
  const phoneValue = contact.mobile || contact.phone;
  const phoneHtml = phoneValue ? `<a href="tel:${escapeHtml(phoneValue)}" dir="ltr">${highlight(phoneValue, search)}</a>` : '<span class="cfd-contact__muted">—</span>';
  const emailHtml = contact.email ? `<a href="mailto:${escapeHtml(contact.email)}" dir="ltr">${highlight(contact.email, search)}</a>` : '<span class="cfd-contact__muted">—</span>';
  return `<article class="cfd-contact">
    <div class="cfd-contact__name">${highlight(contact.contact_name || '—', search)}</div>
    <div class="cfd-contact__muted">${highlight(contact.contact_role || '—', search)}</div>
    <div>${phoneHtml}</div>
    <div>${emailHtml}</div>
  </article>`;
}

function schoolCardHtml(school, search) {
  const shouldOpen = Boolean(search && matches(schoolSearchText(school), search));
  const contactCount = school.contacts.length;
  const contactsHtml = contactCount
    ? `<div class="cfd-contact-grid">${school.contacts.map((contact) => contactHtml(contact, search)).join('')}</div>`
    : '<div class="cfd-empty">אין אנשי קשר משויכים</div>';
  const meta = [
    school.semel_mosad ? `סמל מוסד ${escapeHtml(school.semel_mosad)}` : '',
    contactCount ? `${contactCount} אנשי קשר` : 'אין אנשי קשר'
  ].filter(Boolean).join(' · ');
  return `<details class="cfd-card"${shouldOpen ? ' open' : ''}>
    <summary class="cfd-card__head">
      <span class="cfd-chevron" aria-hidden="true">›</span>
      <span class="cfd-card__name">${highlight(school.school_name, search)}</span>
      <span class="cfd-card__meta">${meta}</span>
    </summary>
    <div class="cfd-card__body">${contactsHtml}</div>
  </details>`;
}

function otherCardHtml(group, search) {
  const shouldOpen = Boolean(search && matches(groupSearchText(group), search));
  return `<details class="cfd-card"${shouldOpen ? ' open' : ''}>
    <summary class="cfd-card__head">
      <span class="cfd-chevron" aria-hidden="true">›</span>
      <span class="cfd-card__name">${highlight(group.name, search)}</span>
      <span class="cfd-card__meta">${group.contacts.length} אנשי קשר</span>
    </summary>
    <div class="cfd-card__body"><div class="cfd-contact-grid">${group.contacts.map((contact) => contactHtml(contact, search)).join('')}</div></div>
  </details>`;
}

function authorityHtml(bucket, search) {
  const schools = [...bucket.schools.values()].sort((a, b) => a.school_name.localeCompare(b.school_name, 'he'));
  const otherGroups = [...bucket.otherGroups.values()].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const authoritySearch = [
    bucket.authority_name,
    bucket.authority_code,
    ...schools.map(schoolSearchText),
    ...bucket.authorityContacts.map(contactSearchText),
    ...otherGroups.map(groupSearchText)
  ].join(' ');
  if (search && !matches(authoritySearch, search)) return '';

  const shouldOpen = Boolean(search);
  const schoolsHtml = schools.length ? `<section class="cfd-group cfd-group--schools">
    <div class="cfd-group__title"><span>בתי ספר / מסגרות</span><span class="cfd-group__count">${schools.length}</span></div>
    <div class="cfd-items">${schools.map((school) => schoolCardHtml(school, search)).join('')}</div>
  </section>` : '';

  const authorityContactsHtml = bucket.authorityContacts.length ? `<section class="cfd-group cfd-group--authority">
    <div class="cfd-group__title"><span>רשות</span><span class="cfd-group__count">${bucket.authorityContacts.length}</span></div>
    <div class="cfd-items"><div class="cfd-contact-grid">${bucket.authorityContacts.map((contact) => contactHtml(contact, search)).join('')}</div></div>
  </section>` : '';

  const otherHtml = otherGroups.length ? `<section class="cfd-group cfd-group--other">
    <div class="cfd-group__title"><span>אחר</span><span class="cfd-group__count">${otherGroups.length}</span></div>
    <div class="cfd-items">${otherGroups.map((group) => otherCardHtml(group, search)).join('')}</div>
  </section>` : '';

  const meta = [
    `${schools.length} בתי ספר / מסגרות`,
    bucket.authorityContacts.length ? `${bucket.authorityContacts.length} אנשי קשר ברשות` : '',
    otherGroups.length ? `${otherGroups.length} אחרים` : '',
    bucket._contactKeys.size ? `${bucket._contactKeys.size} אנשי קשר` : ''
  ].filter(Boolean);

  return `<details class="cfd-authority"${shouldOpen ? ' open' : ''}>
    <summary class="cfd-authority__head">
      <span class="cfd-chevron" aria-hidden="true">›</span>
      <span class="cfd-authority__name">${highlight(bucket.authority_name, search)}</span>
      <span class="cfd-authority__meta">${meta.map((item) => `<span class="cfd-pill">${escapeHtml(item)}</span>`).join('')}</span>
    </summary>
    <div class="cfd-authority__body">${schoolsHtml}${authorityContactsHtml}${otherHtml || ''}</div>
  </details>`;
}

function renderDirectory(listWrap, data) {
  const search = text(lastSearch);
  const listHtml = data.authorities.map((bucket) => authorityHtml(bucket, search)).filter(Boolean).join('');
  const emptyHtml = '<div class="cfd-empty">לא נמצאו תוצאות לחיפוש</div>';
  listWrap.innerHTML = `<div class="contacts-full-summary" dir="rtl">
    <span class="contacts-full-summary__chip"><strong>${data.authorityCount}</strong> רשויות</span>
    <span class="contacts-full-summary__chip"><strong>${data.schoolCount}</strong> בתי ספר / מסגרות</span>
  </div>
  <div class="contacts-full-list" dir="rtl">${listHtml || emptyHtml}</div>`;
  listWrap.setAttribute(ENHANCED_ATTR, 'yes');
}

function isSchoolContactsTabActive(root) {
  const active = root.querySelector('[data-contacts-tab].is-active');
  return !active || active.getAttribute('data-contacts-tab') === 'school' || /לקוחות|רשויות|בתי ספר/.test(active.textContent || '');
}

function patchToolbar(root, onSearch) {
  const toolbarRow = root.querySelector('.contacts-toolbar-row');
  if (!toolbarRow) return;
  const existingToolbar = toolbarRow.querySelector('[data-local-filters]');
  if (existingToolbar && existingToolbar.getAttribute('data-full-directory-toolbar') !== 'yes') {
    existingToolbar.outerHTML = `<div class="contacts-full-toolbar" data-full-directory-toolbar="yes" dir="rtl">
      <input type="search" class="contacts-full-search" data-full-directory-search value="${escapeHtml(lastSearch)}" placeholder="חיפוש לפי רשות / בית ספר / גוף / איש קשר / תפקיד / טלפון / מייל…" />
    </div>`;
  }
  const input = toolbarRow.querySelector('[data-full-directory-search]');
  if (input && input.dataset.bound !== 'yes') {
    input.dataset.bound = 'yes';
    input.addEventListener('input', () => {
      lastSearch = input.value || '';
      onSearch();
    });
  }
}

async function enhanceContactsDirectory() {
  if (isRendering) return;
  const root = document.getElementById('app');
  if (!root) return;
  const listWrap = root.querySelector('.contacts-list-wrap');
  if (!listWrap || !root.querySelector('.contacts-tab-bar')) return;
  if (!isSchoolContactsTabActive(root)) return;

  ensureStyle();
  patchToolbar(root, () => {
    if (directoryPromise) {
      directoryPromise.then((data) => renderDirectory(listWrap, data)).catch(() => {});
    }
  });

  if (!directoryPromise) directoryPromise = loadDirectory();
  if (listWrap.getAttribute(ENHANCED_ATTR) !== 'yes') {
    listWrap.innerHTML = '<div class="ds-empty" dir="rtl">טוען את מאגר אנשי הקשר המלא…</div>';
  }

  try {
    isRendering = true;
    const data = await directoryPromise;
    renderDirectory(listWrap, data);
  } catch (error) {
    console.error('[contacts-full-directory] failed', error);
    listWrap.innerHTML = '<div class="ds-empty" dir="rtl">לא ניתן היה לטעון את מאגר אנשי הקשר המלא.</div>';
  } finally {
    isRendering = false;
  }
}

function scheduleEnhance() {
  if (scheduleEnhance._timer) window.clearTimeout(scheduleEnhance._timer);
  scheduleEnhance._timer = window.setTimeout(() => {
    enhanceContactsDirectory().catch(() => {});
  }, 60);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const app = document.getElementById('app');
  if (app) {
    const observer = new MutationObserver(scheduleEnhance);
    observer.observe(app, { childList: true, subtree: true });
  }
  window.addEventListener('hashchange', scheduleEnhance);
  window.addEventListener('popstate', scheduleEnhance);
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target?.closest?.('[data-contacts-tab]')) scheduleEnhance();
  }, true);
  scheduleEnhance();
}

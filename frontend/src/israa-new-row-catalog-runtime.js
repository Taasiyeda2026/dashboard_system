import { supabase } from './supabase-client.js';
import { showToast } from './screens/shared/toast.js';

const CONTAINER_SELECTOR = '[data-israa-tracking-v2]';
const NEW_ROW_SELECTOR = '[data-v2-row-id="__new__"]';
const NEW_DETAIL_SELECTOR = '[data-v2-editor="__new__"]';
const DEBOUNCE_MS = 70;

let timer = null;
let schools = [];
let courses = [];
let catalogsPromise = null;
const contactsCache = new Map();

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toast(message, type = 'error') {
  try {
    showToast(message, type);
  } catch {
    window.alert(message);
  }
}

function injectStyles() {
  if (document.getElementById('israa-new-row-catalog-styles')) return;
  const style = document.createElement('style');
  style.id = 'israa-new-row-catalog-styles';
  style.textContent = `
    .israa-v2__catalog-select {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      height: 29px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 3px 5px;
      background: #fff;
      color: #0f172a;
      font: inherit;
      font-size: 10.5px;
    }

    .israa-v2__catalog-select:focus,
    .israa-v2__catalog-input:focus {
      outline: 0;
      border-color: #0891b2;
      box-shadow: 0 0 0 2px rgba(8, 145, 178, .12);
    }

    .israa-v2__catalog-input[readonly] {
      background: #f8fafc;
      color: #475569;
    }
  `;
  document.head.appendChild(style);
}

async function loadCatalogs() {
  if (catalogsPromise) return catalogsPromise;

  catalogsPromise = Promise.all([
    supabase
      .from('schools')
      .select('id,semel_mosad,school_name,authority,authority_id,principal_name,school_phone,active')
      .in('active', ['yes', 'פעיל'])
      .not('semel_mosad', 'is', null)
      .order('school_name', { ascending: true })
      .range(0, 999),
    supabase
      .from('proposal_gefen_courses')
      .select('id,short_name,full_name,gefen_number,total_price,sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
  ]).then(([schoolsResult, coursesResult]) => {
    if (schoolsResult.error) throw schoolsResult.error;
    if (coursesResult.error) throw coursesResult.error;

    schools = (schoolsResult.data || [])
      .filter((school) => clean(school.school_name) && clean(school.semel_mosad))
      .sort((a, b) => clean(a.school_name).localeCompare(clean(b.school_name), 'he'));
    courses = (coursesResult.data || [])
      .filter((course) => clean(course.short_name) && clean(course.gefen_number));
  }).catch((error) => {
    catalogsPromise = null;
    console.error('[israa-new-row-catalog-load]', error);
    toast('טעינת רשימות בתי הספר והקורסים נכשלה.');
    throw error;
  });

  return catalogsPromise;
}

function field(root, name) {
  return root?.querySelector(`[data-v2-field="${CSS.escape(name)}"]`) || null;
}

function hiddenField(root, name) {
  let input = field(root, name);
  if (input) return input;
  input = document.createElement('input');
  input.type = 'hidden';
  input.dataset.v2Field = name;
  root.appendChild(input);
  return input;
}

function authorityNames() {
  return [...new Set(schools.map((school) => clean(school.authority)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'he'));
}

function schoolOptionLabel(school) {
  return [clean(school.school_name), clean(school.semel_mosad), clean(school.authority)]
    .filter(Boolean)
    .join(' · ');
}

function fillSchoolOptions(select, authority = '', selectedSchoolId = '') {
  const normalizedAuthority = clean(authority);
  const available = normalizedAuthority
    ? schools.filter((school) => clean(school.authority) === normalizedAuthority)
    : schools;

  select.innerHTML = [
    '<option value="">בחירת בית ספר</option>',
    ...available.map((school) => `<option value="${escapeHtml(school.id)}"${String(school.id) === String(selectedSchoolId) ? ' selected' : ''}>${escapeHtml(schoolOptionLabel(school))}</option>`)
  ].join('');
}

function fillAuthorityOptions(select, selectedAuthority = '') {
  select.innerHTML = [
    '<option value="">בחירת רשות</option>',
    ...authorityNames().map((authority) => `<option value="${escapeHtml(authority)}"${authority === selectedAuthority ? ' selected' : ''}>${escapeHtml(authority)}</option>`)
  ].join('');
}

function fillCourseOptions(select, selectedCourse = '') {
  select.innerHTML = [
    '<option value="">בחירת תוכנית</option>',
    ...courses.map((course) => {
      const name = clean(course.short_name);
      const label = `${name} · ${clean(course.gefen_number)}`;
      return `<option value="${escapeHtml(name)}"${name === selectedCourse ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    })
  ].join('');
}

async function contactsForSchool(school) {
  const key = String(school.id || school.semel_mosad || '');
  if (contactsCache.has(key)) return contactsCache.get(key);

  let query = supabase
    .from('contacts_schools')
    .select('id,school_id,semel_mosad,contact_name,contact_role,phone,mobile,email,active')
    .in('active', ['yes', 'פעיל'])
    .order('contact_name', { ascending: true });

  if (school.id) query = query.eq('school_id', school.id);
  else query = query.eq('semel_mosad', school.semel_mosad);

  let { data, error } = await query.range(0, 99);
  if (error) throw error;

  if ((!data || !data.length) && school.semel_mosad) {
    const fallback = await supabase
      .from('contacts_schools')
      .select('id,school_id,semel_mosad,contact_name,contact_role,phone,mobile,email,active')
      .in('active', ['yes', 'פעיל'])
      .eq('semel_mosad', school.semel_mosad)
      .order('contact_name', { ascending: true })
      .range(0, 99);
    if (fallback.error) throw fallback.error;
    data = fallback.data || [];
  }

  const contacts = (data || []).filter((contact) => clean(contact.contact_name));
  contactsCache.set(key, contacts);
  return contacts;
}

function applyContact(contact, detail) {
  const contactInput = field(detail, 'contact_person');
  const phoneInput = field(detail, 'phone');
  const emailInput = field(detail, 'email');
  if (contactInput) contactInput.value = clean(contact?.contact_name);
  if (phoneInput) phoneInput.value = clean(contact?.mobile || contact?.phone);
  if (emailInput) emailInput.value = clean(contact?.email);
}

function configureContactInput(detail, contacts, school) {
  const contactInput = field(detail, 'contact_person');
  if (!contactInput) return;

  contactInput.classList.add('israa-v2__catalog-input');
  contactInput.setAttribute('list', 'israa-v2-new-contact-options');
  contactInput.dataset.israaNewContact = 'true';

  let datalist = detail.querySelector('#israa-v2-new-contact-options');
  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.id = 'israa-v2-new-contact-options';
    detail.appendChild(datalist);
  }
  datalist.innerHTML = contacts.map((contact) => {
    const role = clean(contact.contact_role);
    const label = role ? `${clean(contact.contact_name)} · ${role}` : clean(contact.contact_name);
    return `<option value="${escapeHtml(clean(contact.contact_name))}">${escapeHtml(label)}</option>`;
  }).join('');

  contactInput.onchange = () => {
    const selected = contacts.find((contact) => clean(contact.contact_name) === clean(contactInput.value));
    if (selected) applyContact(selected, detail);
  };

  if (contacts.length) {
    applyContact(contacts[0], detail);
  } else {
    applyContact({
      contact_name: clean(school.principal_name),
      phone: clean(school.school_phone),
      email: ''
    }, detail);
  }
}

async function applySchoolSelection(container, schoolSelect, school) {
  const row = container.querySelector(NEW_ROW_SELECTOR);
  const detail = container.querySelector(NEW_DETAIL_SELECTOR);
  if (!row || !detail || !school) return;

  hiddenField(row, 'school_name').value = clean(school.school_name);
  hiddenField(row, 'school_id').value = String(school.id || '');
  hiddenField(row, 'authority_id').value = String(school.authority_id || '');

  const semelInput = field(row, 'semel_mosad');
  const authoritySelect = field(row, 'authority');
  if (semelInput) semelInput.value = clean(school.semel_mosad);
  if (authoritySelect) authoritySelect.value = clean(school.authority);

  fillSchoolOptions(schoolSelect, clean(school.authority), school.id);

  try {
    const contacts = await contactsForSchool(school);
    configureContactInput(detail, contacts, school);
  } catch (error) {
    console.error('[israa-new-row-contacts]', error);
    configureContactInput(detail, [], school);
  }
}

function enhanceNewRow(container) {
  const row = container.querySelector(NEW_ROW_SELECTOR);
  const detail = container.querySelector(NEW_DETAIL_SELECTOR);
  if (!row || !detail || row.dataset.catalogEnhanced === 'true') return;

  const schoolInput = field(row, 'school_name');
  const authorityInput = field(row, 'authority');
  const semelInput = field(row, 'semel_mosad');
  const courseInput = field(row, 'program_name');
  const gefenInput = field(row, 'gefen_numbers');
  if (!schoolInput || !authorityInput || !semelInput || !courseInput || !gefenInput) return;

  row.dataset.catalogEnhanced = 'true';

  const schoolSelect = document.createElement('select');
  schoolSelect.className = 'israa-v2__catalog-select';
  schoolSelect.dataset.israaNewSchool = 'true';
  fillSchoolOptions(schoolSelect);
  schoolInput.replaceWith(schoolSelect);
  hiddenField(row, 'school_name');
  hiddenField(row, 'school_id');
  hiddenField(row, 'authority_id');

  const authoritySelect = document.createElement('select');
  authoritySelect.className = 'israa-v2__catalog-select';
  authoritySelect.dataset.v2Field = 'authority';
  authoritySelect.dataset.israaNewAuthority = 'true';
  fillAuthorityOptions(authoritySelect);
  authorityInput.replaceWith(authoritySelect);

  semelInput.readOnly = true;
  semelInput.classList.add('israa-v2__catalog-input');
  semelInput.placeholder = 'מתמלא אוטומטית';

  const courseSelect = document.createElement('select');
  courseSelect.className = 'israa-v2__catalog-select';
  courseSelect.dataset.v2Field = 'program_name';
  courseSelect.dataset.israaNewCourse = 'true';
  fillCourseOptions(courseSelect);
  courseInput.replaceWith(courseSelect);

  gefenInput.readOnly = true;
  gefenInput.classList.add('israa-v2__catalog-input');
  gefenInput.placeholder = 'מתמלא אוטומטית';

  authoritySelect.addEventListener('change', () => {
    hiddenField(row, 'school_name').value = '';
    hiddenField(row, 'school_id').value = '';
    hiddenField(row, 'authority_id').value = '';
    semelInput.value = '';
    fillSchoolOptions(schoolSelect, authoritySelect.value);
    schoolSelect.value = '';
    applyContact(null, detail);
  });

  schoolSelect.addEventListener('change', () => {
    const selected = schools.find((school) => String(school.id) === String(schoolSelect.value));
    if (selected) applySchoolSelection(container, schoolSelect, selected);
  });

  courseSelect.addEventListener('change', () => {
    const selected = courses.find((course) => clean(course.short_name) === clean(courseSelect.value));
    gefenInput.value = selected ? clean(selected.gefen_number) : '';
  });
}

function validateNewRow(container) {
  const row = container.querySelector(NEW_ROW_SELECTOR);
  if (!row) return true;

  const required = [
    ['school_id', 'יש לבחור בית ספר מתוך הרשימה.'],
    ['school_name', 'יש לבחור בית ספר מתוך הרשימה.'],
    ['semel_mosad', 'לבית הספר שנבחר חסר סמל מוסד.'],
    ['program_name', 'יש לבחור תוכנית מתוך רשימת הקורסים.'],
    ['gefen_numbers', 'לתוכנית שנבחרה חסר מספר גפ״ן.']
  ];

  for (const [name, message] of required) {
    if (!clean(field(row, name)?.value)) {
      toast(message);
      return false;
    }
  }
  return true;
}

async function run() {
  injectStyles();
  const container = document.querySelector(CONTAINER_SELECTOR);
  if (!container || !container.querySelector(NEW_ROW_SELECTOR)) return;
  await loadCatalogs();
  enhanceNewRow(container);
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    run().catch((error) => console.error('[israa-new-row-catalog]', error));
  }, DEBOUNCE_MS);
}

document.addEventListener('click', (event) => {
  const saveButton = event.target.closest('[data-v2-save-new]');
  if (!saveButton) return;
  const container = saveButton.closest(CONTAINER_SELECTOR);
  if (!container || validateNewRow(container)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', schedule, { once: true });
} else {
  schedule();
}

new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true
});

window.addEventListener('hashchange', schedule);

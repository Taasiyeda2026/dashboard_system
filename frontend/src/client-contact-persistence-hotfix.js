import { supabase } from './supabase-client.js';
import { clearScreenDataCache } from './state.js';
import { deletePersistedCacheByPrefixes } from './cache-persist.js';
import { showToast } from './screens/shared/toast.js';

const FORM_SELECTOR = '#app [data-pa-client-contact-form]';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalized(value) {
  return clean(value).replace(/\s+/g, ' ').toLocaleLowerCase('he-IL');
}

function formFields(form) {
  const data = new FormData(form);
  return {
    contact_name: clean(data.get('contact_name')),
    contact_role: clean(data.get('contact_role')),
    mobile: clean(data.get('mobile')),
    phone: clean(data.get('phone')),
    email: clean(data.get('email'))
  };
}

function rememberOriginalFormValues(form) {
  if (!form || form.dataset.paOriginalContactFields) return;
  try {
    form.dataset.paOriginalContactFields = JSON.stringify(formFields(form));
  } catch {
    form.dataset.paOriginalContactFields = '{}';
  }
}

function originalFormFields(form) {
  try {
    const parsed = JSON.parse(form.dataset.paOriginalContactFields || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function annotateContactForms(root = document) {
  root.querySelectorAll?.(FORM_SELECTOR).forEach(rememberOriginalFormValues);
}

function setFormError(form, message) {
  const error = form.querySelector('[data-pa-client-contact-error]');
  if (error) error.textContent = message;
}

function replaceContactChannels(host, fields) {
  if (!host) return;
  host.replaceChildren();
  const mobile = fields.mobile || fields.phone;
  if (mobile) {
    const link = document.createElement('a');
    link.href = `tel:${mobile}`;
    link.textContent = mobile;
    host.appendChild(link);
  } else {
    const empty = document.createElement('span');
    empty.textContent = 'אין טלפון';
    host.appendChild(empty);
  }
  if (fields.email) {
    const link = document.createElement('a');
    link.href = `mailto:${fields.email}`;
    link.textContent = fields.email;
    host.appendChild(link);
  } else {
    const empty = document.createElement('span');
    empty.textContent = 'אין דוא״ל';
    host.appendChild(empty);
  }
}

function updateVisibleContactCard(form, fields) {
  const index = Number(form.dataset.paContactIndex);
  if (!Number.isInteger(index) || index < 0) return;
  const button = document.querySelector(`#app [data-pa-client-edit-contact="${index}"]`);
  const card = button?.closest('.ds-client-contact');
  if (!card) return;
  const name = card.querySelector('.ds-client-contact__identity strong');
  const role = card.querySelector('.ds-client-contact__identity span');
  if (name) name.textContent = fields.contact_name || 'איש קשר';
  if (role) role.textContent = fields.contact_role || 'ללא תפקיד';
  replaceContactChannels(card.querySelector('.ds-client-contact__channels'), fields);
}

function valuesMatchContact(row, fields) {
  return normalized(row?.contact_name) === normalized(fields.contact_name)
    && normalized(row?.contact_role) === normalized(fields.contact_role)
    && normalized(row?.mobile) === normalized(fields.mobile)
    && normalized(row?.phone) === normalized(fields.phone)
    && normalized(row?.email) === normalized(fields.email);
}

function contactSourceScore(row, original = {}) {
  if (!row) return -1;
  let score = 0;
  if (normalized(row.contact_name) && normalized(row.contact_name) === normalized(original.contact_name)) score += 8;
  if (normalized(row.contact_role) === normalized(original.contact_role)) score += 2;
  if (normalized(row.mobile) === normalized(original.mobile)) score += 3;
  if (normalized(row.phone) === normalized(original.phone)) score += 2;
  if (normalized(row.email) === normalized(original.email)) score += 3;
  return score;
}

function schoolSourceScore(row, original = {}) {
  if (!row) return -1;
  let score = 0;
  if (normalized(row.principal_name) && normalized(row.principal_name) === normalized(original.contact_name)) score += 8;
  const originalPhone = original.mobile || original.phone;
  if (normalized(row.school_phone) === normalized(originalPhone)) score += 3;
  return score;
}

async function readPossibleSources(contactId) {
  const [contactResult, schoolResult] = await Promise.all([
    supabase
      .from('contacts_schools')
      .select('id,school_id,contact_name,contact_role,phone,mobile,email')
      .eq('id', contactId)
      .maybeSingle(),
    supabase
      .from('schools')
      .select('id,principal_name,school_phone')
      .eq('id', contactId)
      .maybeSingle()
  ]);
  if (contactResult.error) throw contactResult.error;
  if (schoolResult.error) throw schoolResult.error;
  return { contactRow: contactResult.data, schoolRow: schoolResult.data };
}

async function saveExistingContact(contactId, fields, original = {}) {
  const { contactRow, schoolRow } = await readPossibleSources(contactId);
  if (!contactRow && !schoolRow) throw new Error('contact_source_not_found');

  const sourceTable = schoolRow
    && (!contactRow || schoolSourceScore(schoolRow, original) > contactSourceScore(contactRow, original))
    ? 'schools'
    : 'contacts_schools';

  const { data: saved, error } = await supabase.rpc('save_client_file_contact', {
    p_source_table: sourceTable,
    p_source_id: Number(contactId),
    p_contact_name: fields.contact_name,
    p_contact_role: fields.contact_role || null,
    p_phone: fields.phone || null,
    p_mobile: fields.mobile || null,
    p_email: fields.email || null
  });
  if (error) throw error;
  if (!saved || !valuesMatchContact(saved, fields)) throw new Error('contact_update_verification_failed');
  return saved;
}

async function handleContactSubmit(event) {
  const form = event.target?.closest?.(FORM_SELECTOR);
  if (!form) return;
  rememberOriginalFormValues(form);
  const index = Number(form.dataset.paContactIndex);
  const contactId = clean(form.dataset.paContactId);
  if (!Number.isInteger(index) || index < 0 || !contactId) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (form.dataset.contactSaveHotfix === 'saving') return;

  const fields = formFields(form);
  const original = originalFormFields(form);
  if (!fields.contact_name) {
    setFormError(form, 'יש להזין שם איש קשר');
    return;
  }

  const submit = form.querySelector('[type="submit"]');
  form.dataset.contactSaveHotfix = 'saving';
  if (submit) submit.disabled = true;
  setFormError(form, 'שומר ומוודא שהעדכון נקלט...');

  try {
    await saveExistingContact(contactId, fields, original);
    updateVisibleContactCard(form, fields);
    clearScreenDataCache();
    deletePersistedCacheByPrefixes(['proposals-agreements']);
    form.closest('[data-pa-client-contact-modal]')?.remove();
    showToast('פרטי איש הקשר עודכנו ונשמרו', 'success', 2200);
  } catch (error) {
    console.error('[client-contact-hotfix] verified update failed', error);
    form.dataset.contactSaveHotfix = '';
    if (submit) submit.disabled = false;
    setFormError(form, 'העדכון לא נשמר. הפרטים נשארו בטופס וניתן לנסות שוב.');
    showToast('לא ניתן היה לשמור את פרטי איש הקשר', 'error', 2600);
  }
}

annotateContactForms();
new MutationObserver(() => annotateContactForms()).observe(document.documentElement, {
  childList: true,
  subtree: true
});
document.addEventListener('submit', handleContactSubmit, true);

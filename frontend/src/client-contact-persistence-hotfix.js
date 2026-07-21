import { supabase } from './supabase-client.js';
import { clearScreenDataCache } from './state.js';
import { deletePersistedCacheByPrefixes } from './cache-persist.js';
import { showToast } from './screens/shared/toast.js';

const FORM_SELECTOR = '#app [data-pa-client-contact-form]';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function nullable(value) {
  const next = clean(value);
  return next || null;
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

async function syncMatchingSchoolPrincipal(originalRow, fields) {
  const schoolId = originalRow?.school_id;
  if (schoolId == null || schoolId === '') return;
  const { data: school, error: readError } = await supabase
    .from('schools')
    .select('id,principal_name,school_phone')
    .eq('id', schoolId)
    .maybeSingle();
  if (readError || !school) return;
  if (normalized(school.principal_name) !== normalized(originalRow.contact_name)) return;
  const schoolPhone = fields.mobile || fields.phone;
  const { error: updateError } = await supabase
    .from('schools')
    .update({
      principal_name: nullable(fields.contact_name),
      school_phone: nullable(schoolPhone)
    })
    .eq('id', schoolId);
  if (updateError) console.warn('[client-contact-hotfix] principal sync failed', updateError.message || updateError);
}

async function saveExistingContact(contactId, fields) {
  const { data: contactRow, error: contactReadError } = await supabase
    .from('contacts_schools')
    .select('id,school_id,contact_name,contact_role,phone,mobile,email')
    .eq('id', contactId)
    .maybeSingle();
  if (contactReadError) throw contactReadError;

  if (contactRow) {
    const updateBody = {
      contact_name: nullable(fields.contact_name),
      contact_role: nullable(fields.contact_role),
      mobile: nullable(fields.mobile),
      phone: nullable(fields.phone),
      email: nullable(fields.email)
    };
    const { data: saved, error } = await supabase
      .from('contacts_schools')
      .update(updateBody)
      .eq('id', contactId)
      .select('id,school_id,contact_name,contact_role,phone,mobile,email')
      .single();
    if (error) throw error;
    if (!saved || !valuesMatchContact(saved, fields)) throw new Error('contact_update_verification_failed');
    await syncMatchingSchoolPrincipal(contactRow, fields);
    return saved;
  }

  const schoolPhone = fields.mobile || fields.phone;
  const { data: savedSchool, error: schoolError } = await supabase
    .from('schools')
    .update({
      principal_name: nullable(fields.contact_name),
      school_phone: nullable(schoolPhone)
    })
    .eq('id', contactId)
    .select('id,principal_name,school_phone')
    .single();
  if (schoolError) throw schoolError;
  if (!savedSchool
      || normalized(savedSchool.principal_name) !== normalized(fields.contact_name)
      || normalized(savedSchool.school_phone) !== normalized(schoolPhone)) {
    throw new Error('school_contact_update_verification_failed');
  }
  return savedSchool;
}

async function handleContactSubmit(event) {
  const form = event.target?.closest?.(FORM_SELECTOR);
  if (!form) return;
  const index = Number(form.dataset.paContactIndex);
  const contactId = clean(form.dataset.paContactId);
  if (!Number.isInteger(index) || index < 0 || !contactId) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (form.dataset.contactSaveHotfix === 'saving') return;

  const fields = formFields(form);
  if (!fields.contact_name) {
    setFormError(form, 'יש להזין שם איש קשר');
    return;
  }

  const submit = form.querySelector('[type="submit"]');
  form.dataset.contactSaveHotfix = 'saving';
  if (submit) submit.disabled = true;
  setFormError(form, 'שומר ומוודא שהעדכון נקלט...');

  try {
    await saveExistingContact(contactId, fields);
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

document.addEventListener('submit', handleContactSubmit, true);

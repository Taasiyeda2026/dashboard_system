import { supabase } from './supabase-client.js';
import { clearScreenDataCache } from './state.js';
import { deletePersistedCacheByPrefixes } from './cache-persist.js';
import { showToast } from './screens/shared/toast.js';

const FORM_SELECTOR = '#app [data-pa-client-contact-form]';
const CARD_SELECTOR = '#app [data-pa-client-file] .ds-client-contact';
const STYLE_ID = 'client-contact-mobile-policy-v1';
const APPROVAL_ACTION_SELECTOR = '#app [data-pa-save-pending]';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalized(value) {
  return clean(value).replace(/\s+/g, ' ').toLocaleLowerCase('he-IL');
}

function phoneDigits(value) {
  return clean(value).replace(/[^0-9]/g, '');
}

function isIsraeliMobile(value) {
  const digits = phoneDigits(value);
  return /^05[0-9]{8}$/.test(digits) || /^9725[0-9]{8}$/.test(digits);
}

function samePhoneNumber(a, b) {
  const first = phoneDigits(a);
  const second = phoneDigits(b);
  return Boolean(first && second && first === second);
}

function ensureMobilePolicyStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #app .ds-client-contact__channel {
      display: inline-flex;
      align-items: baseline;
      gap: 4px;
      max-width: 100%;
    }
    #app .ds-client-contact__channel-label {
      flex: 0 0 auto;
      color: #475569;
      font-weight: 700;
    }
    #app .ds-client-contact__missing-mobile {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      padding: 2px 6px;
      border: 1px solid #fed7aa;
      border-radius: 7px;
      background: #fff7ed;
      color: #9a3412 !important;
      font-weight: 700;
    }
    #app [data-pa-mobile-policy-hint] {
      display: block;
      margin-top: 4px;
      color: #64748b;
      font-size: 0.72rem;
      line-height: 1.35;
    }
  `;
  document.head.appendChild(style);
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

function setLabelText(input, value) {
  const label = input?.closest?.('label');
  if (!label) return;
  const textNode = Array.from(label.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  if (textNode) textNode.textContent = value;
}

function normalizeContactFormChannels(form) {
  const mobileInput = form.querySelector('[name="mobile"]');
  const phoneInput = form.querySelector('[name="phone"]');
  if (!mobileInput) return;

  setLabelText(mobileInput, 'נייד');
  mobileInput.required = true;
  mobileInput.inputMode = 'tel';
  mobileInput.autocomplete = 'tel-national';
  mobileInput.placeholder = '05X-XXXXXXX';
  mobileInput.setAttribute('aria-required', 'true');

  if (phoneInput) {
    setLabelText(phoneInput, 'טלפון נוסף');
    phoneInput.inputMode = 'tel';
    phoneInput.autocomplete = 'tel';
  }

  if (phoneInput && samePhoneNumber(mobileInput.value, phoneInput.value)) {
    if (isIsraeliMobile(mobileInput.value)) phoneInput.value = '';
    else mobileInput.value = '';
  }

  const label = mobileInput.closest('label');
  if (label && !label.querySelector('[data-pa-mobile-policy-hint]')) {
    const hint = document.createElement('small');
    hint.dataset.paMobilePolicyHint = 'yes';
    hint.textContent = 'נדרש מספר נייד ישראלי תקין.';
    label.appendChild(hint);
  }
}

function annotateContactForms(root = document) {
  root.querySelectorAll?.(FORM_SELECTOR).forEach((form) => {
    rememberOriginalFormValues(form);
    if (form.dataset.paMobilePolicyAnnotated === 'yes') return;
    normalizeContactFormChannels(form);
    form.dataset.paMobilePolicyAnnotated = 'yes';
  });
}

function setFormError(form, message) {
  const error = form.querySelector('[data-pa-client-contact-error]');
  if (error) error.textContent = message;
}

function appendChannel(host, label, value, hrefPrefix) {
  const row = document.createElement('span');
  row.className = 'ds-client-contact__channel';

  const caption = document.createElement('span');
  caption.className = 'ds-client-contact__channel-label';
  caption.textContent = `${label}:`;

  const link = document.createElement('a');
  link.href = `${hrefPrefix}:${value}`;
  link.textContent = value;

  row.append(caption, link);
  host.appendChild(row);
}

function appendMissingMobile(host) {
  const badge = document.createElement('span');
  badge.className = 'ds-client-contact__missing-mobile';
  badge.textContent = 'חסר מספר נייד';
  host.appendChild(badge);
}

function replaceContactChannels(host, fields) {
  if (!host) return;
  host.replaceChildren();

  const mobile = clean(fields.mobile);
  const phone = clean(fields.phone);
  const email = clean(fields.email);

  if (mobile) appendChannel(host, 'נייד', mobile, 'tel');
  else appendMissingMobile(host);

  if (phone && !samePhoneNumber(phone, mobile)) appendChannel(host, 'טלפון', phone, 'tel');

  if (email) appendChannel(host, 'דוא״ל', email, 'mailto');
  else {
    const empty = document.createElement('span');
    empty.textContent = 'אין דוא״ל';
    host.appendChild(empty);
  }
}

function decorateVisibleContactCards(root = document) {
  root.querySelectorAll?.(CARD_SELECTOR).forEach((card) => {
    if (card.dataset.paMobilePolicyDecorated === 'yes') return;
    const host = card.querySelector('.ds-client-contact__channels');
    if (!host) return;

    const tel = clean(host.querySelector('a[href^="tel:"]')?.textContent);
    const email = clean(host.querySelector('a[href^="mailto:"]')?.textContent);
    const fields = isIsraeliMobile(tel)
      ? { mobile: tel, phone: '', email }
      : { mobile: '', phone: tel, email };

    card.dataset.paMobilePolicyDecorated = 'yes';
    replaceContactChannels(host, fields);
  });
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
  card.dataset.paMobilePolicyDecorated = 'yes';
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

function validateContactFields(fields) {
  if (!fields.contact_name) return 'יש להזין שם איש קשר';
  if (!fields.mobile) return 'יש להזין מספר נייד';
  if (!isIsraeliMobile(fields.mobile)) return 'יש להזין מספר נייד ישראלי תקין';
  return '';
}

function normalizeSubmittedFields(form, fields) {
  if (samePhoneNumber(fields.mobile, fields.phone)) {
    const phoneInput = form.querySelector('[name="phone"]');
    if (phoneInput) phoneInput.value = '';
    return { ...fields, phone: '' };
  }
  return fields;
}

async function handleContactSubmit(event) {
  const form = event.target?.closest?.(FORM_SELECTOR);
  if (!form) return;
  rememberOriginalFormValues(form);

  let fields = normalizeSubmittedFields(form, formFields(form));
  const validationError = validateContactFields(fields);
  if (validationError) {
    event.preventDefault();
    event.stopImmediatePropagation();
    setFormError(form, validationError);
    showToast(validationError, 'error', 2600);
    return;
  }

  const index = Number(form.dataset.paContactIndex);
  const contactId = clean(form.dataset.paContactId);
  if (!Number.isInteger(index) || index < 0 || !contactId) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  if (form.dataset.contactSaveHotfix === 'saving') return;

  const original = originalFormFields(form);
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

function handleProposalApprovalClick(event) {
  const button = event.target?.closest?.(APPROVAL_ACTION_SELECTOR);
  if (!button) return;
  const targetStatus = clean(button.dataset.paTargetStatus);
  if (!['pending_approval', 'approved'].includes(targetStatus)) return;

  const form = button.closest('[data-pa-form]');
  const mobile = clean(form?.querySelector('[name="phone"]')?.value);
  if (isIsraeliMobile(mobile)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  const message = 'לפני שליחה לאישור יש לבחור איש קשר עם מספר נייד ישראלי תקין.';
  const error = form?.querySelector('[data-pa-form-error]');
  if (error) error.textContent = message;
  showToast(message, 'error', 3200);
}

function applyMobilePolicy(root = document) {
  ensureMobilePolicyStyle();
  annotateContactForms(root);
  decorateVisibleContactCards(root);
}

applyMobilePolicy();
new MutationObserver(() => applyMobilePolicy()).observe(document.documentElement, {
  childList: true,
  subtree: true
});
document.addEventListener('submit', handleContactSubmit, true);
document.addEventListener('click', handleProposalApprovalClick, true);

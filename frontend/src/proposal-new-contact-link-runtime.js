import { api } from './api.js';
import { persistNewClientContact } from './client-contact-persistence.js';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function originalContactSnapshot(payload = {}) {
  const original = payload?._contact_original;
  return original && typeof original === 'object' && !Array.isArray(original) ? original : null;
}

export function newProposalContactCandidate(payload = {}) {
  const original = originalContactSnapshot(payload);
  if (!original) return null;
  if (clean(payload.supersedes_proposal_id)) return null;
  if (clean(payload.client_type) !== 'school') return null;
  if (clean(payload.contact_school_id)) return null;

  const authorityId = payload.authority_id ?? original.authority_id ?? null;
  const schoolId = payload.school_id ?? original.school_id ?? null;
  const contactName = clean(payload.contact_name || original.contact_name);
  if (!clean(authorityId) || !clean(schoolId) || !contactName) return null;

  return {
    client_type: 'school',
    client_name: clean(payload.client_name || payload.school_framework || original.client_name || original.school),
    authority_id: authorityId,
    school_id: schoolId,
    semel_mosad: payload.semel_mosad ?? original.semel_mosad ?? null,
    authority: clean(payload.client_authority || original.authority),
    school: clean(payload.school_framework || original.school),
    contact_name: contactName,
    contact_role: clean(payload.contact_role || original.contact_role),
    mobile: clean(payload.phone || payload.contact_phone || original.mobile || original.phone),
    phone: '',
    email: clean(payload.email || payload.contact_email || original.email),
    active: true
  };
}

export async function linkNewProposalContact(targetApi, payload = {}, dependencies = {}) {
  const candidate = newProposalContactCandidate(payload);
  if (!candidate) return payload;

  const persistContact = dependencies.persistContact || persistNewClientContact;
  let saved;
  try {
    saved = await persistContact(targetApi, candidate);
  } catch (error) {
    throw new Error('לא ניתן היה לשמור ולקשר את איש הקשר. ההצעה לא נשמרה.', { cause: error });
  }

  const sourceId = saved?.source_id ?? saved?.id;
  if (!clean(sourceId)) {
    throw new Error('לא ניתן היה לשמור ולקשר את איש הקשר. ההצעה לא נשמרה.');
  }

  return {
    ...payload,
    contact_school_id: sourceId,
    _contact_original: {
      ...(originalContactSnapshot(payload) || {}),
      id: sourceId,
      source_id: sourceId,
      source_table: 'contacts_schools',
      contact_name: saved?.contact_name || candidate.contact_name,
      contact_role: saved?.contact_role || candidate.contact_role,
      mobile: saved?.mobile || candidate.mobile,
      email: saved?.email || candidate.email
    }
  };
}

export function installNewProposalContactLink(targetApi = api, dependencies = {}) {
  if (!targetApi || typeof targetApi.addProposalAgreement !== 'function') return false;
  if (targetApi.__proposalNewContactLinkInstalled === true) return false;

  const originalAddProposalAgreement = targetApi.addProposalAgreement.bind(targetApi);
  const persistContact = dependencies.persistContact || persistNewClientContact;
  targetApi.addProposalAgreement = async (payload = {}) => {
    const linkedPayload = await linkNewProposalContact(targetApi, payload, { persistContact });
    return originalAddProposalAgreement(linkedPayload);
  };
  Object.defineProperty(targetApi, '__proposalNewContactLinkInstalled', {
    value: true,
    configurable: true,
    enumerable: false,
    writable: false
  });
  return true;
}

installNewProposalContactLink();

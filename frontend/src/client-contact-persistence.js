function clean(value) {
  return String(value == null ? '' : value).trim();
}

const SCHOOL_CONTACT_UNIQUE_CONSTRAINT = 'contacts_schools_authority_school_contact_name_key';

function isSchoolContactDuplicate(error) {
  const constraint = clean(error?.constraint);
  const diagnostic = [error?.message, error?.details, error?.hint].map(clean).join(' ');
  return (clean(error?.code) === '23505' || Number(error?.status) === 409)
    && (constraint === SCHOOL_CONTACT_UNIQUE_CONSTRAINT || diagnostic.includes(SCHOOL_CONTACT_UNIQUE_CONSTRAINT));
}

function savedSchoolContact(contactFields, row, alreadyExisted = false) {
  return {
    ...contactFields,
    ...row,
    id: row.id,
    source_id: row.id,
    source_table: 'contacts_schools',
    ...(alreadyExisted ? { already_existed: true } : {})
  };
}

export async function persistNewClientContact(api, contactFields) {
  const row = { ...contactFields };
  delete row.id;
  delete row.source_id;
  delete row.source_table;
  let result;
  try {
    result = await api.addContact({ kind: 'school', row });
  } catch (error) {
    if (!isSchoolContactDuplicate(error) || typeof api.findSchoolContactByUniqueIdentity !== 'function') throw error;
    const lookup = await api.findSchoolContactByUniqueIdentity({
      authority: clean(row.authority),
      school: clean(row.school),
      contact_name: clean(row.contact_name),
      school_id: row.school_id ?? null
    });
    const candidates = Array.isArray(lookup?.rows) ? lookup.rows : [];
    const expectedSchoolId = clean(row.school_id);
    const existing = candidates.find((candidate) => (
      !expectedSchoolId || clean(candidate?.school_id) === expectedSchoolId
    ));
    if (!existing || existing.id == null || clean(existing.id) === '') {
      throw new Error('client_contact_duplicate_lookup_failed', { cause: error });
    }
    return savedSchoolContact(contactFields, existing, true);
  }
  if (!result?.ok || result?.row?.id == null || clean(result.row.id) === '') {
    throw new Error('client_contact_insert_verification_failed');
  }
  return savedSchoolContact(contactFields, result.row);
}

export function mergeFetchedContactsWithInserted(fetchedContacts = [], insertedContacts = []) {
  const fetched = Array.isArray(fetchedContacts) ? fetchedContacts : [];
  const fetchedIds = new Set(fetched.map((contact) => clean(contact?.source_id ?? contact?.id)).filter(Boolean));
  return [
    ...fetched,
    ...(Array.isArray(insertedContacts) ? insertedContacts : []).filter(
      (contact) => !fetchedIds.has(clean(contact?.source_id ?? contact?.id))
    )
  ];
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

export async function persistNewClientContact(api, contactFields) {
  const row = { ...contactFields };
  delete row.id;
  delete row.source_id;
  delete row.source_table;
  const result = await api.addContact({ kind: 'school', row });
  if (!result?.ok || result?.row?.id == null || clean(result.row.id) === '') {
    throw new Error('client_contact_insert_verification_failed');
  }
  return {
    ...contactFields,
    ...result.row,
    id: result.row.id,
    source_id: result.row.id,
    source_table: 'contacts_schools'
  };
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

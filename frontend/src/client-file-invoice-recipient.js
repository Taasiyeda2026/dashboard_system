// The billing administrator is an invoice-recipient designation, not a job title.
// Preserve a principal's actual job title, while displaying the billing role in
// the client file. A recipient that has no contact record gets one read-only
// display card, not a duplicate contacts_schools database record.
const norm = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const comparable = (value) => norm(value).toLocaleLowerCase('he-IL');
export function clientFileWithInvoiceRecipient(file = {}, recipient = null) {
  if (!recipient || String(recipient.school_id) !== String(file.school_id)) return file;
  const contacts = [...(file.contacts || [])];
  const name = norm(recipient.recipient_name);
  const billingEmail = norm(recipient.recipient_email);
  if (!name || !billingEmail) return file;
  const contactId = String(recipient.contact_id || '');
  const existingIndex = contacts.findIndex(contact => (
    (contactId && String(contact.source_table) === 'contacts_schools'
      && String(contact.source_id ?? contact.id ?? '') === contactId)
    || comparable(contact.contact_name) === comparable(name)
  ));
  if (existingIndex >= 0) {
    contacts[existingIndex] = {
      ...contacts[existingIndex],
      invoice_recipient: true,
      invoice_recipient_email: billingEmail,
      invoice_recipient_source: 'finance_school_invoice_recipients'
    };
  } else {
    contacts.push({
      contact_name: name,
      contact_role: 'מנהלן/ית',
      mobile: norm(recipient.recipient_mobile),
      email: billingEmail,
      invoice_recipient: true,
      invoice_recipient_email: billingEmail,
      invoice_recipient_virtual: true,
      invoice_recipient_source: 'finance_school_invoice_recipients',
      _clientContactKey: comparable(name)
    });
  }
  return { ...file, contacts };
}

export function clientInvoiceRecipientRole(role, designated) {
  const title = norm(role);
  if (!designated) return title || 'ללא תפקיד';
  if (['מנהלנית','מנהלן','מנהלן/ית'].includes(title)) return 'מנהלן/ית - מקבל/ת חשבון עסקה';
  return title ? `${title} · מנהלן/ית - מקבל/ת חשבון עסקה` : 'מנהלן/ית - מקבל/ת חשבון עסקה';
}

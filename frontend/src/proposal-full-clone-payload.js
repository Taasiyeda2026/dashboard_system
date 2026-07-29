const EDITABLE_PROPOSAL_FIELDS = Object.freeze([
  'client_type',
  'authority_id',
  'school_id',
  'semel_mosad',
  'contact_school_id',
  'client_authority',
  'school_framework',
  'document_type',
  'activity_type_group',
  'proposal_domain',
  'proposal_date',
  'valid_until',
  'activity_names',
  'contact_name',
  'contact_role',
  'phone',
  'email',
  'notes',
  'total_amount',
  'custom_document_sections',
  'include_catalog',
  'combine_gefen_approval'
]);

function text(value) {
  return String(value == null ? '' : value).trim();
}

function hasUsableValue(value) {
  if (value === false || value === 0) return true;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return true;
  return text(value) !== '';
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
  }
  return value;
}

/**
 * Builds the complete business payload for a cloned proposal.
 *
 * The clone keeps every editable proposal value, while deliberately omitting
 * generated, approval, signature, PDF, audit and lock fields. The new record is
 * always created as an editable draft and remains linked to the source version.
 */
export function buildEditableProposalClonePayload(source = {}, requested = {}) {
  const payload = {};

  for (const field of EDITABLE_PROPOSAL_FIELDS) {
    const requestedValue = requested?.[field];
    const sourceValue = source?.[field];
    const value = hasUsableValue(requestedValue) ? requestedValue : sourceValue;
    if (value !== undefined) payload[field] = cloneValue(value);
  }

  const sourceId = text(source?.id || requested?.supersedes_proposal_id);
  if (!sourceId) throw new Error('missing_clone_source_proposal_id');

  payload.supersedes_proposal_id = sourceId;
  payload.status = 'draft';
  payload.approval_note = '';

  return payload;
}

/**
 * Removes record-specific identifiers from proposal items before saving them
 * under the newly created draft.
 */
export function cloneProposalItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item = {}) => {
    const {
      id: _id,
      proposal_agreement_id: _proposalAgreementId,
      proposalAgreementId: _proposalAgreementIdCamel,
      created_at: _createdAt,
      updated_at: _updatedAt,
      ...editableItem
    } = item;
    return cloneValue(editableItem);
  });
}

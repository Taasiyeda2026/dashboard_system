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

function normalizeProposalGroup(value) {
  const group = text(value).toLowerCase();
  return group === 'next_year_courses' || group === 'next_year_workshops' ? 'next_year' : value;
}

/**
 * Builds the complete business payload for an independent editable clone.
 *
 * The clone keeps every editable proposal value, while deliberately omitting
 * generated, approval, signature, PDF, audit, lock and version-lineage fields.
 * It is always created as a new draft in a new proposal series, so repeating
 * the action never collides with an existing version and never archives the
 * source proposal.
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

  // The source ID is used only to load the latest source data. It is not sent
  // as supersedes_proposal_id because duplication must create a new independent
  // proposal rather than another version in the source series.
  payload.status = 'draft';
  payload.approval_note = '';
  payload.activity_type_group = normalizeProposalGroup(payload.activity_type_group);

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

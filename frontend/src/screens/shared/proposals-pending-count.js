const STATUS_ALIASES = { pending_approval: 'sent' };

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalizeProposalStatus(status) {
  const raw = text(status);
  return STATUS_ALIASES[raw] || raw;
}

export function isProposalApprovedPendingSend(row) {
  if (!row || typeof row !== 'object') return false;
  const status = normalizeProposalStatus(row.status);
  if (status === 'sent' || status === 'cancelled') return false;
  if (status === 'approved') return true;
  if (status === 'draft') {
    return Boolean(row.approved_at) || Boolean(row.signature_meta?.signature?.image);
  }
  return false;
}

export function countPendingApprovedProposals(rows) {
  return (Array.isArray(rows) ? rows : []).filter(isProposalApprovedPendingSend).length;
}

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalizeProposalStatus(status) {
  return text(status);
}

export function isProposalApprovedPendingSend(row) {
  if (!row || typeof row !== 'object') return false;
  return normalizeProposalStatus(row.status) === 'approved';
}

export function countPendingApprovedProposals(rows) {
  return (Array.isArray(rows) ? rows : []).filter(isProposalApprovedPendingSend).length;
}

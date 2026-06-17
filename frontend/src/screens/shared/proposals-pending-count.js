const STATUS_ALIASES = { pending_approval: 'sent' };

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalizeProposalStatus(status) {
  const raw = text(status);
  return STATUS_ALIASES[raw] || raw;
}

function normalizeSignatureMeta(value) {
  let raw = value;
  if (typeof raw === 'string' && raw.trim()) {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  const source = raw?.signature && typeof raw.signature === 'object' ? raw.signature : raw;
  if (!source || typeof source !== 'object') return null;
  return { signature: { image: text(source.image) } };
}

export function isProposalApprovedPendingSend(row) {
  if (!row || typeof row !== 'object') return false;
  const status = normalizeProposalStatus(row.status);
  if (status === 'sent' || status === 'cancelled') return false;
  const isApproved = status === 'approved';
  const hasApprovedAt = Boolean(text(row.approved_at));
  const hasSignature = normalizeSignatureMeta(row.signature_meta || row.approval_meta) !== null;
  return isApproved || hasApprovedAt || hasSignature;
}

export function countPendingApprovedProposals(rows) {
  return (Array.isArray(rows) ? rows : []).filter(isProposalApprovedPendingSend).length;
}

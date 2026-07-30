function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export function proposalItemRows(draft) {
  if (!Array.isArray(draft?.proposal_items)) return [];
  return draft.proposal_items.map((item) => ({
    program_name: clean(item?.program_name),
    gefen_number: clean(item?.gefen_number),
    quantity: item?.quantity == null || item.quantity === '' ? null : Number(item.quantity),
  }));
}

export function activitiesTable(draft) {
  const items = proposalItemRows(draft);
  if (!items.length) {
    return `<div class="israa-drawer__legacy-activities">
      <div><strong>פירוט ההצעה:</strong> ${escapeHtml(clean(draft?.program_name) || '—')}</div>
      <div><strong>מספרי גפ״ן:</strong> ${escapeHtml(clean(draft?.gefen_numbers) || '—')}</div>
    </div>`;
  }
  const cells = items.map((item) => `<tr><td>${escapeHtml(item.program_name || '—')}</td><td>${escapeHtml(item.gefen_number || '—')}</td><td>${escapeHtml(item.quantity ?? '—')}</td></tr>`).join('');
  return `<table class="israa-drawer__activities"><thead><tr><th>שם הפעילות</th><th>מספר גפ״ן</th><th>מספר קבוצות</th></tr></thead><tbody>${cells}</tbody></table>`;
}

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
  const cells = items.length
    ? items.map((item) => `<tr><td>${escapeHtml(item.program_name || '—')}</td><td>${escapeHtml(item.gefen_number || '—')}</td><td>${escapeHtml(item.quantity ?? '—')}</td></tr>`).join('')
    : '<tr><td colspan="3">לא נמצאו פעילויות בהצעה המקושרת.</td></tr>';
  return `<table class="israa-drawer__activities"><thead><tr><th>שם הפעילות</th><th>מספר גפ״ן</th><th>מספר קבוצות</th></tr></thead><tbody>${cells}</tbody></table>`;
}

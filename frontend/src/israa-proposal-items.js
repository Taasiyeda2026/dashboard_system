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

export function activitiesTable(draft, { selectable = false } = {}) {
  const items = proposalItemRows(draft);
  if (!items.length) {
    return `<div class="israa-drawer__legacy-activities">
      <div><strong>פירוט ההצעה:</strong> ${escapeHtml(clean(draft?.program_name) || '—')}</div>
      <div><strong>מספרי גפ״ן:</strong> ${escapeHtml(clean(draft?.gefen_numbers) || '—')}</div>
    </div>`;
  }
  const cells = items.map((item, index) => {
    const source = draft.proposal_items[index] || {};
    const action = selectable && source.proposal_item_id
      ? `<td><button type="button" class="israa-btn" data-israa-select-activity="${escapeHtml(source.proposal_item_id)}" data-israa-tracking-id="${escapeHtml(draft.id)}">העבר לפעילויות</button></td>`
      : '';
    return `<tr><td>${escapeHtml(item.program_name || '—')}</td><td>${escapeHtml(item.gefen_number || '—')}</td><td>${escapeHtml(item.quantity ?? '—')}</td>${action}</tr>`;
  }).join('');
  return `<table class="israa-drawer__activities"><thead><tr><th>שם הפעילות</th><th>מספר גפ״ן</th><th>מספר קבוצות</th>${selectable ? '<th>פעולה</th>' : ''}</tr></thead><tbody>${cells}</tbody></table>`;
}

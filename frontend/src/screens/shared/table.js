export function renderTableScreen({ title, columns, rows }) {
  const safeColumns = Array.isArray(columns) ? columns : [];
  const safeRows = Array.isArray(rows) ? rows : [];
  const head = safeColumns.map((c) => `<th>${c}</th>`).join('');
  const body = safeRows.length
    ? safeRows.map((row) => `<tr>${safeColumns.map((c) => `<td>${row?.[c] ?? '—'}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${Math.max(safeColumns.length, 1)}">No data available.</td></tr>`;

  return `<section class="stack"><h2>${title}</h2><article class="card overflow-x"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></article></section>`;
}

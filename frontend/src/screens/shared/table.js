export function renderTableScreen({ title, columns, rows }) {
  const head = columns.map((c) => `<th>${c}</th>`).join('');
  const body = rows.map((row) => `<tr>${columns.map((c) => `<td>${row[c] ?? '—'}</td>`).join('')}</tr>`).join('');

  return `<section class="stack"><h2>${title}</h2><article class="card overflow-x"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></article></section>`;
}

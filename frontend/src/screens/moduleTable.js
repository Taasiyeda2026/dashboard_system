import { api } from '../api/client.js';

function toDisplayValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export async function renderModuleTable(moduleId, moduleTitle) {
  const root = document.createElement('div');
  root.className = 'screen';
  root.innerHTML = `<section class="card">טוען ${moduleTitle}...</section>`;

  try {
    const result = await api.getModuleData(moduleId);
    const headers = result.schema?.internal_headers || [];
    const display = result.schema?.display_headers || headers;
    const rows = result.rows || [];

    if (!rows.length) {
      root.innerHTML = `<section class="card"><h2>${moduleTitle}</h2><div>אין נתונים להצגה</div></section>`;
      return root;
    }

    const headerHtml = headers
      .map((key, index) => `<th title="${key}">${display[index] || key}</th>`)
      .join('');

    const bodyHtml = rows.slice(0, 200).map((row) => {
      const cols = headers.map((key) => `<td>${toDisplayValue(row[key])}</td>`).join('');
      return `<tr>${cols}</tr>`;
    }).join('');

    root.innerHTML = `
      <section class="card">
        <h2>${moduleTitle}</h2>
        <div class="muted">${rows.length} שורות מוצגות</div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>${headerHtml}</tr></thead>
            <tbody>${bodyHtml}</tbody>
          </table>
        </div>
      </section>
    `;
  } catch (err) {
    root.innerHTML = `<section class="card error">${err.message}</section>`;
  }

  return root;
}

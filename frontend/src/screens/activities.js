import { escapeHtml } from './shared/html.js';

const tabs = ['all', 'course', 'after_school', 'workshop', 'tour', 'escape_room'];

export const activitiesScreen = {
  load: ({ api, state }) => api.activities({ activity_type: state.activityTab || 'all' }),
  render(data, { state }) {
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];
    const canSeePrivateNotes = state?.user?.role === 'operations_reviewer';
    const compactView = state?.activityView === 'compact';

    const tableRows = safeRows.map((row) => `
      <tr>
        <td>${escapeHtml(row.RowID)}</td>
        <td>${escapeHtml(row.activity_type)}</td>
        <td>${escapeHtml(row.activity_name || '—')}</td>
        <td>${escapeHtml(row.start_date || '—')}</td>
        <td>${escapeHtml(row.end_date || '—')}</td>
        <td>${escapeHtml(row.emp_id || '—')}</td>
        <td>${escapeHtml(row.emp_id_2 || '—')}</td>
        <td>${escapeHtml(row.finance_status || 'open')}</td>
        ${canSeePrivateNotes ? `<td>${escapeHtml(row.private_note || '')}</td>` : ''}
      </tr>
    `).join('');

    const compactRows = safeRows.map((row) => `
      <article class="card compact-row">
        <header>${escapeHtml(row.RowID)} • ${escapeHtml(row.activity_type)}</header>
        <p>${escapeHtml(row.activity_name || 'Untitled activity')}</p>
        <small>${escapeHtml(row.start_date || '—')} → ${escapeHtml(row.end_date || '—')}</small>
      </article>
    `).join('');

    return `
      <section class="stack">
        <h2>Activities</h2>
        <div class="tabs">
          ${tabs.map((tab) => `<button class="btn chip ${tab === (state.activityTab || 'all') ? 'is-active' : ''}" data-tab="${tab}">${tab}</button>`).join('')}
        </div>
        <div class="toolbar">
          <label><input id="toggle-view" type="checkbox" ${compactView ? 'checked' : ''} /> Compact view</label>
        </div>
        ${compactView
          ? `<div class="stack">${compactRows || '<article class="card">No activities found for this filter.</article>'}</div>`
          : `<div class="card overflow-x">
              <table>
                <thead><tr><th>RowID</th><th>Type</th><th>Name</th><th>Start</th><th>End</th><th>Instructor 1 (emp_id)</th><th>Instructor 2 (emp_id)</th><th>Finance</th>${canSeePrivateNotes ? '<th>Private Note</th>' : ''}</tr></thead>
                <tbody>${tableRows || `<tr><td colspan="${canSeePrivateNotes ? 9 : 8}">No activities found for this filter.</td></tr>`}</tbody>
              </table>
            </div>`}
      </section>
    `;
  },
  bind({ root, state, rerender }) {
    root.querySelectorAll('[data-tab]').forEach((node) => {
      node.addEventListener('click', () => {
        state.activityTab = node.dataset.tab;
        rerender();
      });
    });
    root.querySelector('#toggle-view')?.addEventListener('change', (event) => {
      state.activityView = event.target.checked ? 'compact' : 'table';
      rerender();
    });
  }
};

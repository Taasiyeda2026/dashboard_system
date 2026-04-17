const tabs = ['all', 'course', 'after_school', 'workshop', 'tour', 'escape_room'];

export function activitiesScreen(data, canSeePrivateNotes) {
  const safeRows = Array.isArray(data?.rows) ? data.rows : [];
  const rows = safeRows.map((row) => `
    <tr>
      <td>${row.RowID}</td>
      <td>${row.activity_type}</td>
      <td>${row.activity_name || '—'}</td>
      <td>${row.start_date || '—'}</td>
      <td>${row.end_date || '—'}</td>
      <td>${row.emp_id || '—'}</td>
      <td>${row.emp_id_2 || '—'}</td>
      <td>${row.finance_status || 'open'}</td>
      ${canSeePrivateNotes ? `<td>${row.private_note || ''}</td>` : ''}
    </tr>
  `).join('');

  const compact = safeRows.map((row) => `
    <article class="card compact-row">
      <header>${row.RowID} • ${row.activity_type}</header>
      <p>${row.activity_name || 'Untitled activity'}</p>
      <small>${row.start_date || '—'} → ${row.end_date || '—'}</small>
    </article>
  `).join('');

  return `
    <section class="stack">
      <h2>Activities</h2>
      <div id="activity-tabs" class="tabs">
        ${tabs.map((tab) => `<button class="btn chip" data-tab="${tab}">${tab}</button>`).join('')}
      </div>
      <div class="toolbar">
        <label><input id="toggle-view" type="checkbox" /> Compact view</label>
      </div>
      <div id="activities-table-wrap" class="card overflow-x">
        <table>
          <thead><tr><th>RowID</th><th>Type</th><th>Name</th><th>Start</th><th>End</th><th>Instructor 1 (emp_id)</th><th>Instructor 2 (emp_id)</th><th>Finance</th>${canSeePrivateNotes ? '<th>Private Note</th>' : ''}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${canSeePrivateNotes ? 9 : 8}">No activities found for this filter.</td></tr>`}</tbody>
        </table>
      </div>
      <div id="activities-compact" class="hidden">${compact || '<article class="card compact-row">No activities found for this filter.</article>'}</div>
    </section>
  `;
}

export function bindActivities(onTab) {
  document.getElementById('activity-tabs')?.addEventListener('click', (event) => {
    const tab = event.target?.dataset?.tab;
    if (tab) onTab(tab);
  });

  document.getElementById('toggle-view')?.addEventListener('change', (event) => {
    document.getElementById('activities-table-wrap')?.classList.toggle('hidden', event.target.checked);
    document.getElementById('activities-compact')?.classList.toggle('hidden', !event.target.checked);
  });
}

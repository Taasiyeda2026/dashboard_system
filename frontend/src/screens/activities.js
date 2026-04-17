const tabs = ['all', 'course', 'after_school', 'workshop', 'tour', 'escape_room'];

export function activitiesScreen(data, canSeePrivateNotes) {
  const rows = data.rows.map((row) => `
    <tr>
      <td>${row.row_id}</td>
      <td>${row.activity_type}</td>
      <td>${row.title || '—'}</td>
      <td>${row.start_date || '—'}</td>
      <td>${row.end_date || '—'}</td>
      <td>${row.instructor_1 || '—'}</td>
      <td>${row.instructor_2 || '—'}</td>
      <td>${row.finance_status || 'open'}</td>
      ${canSeePrivateNotes ? `<td>${row.private_note || ''}</td>` : ''}
    </tr>
  `).join('');

  const compact = data.rows.map((row) => `
    <article class="card compact-row">
      <header>${row.row_id} • ${row.activity_type}</header>
      <p>${row.title || 'Untitled activity'}</p>
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
          <thead><tr><th>ID</th><th>Type</th><th>Title</th><th>Start</th><th>End</th><th>Instructor 1</th><th>Instructor 2</th><th>Finance</th>${canSeePrivateNotes ? '<th>Private Note</th>' : ''}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div id="activities-compact" class="hidden">${compact}</div>
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

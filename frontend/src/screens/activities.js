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
    `;

    const tableRows = rows.map((row) => `<tr>
      <td>${escapeHtml(row.row_id)}</td><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.activity_type)}</td><td>${escapeHtml(row.start_date)}</td>
      <td>${escapeHtml(row.end_date)}</td><td>${escapeHtml(row.instructor_1)}</td><td>${escapeHtml(row.instructor_2)}</td><td>${escapeHtml(row.finance_status)}</td>
      <td><button class="small" data-edit-id="${row.row_id}">${canDirect ? 'Edit' : 'Request Edit'}</button></td>
    </tr>`).join('');
    const compactRows = rows.map((row) => `<article class="panel mini-card">
      <h4>${escapeHtml(row.title)} · ${escapeHtml(row.row_id)}</h4>
      <p>${escapeHtml(row.activity_type)} | ${escapeHtml(row.start_date)} → ${escapeHtml(row.end_date)}</p>
      <p>Manager: ${escapeHtml(row.activity_manager)} | Finance: ${escapeHtml(row.finance_status)}</p>
      ${state.user.role === 'operations_reviewer' ? `<p><strong>Private:</strong> ${escapeHtml(row.private_note)}</p><button class="small" data-note-id="${row.row_id}">Edit private note</button>` : ''}
      <button class="small" data-edit-id="${row.row_id}">${canDirect ? 'Edit' : 'Request Edit'}</button>
    </article>`).join('');

    return `
      <section class="panel"><h2>Activities</h2>${controls}${state.activityView === 'table'
        ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Title</th><th>Type</th><th>Start</th><th>End</th><th>Instructor 1</th><th>Instructor 2</th><th>Finance</th><th></th></tr></thead><tbody>${tableRows}</tbody></table></div>`
        : `<div class="stack">${compactRows}</div>`}
      </section>
    `;
  },
  bind({ root, data, state, api, rerender }) {
    root.querySelectorAll('[data-tab]').forEach((node) => {
      node.addEventListener('click', () => {
        state.activityTab = node.dataset.tab;
        rerender();
      });
    });

    root.querySelector('#financeFilter')?.addEventListener('change', (event) => {
      state.financeFilter = event.target.value;
      rerender();
    });

    root.querySelector('#tableViewBtn')?.addEventListener('click', () => {
      state.activityView = 'table';
      rerender();
    });
    root.querySelector('#compactViewBtn')?.addEventListener('click', () => {
      state.activityView = 'compact';
      rerender();
    });

    root.querySelectorAll('[data-edit-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const row = (data.rows || []).find((item) => item.row_id === button.dataset.editId);
        if (!row) return;
        const newTitle = prompt('Title', row.title);
        if (newTitle === null) return;
        try {
          await api.saveActivity(row.row_id, { title: newTitle });
          await rerender();
        } catch (error) {
          alert(error.message);
        }
      });
    });

    root.querySelector('#addActivityBtn')?.addEventListener('click', async () => {
      const target = prompt('Target sheet: data_short or data_long', 'data_short');
      if (!target) return;
      const title = prompt('Title', '');
      const activityType = prompt('Activity type', target === 'data_long' ? 'course' : 'workshop');
      const startDate = prompt('Start date (YYYY-MM-DD)', '');
      const instructor1 = prompt('Instructor 1 id', '');
      const instructor2 = target === 'data_short' ? prompt('Instructor 2 id (optional)', '') : '';
      const meetings = target === 'data_long' ? (prompt('Meetings comma separated YYYY-MM-DD', '') || '').split(',').map((v) => v.trim()).filter(Boolean) : [];
      try {
        await api.addActivity(target, {
          title,
          activity_type: activityType,
          start_date: startDate,
          instructor_1: instructor1,
          instructor_2: instructor2,
          activity_manager: state.user.name,
          finance_status: 'open',
          active: 'yes',
          meetings
        });
        await rerender();
      } catch (error) {
        alert(error.message);
      }
    });

    root.querySelectorAll('[data-note-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const row = (data.rows || []).find((item) => item.row_id === button.dataset.noteId);
        const note = prompt('Private note', row?.private_note || '');
        if (note === null) return;
        await api.savePrivateNote(button.dataset.noteId, note);
        await rerender();
      });
    });
  }
};

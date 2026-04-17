import { escapeHtml } from './shared/html.js';

export const activitiesScreen = {
  load: ({ api, state }) => api.activities({ activity_type: state.activityTab, finance_status: state.financeFilter }),
  render(data, { state }) {
    const rows = data.rows || [];
    const canDirect = ['admin', 'operations_reviewer'].includes(state.user.role);
    const tabs = ['all', 'course', 'after_school', 'workshop', 'tour', 'escape_room']
      .map((tab) => `<button data-tab="${tab}" class="small ${tab === state.activityTab ? 'is-active' : ''}">${tab}</button>`).join('');

    const controls = `
      <div class="controls">
        <div class="inline">${tabs}</div>
        <div class="inline">
          <button id="tableViewBtn" class="small ${state.activityView === 'table' ? 'is-active' : ''}">Table</button>
          <button id="compactViewBtn" class="small ${state.activityView === 'compact' ? 'is-active' : ''}">Compact</button>
        </div>
        <select id="financeFilter">
          <option value="">All finance statuses</option>
          <option value="open" ${state.financeFilter === 'open' ? 'selected' : ''}>open</option>
          <option value="closed" ${state.financeFilter === 'closed' ? 'selected' : ''}>closed</option>
        </select>
        ${canDirect ? '<button id="addActivityBtn" class="small">+ Add Activity</button>' : ''}
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

function toTable(title, columns, rows) {
  const head = columns.map((c) => `<th>${c}</th>`).join('');
  const body = rows.map((row) => `<tr>${columns.map((c) => `<td>${row[c] ?? '—'}</td>`).join('')}</tr>`).join('');
  return `<section class="stack"><h2>${title}</h2><article class="card overflow-x"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></article></section>`;
}

export const financeScreen = (data) => toTable('Finance', ['row_id', 'title', 'finance_status', 'active'], data.rows);
export const instructorsScreen = (data) => toTable('Instructors', ['instructor_id', 'full_name', 'direct_manager', 'active'], data.rows);
export const contactsScreen = (data) => toTable('Contacts', ['kind', 'name', 'phone', 'email'], data.rows);
export const myDataScreen = (data) => toTable('My Data', ['row_id', 'title', 'start_date', 'end_date', 'activity_type'], data.rows);
export const permissionsScreen = (data) => toTable('Permissions', ['user_id', 'name', 'role', 'active'], data.rows);

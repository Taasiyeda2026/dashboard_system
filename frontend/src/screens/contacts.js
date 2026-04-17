import { escapeHtml } from './shared/html.js';

export function contactsScreen(data) {
  return renderTableScreen({
    title: 'Contacts',
    columns: ['kind', 'emp_id', 'full_name', 'authority', 'school', 'contact_name', 'phone', 'mobile', 'email'],
    rows: data.rows
  });
}

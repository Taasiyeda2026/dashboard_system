import { renderTableScreen } from './shared/table.js';

export function contactsScreen(data) {
  return renderTableScreen({
    title: 'Contacts',
    columns: ['kind', 'name', 'phone', 'email'],
    rows: data.rows
  });
}

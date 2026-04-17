import { renderTableScreen } from './shared/table.js';

export function permissionsScreen(data) {
  return renderTableScreen({
    title: 'Permissions',
    columns: ['user_id', 'name', 'role', 'active'],
    rows: data.rows
  });
}

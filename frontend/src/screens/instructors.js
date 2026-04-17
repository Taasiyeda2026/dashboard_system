import { renderTableScreen } from './shared/table.js';

export function instructorsScreen(data) {
  return renderTableScreen({
    title: 'Instructors',
    columns: ['emp_id', 'full_name', 'mobile', 'email', 'employment_type', 'direct_manager', 'active'],
    rows: data.rows
  });
}

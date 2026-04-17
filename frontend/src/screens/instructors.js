import { renderTableScreen } from './shared/table.js';

export function instructorsScreen(data) {
  return renderTableScreen({
    title: 'Instructors',
    columns: ['instructor_id', 'full_name', 'direct_manager', 'active'],
    rows: data.rows
  });
}

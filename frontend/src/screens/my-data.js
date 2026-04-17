import { renderTableScreen } from './shared/table.js';

export function myDataScreen(data) {
  return renderTableScreen({
    title: 'My Data',
    columns: ['row_id', 'title', 'start_date', 'end_date', 'activity_type'],
    rows: data.rows
  });
}

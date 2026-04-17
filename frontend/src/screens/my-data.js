import { escapeHtml } from './shared/html.js';

export function myDataScreen(data) {
  return renderTableScreen({
    title: 'My Data',
    columns: ['RowID', 'activity_name', 'start_date', 'end_date', 'activity_type'],
    rows: data.rows
  });
}

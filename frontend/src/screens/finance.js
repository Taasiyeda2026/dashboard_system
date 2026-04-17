import { renderTableScreen } from './shared/table.js';

export function financeScreen(data) {
  return renderTableScreen({
    title: 'Finance',
    columns: ['RowID', 'activity_name', 'finance_status', 'status'],
    rows: data.rows
  });
}

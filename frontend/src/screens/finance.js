import { renderTableScreen } from './shared/table.js';

export function financeScreen(data) {
  return renderTableScreen({
    title: 'Finance',
    columns: ['row_id', 'title', 'finance_status', 'active'],
    rows: data.rows
  });
}

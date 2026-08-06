import { escapeHtml } from './shared/html.js';
import {
  buildWorkshopTrainingMatrix as buildWorkshopTrainingMatrixModel
} from './operations-2027-loading-controller.js';

// Compatibility entry for the existing feature loader and focused contract tests.
// The active Operations 2027 UI and loading lifecycle are owned by one controller.
export function buildWorkshopTrainingMatrix(input = {}) {
  const model = buildWorkshopTrainingMatrixModel(input);
  return { ...model, rows: model.instructors };
}

export function matrixTableHtml({
  rows = [],
  instructors = [],
  rowLabel = (row) => row,
  cellHtml = () => '',
  firstColumnLabel = 'שם קורס',
  orientation = 'rows-first',
  columnLabel = (name) => name
} = {}) {
  if (!instructors.length || !rows.length) return '<div class="ops2027-empty">אין נתונים להצגה.</div>';
  const head = instructors
    .map((name) => `<th class="ops2027-instructor-col"><span class="ops2027-instructor-name">${escapeHtml(columnLabel(name))}</span></th>`)
    .join('');
  const body = rows
    .map((row) => `<tr><td class="ops2027-course-col">${escapeHtml(rowLabel(row))}</td>${instructors.map((name) => `<td class="ops2027-instructor-col">${cellHtml(row, name)}</td>`).join('')}</tr>`)
    .join('');
  const firstClass = orientation === 'instructors-first' ? 'ops2027-instructor-col' : 'ops2027-course-col';
  const tableAttributes = orientation === 'instructors-first' ? ' data-ops-matrix-transposed="1"' : '';
  return `<div class="ops2027-table-shell"><table class="ops2027-table"${tableAttributes}><thead><tr><th class="${firstClass}">${escapeHtml(firstColumnLabel)}</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../frontend/src/screens/personal-reports.js', import.meta.url);

async function source() {
  return readFile(sourceUrl, 'utf8');
}

test('reported leave replaces full-month label in personal and management summaries', async () => {
  const text = await source();

  assert.match(text, /function monthlyWorkStatusFromTotals\(workDays, absences = \{\}\)/);
  assert.match(text, /function myReportSummaryHtml[\s\S]*monthlyWorkStatusFromTotals\(workDays, absences\)/);
  assert.match(text, /const workDaysLabel = monthlyWorkStatusFromTotals\(row\.workDays, row\.absences \|\| \{\}\)/);
  assert.match(text, /from\('absence_entries'\)\.select\('report_id, absence_type, start_date, end_date'\)/);
  assert.match(text, /absenceTotals:/);
});

test('PDF declaration or absence total excludes vacation days', async () => {
  const text = await source();

  assert.match(text, /const totalOtherAbsenceDays = totalSickDays \+ totalDeclarationDays;/);
  assert.match(text, /printSummaryBox\('ימי הצהרה \/ היעדרות', `\$\{fmtNum\(totalDeclarationDays\)\} \/ \$\{fmtNum\(totalOtherAbsenceDays\)\}`\)/);
  assert.doesNotMatch(text, /const totalAbsenceDays = totalVacationDays \+ totalSickDays \+ totalDeclarationDays;/);
});

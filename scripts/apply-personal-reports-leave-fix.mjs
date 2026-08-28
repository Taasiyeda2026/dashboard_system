import { readFile, writeFile } from 'node:fs/promises';

const reportsPath = new URL('../frontend/src/screens/personal-reports.js', import.meta.url);
const testsPath = new URL('../tests/personal-reports-screen.test.mjs', import.meta.url);
const swPath = new URL('../frontend/sw.js', import.meta.url);

function replaceOnce(source, oldText, newText, label) {
  const index = source.indexOf(oldText);
  if (index < 0) throw new Error(`Missing replacement target: ${label}`);
  if (source.indexOf(oldText, index + oldText.length) >= 0) {
    throw new Error(`Replacement target is not unique: ${label}`);
  }
  return source.replace(oldText, newText);
}

function replaceAllExpected(source, oldText, newText, label, minCount = 1) {
  const count = source.split(oldText).length - 1;
  if (count < minCount) throw new Error(`Missing replacement target: ${label} (found ${count})`);
  return { source: source.split(oldText).join(newText), count };
}

let source = await readFile(reportsPath, 'utf8');

const monthlyWorkStatusBlock = `function monthlyWorkStatusText(absences = []) {
  const vacation = sumAbsenceDays(absences, 'vacation');
  const sick = sumAbsenceDays(absences, 'sick');
  const declaration = sumAbsenceDays(absences, 'declaration');
  const parts = [
    vacation > 0 ? \`חופש: \${fmtNum(vacation)} ימים\` : '',
    sick > 0 ? \`מחלה: \${fmtNum(sick)} ימים\` : '',
    declaration > 0 ? \`הצהרה: \${fmtNum(declaration)} ימים\` : ''
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'חודש עבודה מלא';
}`;

const monthlyWorkStatusReplacement = `${monthlyWorkStatusBlock}

function monthlyWorkStatusFromTotals(absences = {}) {
  const vacation = Number(absences?.vacation || 0);
  const sick = Number(absences?.sick || 0);
  const declaration = Number(absences?.declaration || 0);
  const parts = [
    vacation > 0 ? \`חופש: \${fmtNum(vacation)} ימים\` : '',
    sick > 0 ? \`מחלה: \${fmtNum(sick)} ימים\` : '',
    declaration > 0 ? \`הצהרה: \${fmtNum(declaration)} ימים\` : ''
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'חודש מלא';
}`;

source = replaceOnce(source, monthlyWorkStatusBlock, monthlyWorkStatusReplacement, 'monthly leave totals helper');

source = replaceOnce(
  source,
  `function myReportSummaryHtml(totals = {}, workDays = null, absences = {}) {
  const workDaysLabel = workDays === null || workDays === undefined || workDays === ''
    ? 'חודש מלא'
    : fmtNum(workDays);`,
  `function myReportSummaryHtml(totals = {}, workDays = null, absences = {}) {
  const workDaysLabel = workDays === null || workDays === undefined || workDays === ''
    ? monthlyWorkStatusFromTotals(absences)
    : fmtNum(workDays);`,
  'personal report summary full-month fallback'
);

source = replaceOnce(
  source,
  `  const [travelRes, publicTravelRes, expensesRes] = await Promise.all([
    supabase.from('declared_travel_entries').select('report_id, amount').in('report_id', ids),
    supabase.from('public_transport_entries').select('report_id, amount').in('report_id', ids),
    supabase.from('expense_entries').select('report_id, amount').in('report_id', ids)
  ]);`,
  `  const [travelRes, publicTravelRes, expensesRes, absencesRes] = await Promise.all([
    supabase.from('declared_travel_entries').select('report_id, amount').in('report_id', ids),
    supabase.from('public_transport_entries').select('report_id, amount').in('report_id', ids),
    supabase.from('expense_entries').select('report_id, amount').in('report_id', ids),
    supabase.from('absence_entries').select('report_id, absence_type, start_date, end_date').in('report_id', ids)
  ]);`,
  'admin report batch absence query'
);

source = replaceOnce(
  source,
  `  if (expensesRes.error) throw expensesRes.error;`,
  `  if (expensesRes.error) throw expensesRes.error;
  if (absencesRes.error) throw absencesRes.error;`,
  'admin report absence query error handling'
);

source = replaceOnce(
  source,
  `  for (const row of expensesRes.data || []) totals.get(row.report_id).expenses += Number(row.amount || 0);
  return reports.map((report) => {
    const t = totals.get(report.id) || { travel: 0, expenses: 0 };
    return { ...report, totals: { ...t, all: t.travel + t.expenses } };
  });`,
  `  for (const row of expensesRes.data || []) totals.get(row.report_id).expenses += Number(row.amount || 0);

  const absenceTotals = new Map(ids.map((id) => [id, { vacation: 0, sick: 0, declaration: 0 }]));
  for (const row of absencesRes.data || []) {
    const totalsForReport = absenceTotals.get(row.report_id);
    if (!totalsForReport || !Object.prototype.hasOwnProperty.call(totalsForReport, row.absence_type)) continue;
    totalsForReport[row.absence_type] += calculatedAbsenceDays(row);
  }

  return reports.map((report) => {
    const t = totals.get(report.id) || { travel: 0, expenses: 0 };
    return {
      ...report,
      totals: { ...t, all: t.travel + t.expenses },
      absenceTotals: absenceTotals.get(report.id) || { vacation: 0, sick: 0, declaration: 0 }
    };
  });`,
  'attach absence totals to admin report rows'
);

source = replaceOnce(
  source,
  `    const workDaysLabel = row.workDays === null || row.workDays === undefined || row.workDays === ''
      ? 'חודש מלא'
      : fmtNum(row.workDays);`,
  `    const workDaysLabel = row.workDays === null || row.workDays === undefined || row.workDays === ''
      ? monthlyWorkStatusFromTotals(report?.absenceTotals || {})
      : fmtNum(row.workDays);`,
  'management table full-month fallback'
);

for (const [oldText, newText, label, minCount] of [
  [
    `  const workDaysLabel = report.work_days_in_month === null || report.work_days_in_month === undefined
    ? 'חודש מלא'
    : fmtNum(Number(report.work_days_in_month));`,
    `  const workDaysLabel = report.work_days_in_month === null || report.work_days_in_month === undefined
    ? monthlyWorkStatusText(absences)
    : fmtNum(Number(report.work_days_in_month));`,
    'multiline report detail/print full-month fallback',
    1
  ],
  [
    `  const workDaysLabel = report.work_days_in_month === null || report.work_days_in_month === undefined ? 'חודש מלא' : fmtNum(Number(report.work_days_in_month));`,
    `  const workDaysLabel = report.work_days_in_month === null || report.work_days_in_month === undefined ? monthlyWorkStatusText(absences) : fmtNum(Number(report.work_days_in_month));`,
    'inline report detail/print full-month fallback',
    1
  ],
  [
    `  const totalAbsenceDays = totalVacationDays + totalSickDays + totalDeclarationDays;`,
    `  const totalAbsenceDays = totalSickDays + totalDeclarationDays;`,
    'PDF absence total excludes vacation',
    1
  ]
]) {
  const result = replaceAllExpected(source, oldText, newText, label, minCount);
  source = result.source;
}

await writeFile(reportsPath, source);

let tests = await readFile(testsPath, 'utf8');
const regressionMarker = "reported leave is never rendered as a full month and vacation is not double-counted in PDF absence totals";
if (!tests.includes(regressionMarker)) {
  tests += `\n\ntest('${regressionMarker}', async () => {\n  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');\n\n  assert.match(source, /function monthlyWorkStatusFromTotals/);\n  assert.match(source, /\\? monthlyWorkStatusFromTotals\\(absences\\)/);\n  assert.match(source, /\\? monthlyWorkStatusFromTotals\\(report\\?\\.absenceTotals \\|\\| \\{\\}\\)/);\n  assert.match(source, /from\\('absence_entries'\\)\\.select\\('report_id, absence_type, start_date, end_date'\\)/);\n  assert.match(source, /absenceTotals: absenceTotals\\.get\\(report\\.id\\)/);\n  assert.doesNotMatch(source, /totalVacationDays \\+ totalSickDays \\+ totalDeclarationDays/);\n  assert.match(source, /const totalAbsenceDays = totalSickDays \\+ totalDeclarationDays;/);\n});\n`;
  await writeFile(testsPath, tests);
}

let sw = await readFile(swPath, 'utf8');
const versionMatch = sw.match(/const CACHE_VERSION = (\d+);/);
if (!versionMatch) throw new Error('frontend service worker cache version not found');
const nextVersion = Number(versionMatch[1]) + 1;
sw = sw.replace(versionMatch[0], `const CACHE_VERSION = ${nextVersion};`);
await writeFile(swPath, sw);

console.log('Applied personal reports leave-day fix and bumped cache to', nextVersion);

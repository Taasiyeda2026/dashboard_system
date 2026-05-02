import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const schema = JSON.parse(fs.readFileSync(path.resolve('scripts/sheet-schema.json'), 'utf8'));
const withSampleData = process.argv.includes('--with-sample-data');
const wb = XLSX.utils.book_new();

for (const spec of schema.sheets) {
  if (!spec.required) continue;
  const headers = spec.headers || [];
  const labels = spec.hebrewLabels || [];
  if (
    headers.length === 0 &&
    spec.type !== 'documentation' &&
    !(spec.type === 'source' && spec.allowEmptyHeaders === true)
  ) {
    throw new Error(`Required sheet "${spec.sheetName}" has empty headers`);
  }
  const rows = [headers, labels.length ? labels : new Array(headers.length).fill('')];
  if (withSampleData && (spec.type === 'snapshot' || spec.type === 'view')) rows.push(new Array((spec.headers || []).length).fill(''));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!freeze'] = { xSplit: 0, ySplit: 2 };
  ws['!cols'] = (spec.headers || []).map(() => ({ wch: 22 }));
  ws['!rtl'] = true;
  XLSX.utils.book_append_sheet(wb, ws, spec.sheetName);
}

fs.mkdirSync('generated', { recursive: true });
const out = 'generated/system-dashboard-template.xlsx';
XLSX.writeFile(wb, out);
const emptyHeaderSheets = schema.sheets.filter((s) => s.required && (!s.headers || s.headers.length === 0)).map((s) => s.sheetName);
console.log(JSON.stringify({ sheetsCreated: wb.SheetNames.length, sheetsWithEmptyHeaders: emptyHeaderSheets, outputPath: out }, null, 2));

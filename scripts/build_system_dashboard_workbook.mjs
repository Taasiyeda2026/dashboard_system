import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const schema = JSON.parse(fs.readFileSync(path.resolve('scripts/sheet-schema.json'), 'utf8'));
const withSampleData = process.argv.includes('--with-sample-data');
const wb = XLSX.utils.book_new();

for (const spec of schema.sheets) {
  if (!spec.required) continue;
  const rows = [spec.headers || [], spec.hebrewLabels || []];
  if (withSampleData && (spec.type === 'snapshot' || spec.type === 'view')) rows.push(new Array((spec.headers || []).length).fill(''));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!freeze'] = { xSplit: 0, ySplit: 2 };
  ws['!cols'] = (spec.headers || []).map(() => ({ wch: 22 }));
  ws['!rtl'] = true;
  XLSX.utils.book_append_sheet(wb, ws, spec.sheetName);
}

fs.mkdirSync('generated', { recursive: true });
XLSX.writeFile(wb, 'generated/system-dashboard-template.xlsx');
console.log('generated/system-dashboard-template.xlsx');

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../frontend/src/manager-weekly-manual-tracking.js', import.meta.url), 'utf8');
// Evaluate business rules in isolation: the real module imports browser state and Supabase.
const isolatedSource = source.replace(/^import\s+.*?;\s*$/gm, '').replace(/^export /gm, '');
const { weekStartIso, shiftWeek, validateWeeklyReport } =
  runInNewContext(isolatedSource + '\n({weekStartIso, shiftWeek, validateWeeklyReport})', { Date });

const keys = ['activities','schools','unassigned','planned','started'];
function validReport(overrides = {}) {
  return {
    week_start: '2026-10-18',
    metrics: Object.fromEntries(keys.map((k) => [k, k === 'planned' ? 1 : 0])),
    openings: [{
      authority: 'רחובות', school: 'קציר', program: 'ביומימיקרי',
      start_date: '2026-10-20', instructor: 'מדריכה לדוגמה'
    }],
    highlights: 'בוצע תיאום עם בית הספר',
    next_steps: 'לוודא שהערכה מגיעה עד יום ראשון',
    ...overrides
  };
}

test('weeks follow Israeli Sunday-to-Saturday calendar', () => {
  assert.equal(weekStartIso('2026-10-19'), '2026-10-18');
  assert.equal(weekStartIso('2026-10-24'), '2026-10-18');
  assert.equal(shiftWeek('2026-10-18', 1), '2026-10-25');
  assert.equal(shiftWeek('2026-10-18', -1), '2026-10-11');
});

test('complete manually entered submission is valid', () => {
  assert.equal(validateWeeklyReport(validReport()), '');
});

test('weekly submission requires all quantitative metrics', () => {
  const data = validReport();
  delete data.metrics.schools;
  assert.match(validateWeeklyReport(data), /בתי ספר/);
});

test('old opening details and summaries are no longer required for metric submission',()=>{
  assert.equal(validateWeeklyReport(validReport({openings:[],highlights:'',next_steps:''})),'');
});
test('hidden historic training, kits, materials and issues metrics are not required',()=>{
  const report=validReport();
  for(const key of ['training','materials','kits','issues']) delete report.metrics[key];
  assert.equal(validateWeeklyReport(report),'');
});
test('negative or non-integer core metrics are rejected',()=>{
  const report=validReport();
  report.metrics.activities=-1;
  assert.match(validateWeeklyReport(report),/פעילויות/);
  report.metrics.activities=2.5;
  assert.match(validateWeeklyReport(report),/פעילויות/);
});

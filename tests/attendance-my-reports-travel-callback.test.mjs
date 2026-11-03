import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('my reports forwards travel action through initial load, async loader and refresh',async()=>{
  const file=await readFile(new URL('../attendance/src/screens/my-reports-screen.js',import.meta.url),'utf8');
  assert.match(file,/onTravelReport,\s*onDuplicate,\s*\} = \{\}\)/);
  assert.match(file,/loadAndRender\(\{ instructor, year, month, contentArea, toolbar, onNewReport, onTravelReport, onDuplicate \}\)/);
  assert.match(file,/async function loadAndRender\(\{ instructor, year, month, contentArea, toolbar, onNewReport, onTravelReport, onDuplicate \}\)/);
  assert.match(file,/const onRefresh = \(\) => loadAndRender\(\{ instructor, year, month, contentArea, toolbar, onNewReport, onTravelReport, onDuplicate \}\)/);
  assert.match(file,/onTravelReport\(record\.report_date\)/);
});

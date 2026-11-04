import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('expense form is compact, uses date-derived reporting month, and has save/cancel only',async()=>{
  const ui=await readFile(new URL('../attendance/src/screens/expenses-tab.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../attendance/src/styles/new-report-final-alignment.css',import.meta.url),'utf8');
  assert.doesNotMatch(ui,/monthSelect|av2-expense-month-select/);
  assert.ok(ui.includes("selectedMonth=(date.input.value||todayLocal()).slice(0,7)"));
  assert.ok(ui.includes('fieldsRow.append(date.wrap,amount.wrap)'));
  assert.ok(ui.includes("save.textContent='שמירה'"));
  assert.ok(ui.includes("reset.textContent='ביטול'"));
  assert.ok(ui.includes("resetForm({resetDate:true})"));
  assert.ok(ui.includes("if(hasChanges && !window.confirm("));
  assert.ok(ui.includes('form.hidden=false'));
  assert.ok(ui.includes('save.disabled=historicalView'));
  assert.match(css,/max-width:480px/);
  assert.match(css,/width:110px/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as XLSX from 'xlsx';
import {buildCorrectedAttendanceWorkbook} from '../frontend/src/screens/attendance-control.js';

test('new report has three independent tabs; expenses do not attach to attendance',async()=>{
 const src=await readFile(new URL('../attendance/src/screens/new-report-screen.js',import.meta.url),'utf8');
 assert.ok(src.includes("expenseTab.textContent = 'הוצאות'"));
 assert.ok(src.includes('tabs.append(attendanceTab, travelTab, expenseTab)'));
 assert.ok(src.includes('expensesPanel.panel.hidden = !isExpenses'));
 assert.ok(src.includes('expensesPanel.load()'));
 assert.ok(src.includes('formArea.append(tabs,form,dailyTravel.panel,expensesPanel.panel)'));
 assert.ok(src.includes('[timesGrid]'));
 assert.ok(!src.includes('[timesGrid, expensesInner]'));
 assert.ok(src.includes('expenses: 0'));
 assert.ok(src.includes('expense_details: null'));
});

test('standalone expenses have separate save, date, details, receipts, edits and no activity dependency',async()=>{
 const ui=await readFile(new URL('../attendance/src/screens/expenses-tab.js',import.meta.url),'utf8');
 const service=await readFile(new URL('../attendance/src/services/expense-reports.service.js',import.meta.url),'utf8');
 assert.ok(ui.includes("saveExpenseReport({"));
 assert.ok(ui.includes('attachExpenseReceipt({'));
 assert.ok(ui.includes('fileInput.multiple=true'));
 assert.ok(ui.includes("listExpenseReports({fromDate:first,toDate:last"));
 assert.ok(ui.includes("amount.input.value=row.amount") || ui.includes("amount.input.value=String(row.amount)"));
 assert.ok(!ui.includes('activityId'));
 assert.ok(service.includes("av2_save_expense"));
 assert.ok(service.includes("av2_list_expenses"));
 assert.ok(service.includes("av2_expense_attachment_add"));
});

test('approved expenses count once in manager monthly Excel, with a dedicated receipt tab',()=>{
 const items=[
  {id:'a',emp_id:1503,employee_name:'מדריכה א',employment_type:'תעשיידע',
    expense_date:'2026-11-04',amount:125,approved_amount:120,details:'ציוד לשתי פעילויות',
    review_status:'approved',attachments:[{file_name:'קבלה.pdf'}]},
  {id:'b',emp_id:1503,employee_name:'מדריכה א',employment_type:'תעשיידע',
    expense_date:'2026-11-04',amount:50,approved_amount:null,details:'אביזר',
    review_status:'pending_review',attachments:[]}
 ];
 const book=buildCorrectedAttendanceWorkbook([],[],{expenseReports:items});
 assert.ok(book.SheetNames.includes('הוצאות'));
 const rows=XLSX.utils.sheet_to_json(book.Sheets['הוצאות'],{header:1});
 const header=rows[0];
 assert.equal(rows[1][header.indexOf('סכום מאושר (₪)')],120);
 assert.equal(rows[2][header.indexOf('סכום מאושר (₪)')],'');
 assert.equal(rows[1][header.indexOf('מסמכים')],'קבלה.pdf');
 const monthly=XLSX.utils.sheet_to_json(book.Sheets['סיכום חודשי'],{header:1});
 assert.equal(monthly[1][monthly[0].indexOf('הוצאות')],120);
});

test('manager/admin review expenses separately without making them attendance records',async()=>{
 const src=await readFile(new URL('../frontend/src/screens/attendance-control.js',import.meta.url),'utf8');
 const bridge=await readFile(new URL('../frontend/src/payroll-attendance-v2-bridge.js',import.meta.url),'utf8');
 assert.ok(src.includes('api.attendanceControlExpenseReports'));
 assert.ok(src.includes('api.attendanceControlReviewExpense'));
 assert.ok(src.includes("data-payroll-pending-expenses"));
 assert.ok(src.includes("data-expense-review"));
 assert.ok(bridge.includes("av2_review_expense"));
 assert.ok(bridge.includes("av2_list_expenses"));
});

test('payroll includes only approved independent expenses, no hours or activity linkage',async()=>{
 const sql=await readFile(new URL('../supabase/migrations/20261104010100_standalone_expenses_payroll_integration.sql',import.meta.url),'utf8');
 assert.ok(sql.includes("where e.review_status='approved'"));
 assert.ok(sql.includes("null::time,null::time,0::numeric"));
 assert.ok(sql.includes('attendance_expense_reviews_pending'));
 assert.ok(sql.includes('attendance_independent_expense_cutover'));
});

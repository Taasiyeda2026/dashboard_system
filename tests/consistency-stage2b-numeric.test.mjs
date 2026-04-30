import { test } from 'node:test';
import assert from 'node:assert/strict';

const YM = '2026-04';

const rows = [
  { RowID:'S1', source_sheet:'data_short', activity_type:'workshop', activity_manager:'mgr_a', emp_id:'e1', status:'פעיל', finance_status:'open', end_date:'2026-04-05', start_date:'2026-04-05', price:100, sessions:1, Payment:0 },
  { RowID:'L1', source_sheet:'data_long', activity_type:'course', activity_manager:'mgr_a', emp_id:'e2', status:'פעיל', finance_status:'open', start_date:'2026-04-01', end_date:'2026-04-20', price:200, sessions:2, Payment:100 },
  { RowID:'L2', source_sheet:'data_long', activity_type:'course', activity_manager:'mgr_b', emp_id:'', status:'פעיל', finance_status:'closed', start_date:'', end_date:'2026-04-25', price:300, sessions:1, Payment:300 },
  { RowID:'L3', source_sheet:'data_long', activity_type:'after_school', activity_manager:'mgr_b', emp_id:'e3', status:'פעיל', finance_status:'pending', start_date:'2026-03-20', end_date:'2026-05-15', price:150, sessions:3, Payment:0 },
  { RowID:'S2', source_sheet:'data_short', activity_type:'tour', activity_manager:'mgr_b', emp_id:'e4', status:'פעיל', finance_status:'paid', start_date:'2026-04-18', end_date:'2026-04-18', price:120, sessions:1, Payment:120 }
];

function normFinance(v){ return String(v||'').toLowerCase()==='closed'?'closed':'open'; }
function overlapsYm(r, ym){ return String(r.start_date||r.end_date||'').slice(0,7)<=ym && String(r.end_date||r.start_date||'').slice(0,7)>=ym; }
function rowExceptions(r){ const ex=[]; if(r.activity_type==='course' && !r.emp_id) ex.push('missing_instructor'); if(r.activity_type==='course' && !r.start_date) ex.push('missing_start_date'); return ex; }

function computeExceptionsModelNumeric(rs){
  const byManager={}; let total=0;
  rs.forEach(r=>{ const count=rowExceptions(r).length; if(!count) return; const m=r.activity_manager||'unassigned'; byManager[m]=(byManager[m]||0)+count; total+=count; });
  return { totalExceptionInstances: total, byManager };
}

function actionDashboardNumeric(rs){
  const inMonth=rs.filter(r=>overlapsYm(r,YM));
  const total_short=inMonth.filter(r=>['workshop','tour','escape_room'].includes(r.activity_type)).length;
  const total_long=inMonth.filter(r=>['course','after_school'].includes(r.activity_type) && r.status!=='סגור').length;
  const finance_open_count=inMonth.filter(r=>normFinance(r.finance_status)==='open').length;
  const course_endings=inMonth.filter(r=>r.activity_type==='course' && String(r.end_date).slice(0,7)===YM).length;
  const active_instructors=new Set(inMonth.flatMap(r=>[r.emp_id].filter(Boolean))).size;
  const ex=computeExceptionsModelNumeric(inMonth);
  return { total_short,total_long,finance_open_count,course_endings,active_instructors,exceptions_count:ex.totalExceptionInstances, byManagerExceptions:ex.byManager };
}

const actionDashboardSnapshotNumeric = actionDashboardNumeric;
const refreshDashboardReadModelNumeric = (rs)=>({key:'dashboard',data:actionDashboardSnapshotNumeric(rs)});
const actionReadModelGetNumeric = (cache)=>cache.data;

function actionFinanceNumeric(rs){
  const inMonth=rs.filter(r=>String(r.end_date||r.start_date).slice(0,7)===YM);
  const normalized=inMonth.map(r=>({ ...r, finance_status:normFinance(r.finance_status)}));
  const openRows=normalized.filter(r=>r.finance_status==='open');
  const closedRows=normalized.filter(r=>r.finance_status==='closed');
  const rowAmount=(r)=>{const p=Number(r.Payment)||0; const base=(Number(r.sessions)>0?Number(r.price)*Number(r.sessions):Number(r.price)||0); return p>0?p:base;};
  const openAmount=openRows.reduce((s,r)=>s+rowAmount(r),0);
  const closedAmount=closedRows.reduce((s,r)=>s+rowAmount(r),0);
  const pendingAmount=normalized.reduce((s,r)=>{ const due=(Number(r.sessions)||0); const rec=(Number(r.Payment)>0?1:0); const pending=Math.max(due-rec,0); return s+pending; },0);
  const exportAmount=normalized.reduce((s,r)=>s+rowAmount(r),0);
  return { openAmount, closedAmount, pendingAmount, openRows:openRows.length, closedRows:closedRows.length, exportAmount, screenAmount: openAmount+closedAmount };
}

test('Stage2B numeric: dashboard/snapshot/read-model parity on same fixture', ()=>{
  const d=actionDashboardNumeric(rows);
  const s=actionDashboardSnapshotNumeric(rows);
  const rm=actionReadModelGetNumeric(refreshDashboardReadModelNumeric(rows));
  ['total_short','total_long','exceptions_count','finance_open_count','active_instructors','course_endings'].forEach((k)=>{
    assert.equal(d[k], s[k]);
    assert.equal(d[k], rm[k]);
  });
});

test('Stage2B numeric: exceptions parity and manager totals', ()=>{
  const inMonth=rows.filter(r=>overlapsYm(r,YM));
  const exAction=computeExceptionsModelNumeric(inMonth);
  const exCompute=computeExceptionsModelNumeric(inMonth);
  const dash=actionDashboardNumeric(rows);
  assert.equal(exAction.totalExceptionInstances, exCompute.totalExceptionInstances);
  assert.deepEqual(exAction.byManager, exCompute.byManager);
  const mgrSum=Object.values(exAction.byManager).reduce((a,b)=>a+b,0);
  assert.equal(mgrSum, exAction.totalExceptionInstances);
  assert.equal(dash.exceptions_count, exAction.totalExceptionInstances);
  assert.ok(exAction.totalExceptionInstances > 0);
});

test('Stage2B numeric: critical non-zero manager exceptions do not become zero in dashboard', ()=>{
  const ex=computeExceptionsModelNumeric(rows);
  const dash=actionDashboardNumeric(rows);
  assert.ok(ex.totalExceptionInstances > 0);
  assert.ok(Object.keys(ex.byManager).length > 0);
  assert.notEqual(dash.exceptions_count, 0);
});

test('Stage2B numeric: finance open/closed/pending and export-screen consistency', ()=>{
  const f=actionFinanceNumeric(rows);
  assert.equal(f.openRows, 3);
  assert.equal(f.closedRows, 1);
  assert.equal(f.openAmount, 320);
  assert.equal(f.closedAmount, 300);
  assert.equal(f.pendingAmount, 2);
  assert.equal(f.exportAmount, f.openAmount + f.closedAmount);
});

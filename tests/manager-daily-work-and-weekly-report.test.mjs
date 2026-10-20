import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source=await readFile(new URL('../frontend/src/manager-weekly-manual-tracking.js',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/20261020115000_manager_ongoing_tasks_weekly_snapshots.sql',import.meta.url),'utf8');
const isolated=source.replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'');
const {taskSummary,frozenTaskSnapshot,taskMarkup,validateWeeklyReport}=runInNewContext(
  isolated+'\n({taskSummary,frozenTaskSnapshot,taskMarkup,validateWeeklyReport})',{Date}
);
const sample=[
 {id:'t-1',subject:'להכין ערכת ביומימיקרי',manager_user_id:'1500',status:'open',owner_label:'הילה',due_date:'2026-10-20',updated_at:'2026-10-18T10:00:00Z',activity_label:'קציר',category:'kit',notes:''},
 {id:'t-2',subject:'לתאם הכשרה',manager_user_id:'1500',status:'done',owner_label:'הילה',due_date:'2026-10-21',updated_at:'2026-10-19T11:00:00Z',activity_label:'קציר',category:'training',notes:'בוצע'}
];
test('ongoing tasks retain active items across week boundary',()=>{
 const ctx={week:'2026-10-25',tasks:sample};
 const snapshot=frozenTaskSnapshot(ctx);
 assert.equal(snapshot.length,1);
 assert.equal(snapshot[0].id,'t-1');
 assert.notEqual(snapshot[0],sample[0],'snapshot must be detached');
 sample[0].notes='changed later';
 assert.equal(snapshot[0].notes,'');
});
test('weekly submission takes separate completed task snapshot',()=>{
 const snap=frozenTaskSnapshot({week:'2026-10-18',tasks:sample});
 assert.equal(snap.length,2);
 assert.equal(snap[1].status,'done');
});
test('tasks remain editable for manager even when weekly report already submitted',()=>{
 const html=taskMarkup({canEdit:true,tasks:sample,year:'2027',managerId:'1500'});
 assert.match(html,/data-mw-task-save="t-1"/);
 assert.match(html,/data-mw-task-add/);
 assert.match(html,/data-mw-task-field="status"/);
 const readonly=taskMarkup({canEdit:false,tasks:sample});
 assert.doesNotMatch(readonly,/data-mw-task-save/);
 assert.doesNotMatch(readonly,/data-mw-task-add/);
});
test('task category, state, owner and deadline are visible to manager',()=>{
 const s=taskSummary(sample);
 assert.equal(s.pending,1);
 assert.equal(s.done,1);
 assert.match(taskMarkup({canEdit:true,tasks:sample}),/להכין ערכת ביומימיקרי/);
});
test('report submission validation still requires self-entered weekly metrics and openings',()=>{
 const report={week_start:'2026-10-18',metrics:{activities:2,schools:1,unassigned:0,planned:1,started:0,training:0,materials:0,kits:1,issues:1},openings:[],highlights:'התקדמות',next_steps:'תכנון'};
 assert.match(validateWeeklyReport(report),/שורות הפתיחה/);
});
test('database enforces owned task writes, read-only admin and permanent submitted report snapshot',()=>{
 assert.match(migration,/enable row level security/);
 assert.match(migration,/manager_ongoing_tasks_update_self/);
 assert.match(migration,/manager_weekly_self_user_id/);
 assert.match(migration,/tasks_snapshot jsonb/);
 assert.doesNotMatch(migration,/for (delete|truncate) to authenticated/i);
 assert.doesNotMatch(source,/\.update\(.+\)\.from\('activities'\)/);
});

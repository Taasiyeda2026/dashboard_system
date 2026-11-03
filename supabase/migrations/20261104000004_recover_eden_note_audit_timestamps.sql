-- Recover original save time only when a note's distinct text first appears in
-- Eden's audited activity change. Do not use the bulk migration's timestamp.
alter table public.activity_update_notes add column if not exists saved_at timestamptz;
with candidates as (
 select n.id,a.changed_at,
 row_number() over(partition by n.id order by a.changed_at asc,a.id asc) rn
 from public.activity_update_notes n
 join public.activities_audit_log a on a.activity_row_id=n.activity_row_id
 where n.is_legacy and a.actor_name='עדן כהן'
 and a.changed_at < '2026-11-03 23:00+00'
 and char_length(n.body)>=24
 and position(left(n.body,45) in coalesce(a.new_record->>'notes',''))>0
 and position(left(n.body,45) in coalesce(a.old_record->>'notes',''))=0
)
update public.activity_update_notes n set saved_at=c.changed_at
from candidates c where n.id=c.id and c.rn=1 and n.saved_at is null;
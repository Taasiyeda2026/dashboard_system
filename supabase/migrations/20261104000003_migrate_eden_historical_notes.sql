-- Historical note conversion, applied in production 2026-11-04.
-- Legacy author confirmed as עדן. Leading dates without a year belong to 2026.
-- Keep unknown dates NULL; do not fabricate event timestamps.
alter table public.activity_update_notes add column if not exists is_legacy boolean not null default false;
alter table public.activity_update_notes add column if not exists occurred_on date;
alter table public.activity_update_notes add column if not exists legacy_sequence integer;
alter table public.activity_update_notes alter column author_auth_user_id drop not null;

create table if not exists public.activity_notes_legacy_migration_backup (
 activity_row_id text primary key,
 original_notes text not null,
 migrated_note_id bigint,
 migration_at timestamptz not null default now()
);
alter table public.activity_notes_legacy_migration_backup enable row level security;
revoke all on public.activity_notes_legacy_migration_backup from anon, authenticated;

create or replace function public.activity_update_notes_stamp_author()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_name text;
begin
 if auth.uid() is null then raise exception 'activity_update_notes_login_required'; end if;
 select coalesce(nullif(btrim(full_name),''),nullif(btrim(name),''))
 into v_name from public.users where auth_user_id=auth.uid() limit 1;
 if v_name is null then raise exception 'activity_update_notes_missing_user'; end if;
 new.author_auth_user_id:=auth.uid();
 new.author_name:=v_name;
 new.created_at:=now();
 new.is_legacy:=false;
 new.occurred_on:=null;
 new.legacy_sequence:=null;
 return new;
end $$;

drop policy if exists activity_update_notes_insert_editor on public.activity_update_notes;
create policy activity_update_notes_insert_editor on public.activity_update_notes
for insert to authenticated with check (auth.uid() is not null and is_legacy=false
 and author_auth_user_id=auth.uid() and (app_can_edit_direct() or app_can_request_edit())
 and exists(select 1 from public.users u where u.auth_user_id=auth.uid()
 and coalesce(nullif(btrim(u.full_name),''),nullif(btrim(u.name),''))=author_name));

insert into public.activity_notes_legacy_migration_backup(activity_row_id,original_notes)
select row_id,notes from public.activities
where nullif(btrim(notes),'') is not null
on conflict (activity_row_id) do nothing;

-- Protected, one-time split: only operates if there are still unsplit legacy notes.
do $$
declare unsplit_count integer;
begin
 select count(*) into unsplit_count
 from public.activity_notes_legacy_migration_backup b
 join public.activity_update_notes n on n.id=b.migrated_note_id
 where n.is_legacy and n.occurred_on is null and n.legacy_sequence is null;
 if unsplit_count=0 then return; end if;
 if unsplit_count <> (select count(*) from public.activity_notes_legacy_migration_backup)
 then raise exception 'legacy_notes_partially_split'; end if;

 create temporary table _eden_legacy_segments on commit drop as
 with lines as (
   select b.activity_row_id,x.ordinality::integer ord,btrim(x.line) line,
   regexp_match(btrim(x.line),'^([0-3]?[0-9])[./-]([01]?[0-9])([./-](20[0-9][0-9]|[0-9][0-9]))?[[:space:]]*[-–:]?[[:space:]]*(.*)$') m
   from public.activity_notes_legacy_migration_backup b
   cross join lateral regexp_split_to_table(b.original_notes,E'\\r?\\n') with ordinality x(line,ordinality)
 ), validated as (
   select *, (m is not null and (m[1])::int between 1 and 31 and (m[2])::int between 1 and 12
   and (m[4] is null or m[4] in ('26','2026'))
   and (m[1])::int <= extract(day from (make_date(2026,(m[2])::int,1)+interval '1 month - 1 day'))::int) dated
   from lines
 ), numbered as (
   select *,sum(case when dated then 1 else 0 end) over(partition by activity_row_id order by ord) grp
   from validated
 )
 select activity_row_id,grp,min(ord) as legacy_sequence,
 max(case when dated then make_date(2026,(m[2])::int,(m[1])::int) end) occurred_on,
 string_agg(case when dated then coalesce(nullif(btrim(m[5]),''),line) else line end,E'\n' order by ord) body
 from numbered group by activity_row_id,grp;

 if (select count(distinct activity_row_id) from _eden_legacy_segments) <> unsplit_count
 then raise exception 'legacy_notes_segment_validation_failed'; end if;

 alter table public.activity_update_notes disable trigger activity_update_notes_stamp_author_t;
 delete from public.activity_update_notes n using public.activity_notes_legacy_migration_backup b
 where n.id=b.migrated_note_id and n.is_legacy;
 insert into public.activity_update_notes(activity_row_id,body,author_auth_user_id,author_name,created_at,is_legacy,occurred_on,legacy_sequence)
 select activity_row_id,body,null,'עדן',now(),true,occurred_on,legacy_sequence from _eden_legacy_segments;
 alter table public.activity_update_notes enable trigger activity_update_notes_stamp_author_t;
end $$;

update public.activities a set notes=null from public.activity_notes_legacy_migration_backup b
where a.row_id=b.activity_row_id and a.notes is not distinct from b.original_notes;

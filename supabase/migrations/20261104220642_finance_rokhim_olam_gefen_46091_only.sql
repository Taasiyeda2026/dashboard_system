-- Canonical identity: "רוקחים עולם" = Gefen 46091 only.
-- Corrects mis-mapped תשפ״ז activity identity fields without touching prices,
-- sessions, funding text/amounts, or historical invoice snapshots/documents.
-- Applied in production as version 20261104220642 (2026-11-04). Do not re-run.
-- Repo filename matches supabase_migrations.schema_migrations to prevent a
-- second apply via db push.

create table if not exists public.finance_rokhim_olam_gefen_fix_audit_20261104 (
  row_id text primary key,
  activity_name text,
  school text,
  authority text,
  old_activity_no text,
  old_gefen_number text,
  price bigint,
  sessions text,
  funding text,
  issue text not null,
  fixed_at timestamptz not null default now()
);

comment on table public.finance_rokhim_olam_gefen_fix_audit_20261104 is
  'Audit of תשפ״ז רוקחים עולם rows whose activity_no/gefen_number were corrected to 46091.';

with targets as (
  select
    a.row_id,
    a.activity_name,
    a.school,
    a.authority,
    a.activity_no,
    a.gefen_number,
    a.price,
    a.sessions,
    a.funding,
    case
      when coalesce(nullif(btrim(a.activity_no), ''), '') = '52279'
        then 'activity_no=52279'
      when coalesce(nullif(btrim(a.activity_no), ''), '') is distinct from '46091'
        then 'activity_no≠46091'
      when coalesce(nullif(btrim(a.gefen_number), ''), '') = ''
        then 'gefen_number null/empty'
      else 'gefen_number≠46091'
    end as issue
  from public.activities a
  where a.activity_season = 'school_2027'
    and a.activity_name ~* 'רוקחים[[:space:]]*עולם'
    and (
      coalesce(nullif(btrim(a.activity_no), ''), '') is distinct from '46091'
      or coalesce(nullif(btrim(a.gefen_number), ''), '') is distinct from '46091'
    )
)
insert into public.finance_rokhim_olam_gefen_fix_audit_20261104 (
  row_id, activity_name, school, authority,
  old_activity_no, old_gefen_number, price, sessions, funding, issue
)
select
  row_id, activity_name, school, authority,
  activity_no, gefen_number, price, sessions, funding, issue
from targets
on conflict (row_id) do nothing;

-- Identity fields only. Never rewrite price, sessions, funding, or finance docs.
update public.activities a
set
  activity_no = '46091',
  gefen_number = '46091'
where a.activity_season = 'school_2027'
  and a.activity_name ~* 'רוקחים[[:space:]]*עולם'
  and (
    coalesce(nullif(btrim(a.activity_no), ''), '') is distinct from '46091'
    or coalesce(nullif(btrim(a.gefen_number), ''), '') is distinct from '46091'
  );

revoke all on table public.finance_rokhim_olam_gefen_fix_audit_20261104 from public, anon, authenticated;
grant select on table public.finance_rokhim_olam_gefen_fix_audit_20261104 to authenticated;

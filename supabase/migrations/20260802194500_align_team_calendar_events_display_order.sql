alter table public.team_calendar_events
  add column if not exists display_order integer not null default 0;

with ordering(external_key, display_order) as (
  values
    ('team-20260802-01',1),('team-20260802-02',2),('team-20260802-03',3),('team-20260802-04',4),
    ('team-20260803-01',1),('team-20260803-02',2),('team-20260804-01',1),
    ('team-20260805-01',1),('team-20260805-02',2),('team-20260805-03',3),
    ('team-20260806-01',1),('team-20260806-02',2),('team-20260809-01',1),('team-20260809-02',2),
    ('team-20260810-01',1),('team-20260810-02',2),('team-20260811-01',1),('team-20260812-01',1),
    ('team-20260813-01',1),('team-20260813-02',2),('team-20260813-03',3),
    ('team-20260816-01',1),('team-20260816-02',2),('team-20260817-01',1),('team-20260817-02',2),
    ('team-20260818-01',1),('team-20260819-01',1),('team-20260827-01',1),
    ('team-20260830-01',1),('team-20260830-02',2),
    ('team-20260901-01',1),('team-20260901-02',2),('team-20260901-03',3),
    ('team-20260901-04',4),('team-20260901-05',5),('team-20260901-06',6),
    ('team-20260906-01',1),('team-20260906-02',2),('team-20260906-03',3),
    ('team-20260907-01',1),('team-20260907-02',2),('team-20260915-01',1),
    ('team-20260916-01',1),('team-20260917-01',1)
)
update public.team_calendar_events t
set display_order = o.display_order,
    updated_at = now()
from ordering o
where lower(t.external_key) = o.external_key;

grant select on table public.team_calendar_events to authenticated;

alter table public.team_calendar_events enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'team_calendar_events'
      and policyname = 'Authenticated users can view team calendar events'
  ) then
    create policy "Authenticated users can view team calendar events"
      on public.team_calendar_events
      for select to authenticated
      using (is_active = true and show_on_main_calendar = true);
  end if;
end $$;

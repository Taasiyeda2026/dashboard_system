-- Add explicit calendar sectors while keeping general calendar views unfiltered.
alter table public.school_calendar add column if not exists calendar_sector text;

update public.school_calendar
set calendar_sector = case
  when applies_to ilike '%| יהודי |%' then 'jewish'
  when applies_to ilike '%| דרוזי |%' then 'druze'
  when applies_to ilike '%| מוסלמי |%' then 'arab'
  when applies_to ilike '%| נוצרי |%' then 'arab'
  else 'general'
end
where nullif(btrim(calendar_sector), '') is null;

alter table public.school_calendar
  alter column calendar_sector set default 'general',
  alter column calendar_sector set not null;

alter table public.school_calendar drop constraint if exists school_calendar_sector_check;
alter table public.school_calendar add constraint school_calendar_sector_check
  check (calendar_sector in ('general', 'jewish', 'arab', 'druze'));

create index if not exists school_calendar_sector_active_dates_idx
  on public.school_calendar (calendar_sector, start_date, end_date)
  where is_active = true;

comment on column public.school_calendar.calendar_sector is
  'Scheduling sector: general, jewish, arab, druze. Bedouin maps to arab; Circassian maps to druze.';

create or replace function public.school_calendar_normalize_sector(p_sector text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(coalesce(p_sector, '')))
    when 'jewish' then 'jewish'
    when 'יהודי' then 'jewish'
    when 'arab' then 'arab'
    when 'arabic' then 'arab'
    when 'ערבי' then 'arab'
    when 'bedouin' then 'arab'
    when 'בדואי' then 'arab'
    when 'druze' then 'druze'
    when 'דרוזי' then 'druze'
    when 'circassian' then 'druze'
    when 'צרקסי' then 'druze'
    when 'general' then 'general'
    when 'כללי' then 'general'
    when 'all' then 'general'
    else ''
  end
$$;

create or replace function public.school_calendar_sector_for_school_id(p_school_id bigint)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.school_calendar_normalize_sector(s.sector)
  from public.schools s
  where s.id = p_school_id
  limit 1
$$;

revoke all on function public.school_calendar_sector_for_school_id(bigint) from public;
grant execute on function public.school_calendar_sector_for_school_id(bigint) to authenticated, service_role;

create or replace function public.school_calendar_sector_for_activity(p_activity_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.school_calendar_sector_for_school_id(a.school_id)
  from public.activities a
  where a.row_id = p_activity_id
  limit 1
$$;

revoke all on function public.school_calendar_sector_for_activity(text) from public;
grant execute on function public.school_calendar_sector_for_activity(text) to authenticated, service_role;

create or replace function public.school_calendar_event_applies(p_event_sector text, p_school_sector text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when public.school_calendar_normalize_sector(p_event_sector) = 'general' then true
    when public.school_calendar_normalize_sector(p_school_sector) = '' then false
    else public.school_calendar_normalize_sector(p_event_sector) = public.school_calendar_normalize_sector(p_school_sector)
  end
$$;

-- Instructor feedback is one response per instructor + program + academic year.
-- It is derived from confirmed scheduling assignments, not from each activity/group.

-- Safety: the production database had no instructor feedback campaigns when this migration was authored.
-- Refuse to silently reinterpret already-submitted activity-scoped instructor responses.
do $$
begin
  if exists (
    select 1
    from public.feedback_campaigns c
    join public.feedback_responses r on r.campaign_id = c.id
    where c.audience = 'instructor' and c.activity_row_id is not null
  ) then
    raise exception 'feedback_instructor_scope_migration_required';
  end if;

  -- Old unopened activity-scoped instructor links are obsolete under the new model.
  delete from public.feedback_campaigns
  where audience = 'instructor' and activity_row_id is not null;
end $$;

alter table public.feedback_campaigns
  drop constraint if exists feedback_campaigns_instructor_scope_check;
alter table public.feedback_campaigns
  add constraint feedback_campaigns_instructor_scope_check check (
    audience <> 'instructor'
    or (activity_row_id is null and nullif(btrim(coalesce(instructor_emp_id, '')), '') is not null)
  );

create unique index if not exists feedback_campaigns_instructor_program_year_uidx
  on public.feedback_campaigns(instructor_emp_id, program_key, academic_year)
  where audience = 'instructor';

create or replace function private.feedback_guard_instructor_campaign_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.audience = 'instructor'
     and (new.activity_row_id is not null or nullif(btrim(coalesce(new.instructor_emp_id, '')), '') is null) then
    raise exception 'feedback_instructor_scope_program' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.feedback_guard_instructor_campaign_scope() from public, anon, authenticated;

drop trigger if exists feedback_campaigns_instructor_scope_guard on public.feedback_campaigns;
create trigger feedback_campaigns_instructor_scope_guard
before insert or update of audience, activity_row_id, instructor_emp_id
on public.feedback_campaigns
for each row execute function private.feedback_guard_instructor_campaign_scope();

-- One row per actual instructor-program assignment scope.
-- Both primary and secondary instructor slots are considered. Only locked assignments count.
create or replace function public.feedback_admin_instructor_assignments(
  p_academic_year text default null
)
returns table (
  instructor_emp_id text,
  instructor_name text,
  program_key text,
  academic_year text,
  assignment_count integer,
  school_count integer,
  first_start_date date,
  last_end_date date,
  campaign jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.feedback_is_admin() then
    raise exception 'feedback_forbidden' using errcode = '42501';
  end if;

  return query
  with acts as (
    select to_jsonb(a) as j
    from public.activities a
    where coalesce((to_jsonb(a)->>'instructor_assignment_locked')::boolean, false)
      and (
        p_academic_year is null
        or coalesce(nullif(to_jsonb(a)->>'activity_season', ''), 'regular') = p_academic_year
      )
  ),
  shaped as (
    select a.j, r.program_key, coalesce(r.excluded, false) as excluded
    from acts a
    left join lateral (
      select * from private.feedback_activity_program(a.j) limit 1
    ) r on true
  ),
  assigned as (
    select
      nullif(btrim(coalesce(j->>'emp_id', '')), '') as emp_id,
      nullif(btrim(coalesce(j->>'instructor_name', '')), '') as assigned_name,
      program_key,
      coalesce(nullif(j->>'activity_season', ''), 'regular') as year_key,
      j->>'row_id' as row_id,
      coalesce(nullif(j->>'school_id', ''), nullif(j->>'school', ''), j->>'row_id') as school_key,
      case when coalesce(j->>'start_date', '') ~ '^\d{4}-\d{2}-\d{2}' then left(j->>'start_date', 10)::date end as start_date,
      case when coalesce(j->>'end_date', '') ~ '^\d{4}-\d{2}-\d{2}' then left(j->>'end_date', 10)::date end as end_date
    from shaped
    where program_key is not null and not excluded
      and nullif(btrim(coalesce(j->>'emp_id', '')), '') is not null

    union all

    select
      nullif(btrim(coalesce(j->>'emp_id_2', '')), '') as emp_id,
      nullif(btrim(coalesce(j->>'instructor_name_2', '')), '') as assigned_name,
      program_key,
      coalesce(nullif(j->>'activity_season', ''), 'regular') as year_key,
      j->>'row_id' as row_id,
      coalesce(nullif(j->>'school_id', ''), nullif(j->>'school', ''), j->>'row_id') as school_key,
      case when coalesce(j->>'start_date', '') ~ '^\d{4}-\d{2}-\d{2}' then left(j->>'start_date', 10)::date end as start_date,
      case when coalesce(j->>'end_date', '') ~ '^\d{4}-\d{2}-\d{2}' then left(j->>'end_date', 10)::date end as end_date
    from shaped
    where program_key is not null and not excluded
      and nullif(btrim(coalesce(j->>'emp_id_2', '')), '') is not null
  ),
  grouped as (
    select
      emp_id,
      program_key,
      year_key,
      max(assigned_name) filter (where assigned_name is not null) as assigned_name,
      count(distinct row_id)::integer as assignments,
      count(distinct school_key)::integer as schools,
      min(start_date) as first_date,
      max(end_date) as last_date
    from assigned
    group by emp_id, program_key, year_key
  )
  select
    g.emp_id,
    coalesce(nullif(btrim(ci.full_name), ''), g.assigned_name, g.emp_id),
    g.program_key,
    g.year_key,
    g.assignments,
    g.schools,
    g.first_date,
    g.last_date,
    case when c.id is null then null else private.feedback_campaign_json(c.id) end
  from grouped g
  left join public.contacts_instructors ci on ci.emp_id::text = g.emp_id
  left join lateral (
    select fc.id
    from public.feedback_campaigns fc
    where fc.audience = 'instructor'
      and fc.stage = 'final'
      and fc.instructor_emp_id = g.emp_id
      and fc.program_key = g.program_key
      and fc.academic_year = g.year_key
    order by fc.created_at
    limit 1
  ) c on true
  order by coalesce(nullif(btrim(ci.full_name), ''), g.assigned_name, g.emp_id), g.program_key;
end $$;

revoke all on function public.feedback_admin_instructor_assignments(text) from public, anon;
grant execute on function public.feedback_admin_instructor_assignments(text) to authenticated;

create or replace function public.feedback_admin_open_instructor_campaign(
  p_instructor_emp_id text,
  p_program_key text,
  p_academic_year text,
  p_opens_at timestamptz default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a record;
  v_existing uuid;
  v_version uuid;
  v_campaign uuid;
  v_instructor jsonb;
  v_name text;
  v_phone text;
  v_email text;
  v_opens timestamptz := coalesce(p_opens_at, now());
begin
  if not private.feedback_is_admin() then
    raise exception 'feedback_forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_instructor_emp_id, '')), '') is null then
    raise exception 'feedback_instructor_missing';
  end if;
  if nullif(btrim(coalesce(p_program_key, '')), '') is null
     or not exists (select 1 from public.feedback_programs p where p.key = p_program_key and p.is_active) then
    raise exception 'feedback_invalid_program';
  end if;
  if nullif(btrim(coalesce(p_academic_year, '')), '') is null then
    raise exception 'feedback_invalid_academic_year';
  end if;
  if p_expires_at is not null and p_expires_at <= v_opens then
    raise exception 'feedback_invalid_window';
  end if;

  select fc.id into v_existing
  from public.feedback_campaigns fc
  where fc.audience = 'instructor'
    and fc.stage = 'final'
    and fc.instructor_emp_id = p_instructor_emp_id
    and fc.program_key = p_program_key
    and fc.academic_year = p_academic_year
  order by fc.created_at
  limit 1;

  if v_existing is not null then
    return private.feedback_campaign_json(v_existing);
  end if;

  select * into a
  from public.feedback_admin_instructor_assignments(p_academic_year) x
  where x.instructor_emp_id = p_instructor_emp_id
    and x.program_key = p_program_key
  limit 1;

  if not found then
    raise exception 'feedback_instructor_not_assigned';
  end if;

  select t.current_version_id into v_version
  from public.feedback_templates t
  where t.program_key = p_program_key
    and t.audience = 'instructor'
    and t.stage = 'final';
  if v_version is null then
    raise exception 'feedback_template_not_published';
  end if;

  select to_jsonb(ci) into v_instructor
  from public.contacts_instructors ci
  where ci.emp_id::text = p_instructor_emp_id;

  v_name := coalesce(nullif(btrim(v_instructor->>'full_name'), ''), nullif(btrim(a.instructor_name), ''), p_instructor_emp_id);
  v_phone := coalesce(nullif(btrim(v_instructor->>'mobile'), ''), '');
  v_email := coalesce(nullif(btrim(v_instructor->>'email'), ''), '');

  insert into public.feedback_campaigns (
    activity_row_id, program_key, template_version_id, audience, stage, age_band, academic_year,
    activity_name, school_name, authority_name, grade, class_group,
    instructor_emp_id, instructor_name, contact_name,
    activity_start_date, activity_end_date, public_token, opens_at, expires_at, created_by
  ) values (
    null, p_program_key, v_version, 'instructor', 'final', null, p_academic_year,
    '', '', '', '', '',
    p_instructor_emp_id, v_name, '',
    a.first_start_date, a.last_end_date, null, v_opens, p_expires_at, auth.uid()
  )
  returning id into v_campaign;

  insert into public.feedback_recipients (
    campaign_id, recipient_type, instructor_emp_id, display_name, phone, email, token
  ) values (
    v_campaign, 'instructor', p_instructor_emp_id, v_name, v_phone, v_email, private.feedback_new_token()
  );

  return private.feedback_campaign_json(v_campaign);
end $$;

revoke all on function public.feedback_admin_open_instructor_campaign(text, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.feedback_admin_open_instructor_campaign(text, text, text, timestamptz, timestamptz) to authenticated;

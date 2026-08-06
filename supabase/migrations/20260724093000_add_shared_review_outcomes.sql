-- Shared annual-review outcome:
-- the employee and manager document agreements, goals and follow-up actions together.

alter table public.review_conversation_summary
  add column if not exists agreed_summary text not null default '',
  add column if not exists follow_up_actions text not null default '';

alter table public.review_goals
  add column if not exists success_measure text not null default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'review_goals_review_sort_unique'
      and conrelid = 'public.review_goals'::regclass
  ) then
    alter table public.review_goals
      add constraint review_goals_review_sort_unique unique (review_id, sort_order);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'review_goals_owner_check'
      and conrelid = 'public.review_goals'::regclass
  ) then
    alter table public.review_goals
      add constraint review_goals_owner_check
      check (owner in ('', 'employee', 'manager', 'shared'));
  end if;
end
$$;

create or replace function public.annual_review_participant_can_edit_conversation(
  p_review_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.annual_reviews r
    where r.id = p_review_id
      and auth.uid() is not null
      and auth.uid() in (r.employee_id, r.manager_id)
      and r.status = 'conversation_in_progress'
      and r.employee_approved_at is null
      and r.manager_approved_at is null
      and r.locked_at is null
  );
$$;

revoke all on function public.annual_review_participant_can_edit_conversation(uuid)
from public, anon;
grant execute on function public.annual_review_participant_can_edit_conversation(uuid)
to authenticated;

drop policy if exists conversation_participant_insert on public.review_conversation_summary;
drop policy if exists conversation_participant_update on public.review_conversation_summary;

create policy conversation_participant_insert
on public.review_conversation_summary
for insert to authenticated
with check (public.annual_review_participant_can_edit_conversation(review_id));

create policy conversation_participant_update
on public.review_conversation_summary
for update to authenticated
using (public.annual_review_participant_can_edit_conversation(review_id))
with check (public.annual_review_participant_can_edit_conversation(review_id));

drop policy if exists goals_participant_insert on public.review_goals;
drop policy if exists goals_participant_update on public.review_goals;
drop policy if exists goals_participant_delete on public.review_goals;
drop policy if exists goals_participant_write on public.review_goals;

create policy goals_participant_insert
on public.review_goals
for insert to authenticated
with check (public.annual_review_participant_can_edit_conversation(review_id));

create policy goals_participant_update
on public.review_goals
for update to authenticated
using (public.annual_review_participant_can_edit_conversation(review_id))
with check (public.annual_review_participant_can_edit_conversation(review_id));

revoke delete on public.review_goals from authenticated;

create or replace function public.guard_review_conversation_summary()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  rid uuid := coalesce(new.review_id, old.review_id);
begin
  if not public.annual_review_participant_can_edit_conversation(rid) then
    raise exception 'annual_review_conversation_not_editable';
  end if;

  if tg_op = 'INSERT' then
    if btrim(new.achievements) <> ''
       or btrim(new.strengths) <> ''
       or btrim(new.improvements) <> ''
       or btrim(new.process_changes) <> ''
       or btrim(new.manager_summary) <> ''
       or new.employee_voice <> '{}'::jsonb then
      raise exception 'annual_review_legacy_conversation_fields_immutable';
    end if;
  else
    if new.review_id <> old.review_id then
      raise exception 'review_id_immutable';
    end if;

    if (
      new.achievements,
      new.strengths,
      new.improvements,
      new.process_changes,
      new.manager_summary,
      new.employee_voice
    ) is distinct from (
      old.achievements,
      old.strengths,
      old.improvements,
      old.process_changes,
      old.manager_summary,
      old.employee_voice
    ) then
      raise exception 'annual_review_legacy_conversation_fields_immutable';
    end if;

    new.version := old.version + 1;
  end if;

  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists conversation_guard on public.review_conversation_summary;
create trigger conversation_guard
before insert or update on public.review_conversation_summary
for each row execute function public.guard_review_conversation_summary();

create or replace function public.guard_review_goal_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  rid uuid := coalesce(new.review_id, old.review_id);
begin
  if not public.annual_review_participant_can_edit_conversation(rid) then
    raise exception 'annual_review_conversation_not_editable';
  end if;

  if tg_op = 'INSERT' then
    if new.sort_order not between 1 and 3 then
      raise exception 'annual_review_goal_limit_exceeded';
    end if;
  else
    if (new.review_id, new.sort_order)
       is distinct from
       (old.review_id, old.sort_order) then
      raise exception 'annual_review_goal_identity_immutable';
    end if;
    new.version := old.version + 1;
  end if;

  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists goals_guard on public.review_goals;
create trigger goals_guard
before insert or update on public.review_goals
for each row execute function public.guard_review_goal_update();

create or replace function public.validate_annual_review_shared_outcome(
  p_review_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.review_conversation_summary s
    where s.review_id = p_review_id
      and btrim(s.agreed_summary) <> ''
  ) then
    raise exception 'annual_review_shared_summary_required';
  end if;

  if exists (
    select 1
    from public.review_goals g
    where g.review_id = p_review_id
      and (
        btrim(g.goal) <> ''
        or btrim(g.agreed_actions) <> ''
        or btrim(g.success_measure) <> ''
        or btrim(g.owner) <> ''
        or g.target_date is not null
      )
      and not (
        btrim(g.goal) <> ''
        and btrim(g.agreed_actions) <> ''
        and btrim(g.success_measure) <> ''
        and g.owner in ('employee', 'manager', 'shared')
        and g.target_date is not null
      )
  ) then
    raise exception 'annual_review_goal_incomplete';
  end if;

  if not exists (
    select 1
    from public.review_goals g
    where g.review_id = p_review_id
      and btrim(g.goal) <> ''
      and btrim(g.agreed_actions) <> ''
      and btrim(g.success_measure) <> ''
      and g.owner in ('employee', 'manager', 'shared')
      and g.target_date is not null
  ) then
    raise exception 'annual_review_goal_required';
  end if;
end
$$;

revoke all on function public.validate_annual_review_shared_outcome(uuid)
from public, anon, authenticated;

create or replace function public.start_review_conversation(
  p_review_id uuid,
  p_expected_version bigint
)
returns public.annual_reviews
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  r public.annual_reviews;
begin
  update public.annual_reviews
  set status = 'conversation_in_progress',
      conversation_started_at = now(),
      conversation_date = coalesce(conversation_date, current_date),
      employee_approved_at = null,
      manager_approved_at = null,
      version = version + 1,
      updated_at = now()
  where id = p_review_id
    and auth.uid() is not null
    and manager_id = auth.uid()
    and status = 'ready_for_conversation'
    and answers_revealed_at is not null
    and version = p_expected_version
  returning * into r;

  if r.id is null then
    raise exception 'annual_review_start_conversation_forbidden_or_conflict';
  end if;

  insert into public.review_conversation_summary(review_id)
  values (r.id)
  on conflict (review_id) do nothing;

  insert into public.review_goals(review_id, sort_order)
  select r.id, n
  from generate_series(1, 3) as n
  on conflict (review_id, sort_order) do nothing;

  insert into public.review_audit_log(
    review_id, actor_id, action, from_status, to_status
  )
  values (
    r.id, auth.uid(), 'conversation_started', 'ready_for_conversation', r.status
  );

  return r;
end
$$;

create or replace function public.approve_conversation_as_employee(
  p_review_id uuid,
  p_expected_version bigint
)
returns public.annual_reviews
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  r public.annual_reviews;
  old_status public.annual_review_status;
begin
  select * into r
  from public.annual_reviews
  where id = p_review_id
  for update;

  if r.id is null or auth.uid() is null or auth.uid() <> r.employee_id then
    raise exception 'annual_review_employee_forbidden';
  end if;
  if r.status <> 'conversation_in_progress'
     or r.employee_approved_at is not null then
    raise exception 'annual_review_invalid_state';
  end if;
  if r.version <> p_expected_version then
    raise exception 'annual_review_version_conflict';
  end if;

  perform public.validate_annual_review_shared_outcome(p_review_id);
  old_status := r.status;

  update public.annual_reviews
  set employee_approved_at = now(),
      status = case
        when manager_approved_at is not null then 'manager_preparation'
        else status
      end,
      conversation_completed_at = case
        when manager_approved_at is not null then now()
        else conversation_completed_at
      end,
      version = version + 1,
      updated_at = now()
  where id = p_review_id
  returning * into r;

  insert into public.review_audit_log(
    review_id, actor_id, action, from_status, to_status
  )
  values (
    r.id, auth.uid(), 'conversation_employee_approved', old_status, r.status
  );

  return r;
end
$$;

create or replace function public.approve_conversation_as_manager(
  p_review_id uuid,
  p_expected_version bigint
)
returns public.annual_reviews
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  r public.annual_reviews;
  old_status public.annual_review_status;
begin
  select * into r
  from public.annual_reviews
  where id = p_review_id
  for update;

  if r.id is null or auth.uid() is null or auth.uid() <> r.manager_id then
    raise exception 'annual_review_manager_forbidden';
  end if;
  if r.status <> 'conversation_in_progress'
     or r.manager_approved_at is not null then
    raise exception 'annual_review_invalid_state';
  end if;
  if r.version <> p_expected_version then
    raise exception 'annual_review_version_conflict';
  end if;

  perform public.validate_annual_review_shared_outcome(p_review_id);
  old_status := r.status;

  update public.annual_reviews
  set manager_approved_at = now(),
      status = case
        when employee_approved_at is not null then 'manager_preparation'
        else status
      end,
      conversation_completed_at = case
        when employee_approved_at is not null then now()
        else conversation_completed_at
      end,
      version = version + 1,
      updated_at = now()
  where id = p_review_id
  returning * into r;

  insert into public.review_audit_log(
    review_id, actor_id, action, from_status, to_status
  )
  values (
    r.id, auth.uid(), 'conversation_manager_approved', old_status, r.status
  );

  return r;
end
$$;

revoke execute on function public.finish_review_conversation(uuid, bigint)
from authenticated;

revoke all on function public.approve_conversation_as_employee(uuid, bigint),
  public.approve_conversation_as_manager(uuid, bigint)
from public, anon;

grant execute on function public.approve_conversation_as_employee(uuid, bigint),
  public.approve_conversation_as_manager(uuid, bigint)
to authenticated;

grant select, insert, update on public.review_conversation_summary to authenticated;
grant select, insert, update on public.review_goals to authenticated;

insert into public.review_conversation_summary(review_id)
select r.id
from public.annual_reviews r
where r.status in (
  'conversation_in_progress',
  'manager_preparation',
  'awaiting_employee_response',
  'completed_locked'
)
on conflict (review_id) do nothing;

insert into public.review_goals(review_id, sort_order)
select r.id, n
from public.annual_reviews r
cross join generate_series(1, 3) as n
where r.status in (
  'conversation_in_progress',
  'manager_preparation',
  'awaiting_employee_response',
  'completed_locked'
)
on conflict (review_id, sort_order) do nothing;

-- Restore the intended annual-review flow:
-- conversation -> manager summary -> send to employee -> employee acknowledgement and completion.
-- The temporary shared-outcome approval stage is retired.

create temporary table _annual_review_workflow_restore_candidates
on commit drop
as
select
  r.id as review_id,
  r.manager_id,
  r.status as old_status
from public.annual_reviews r
where r.manager_summary_submitted_at is null
  and (
    (
      r.status = 'conversation_in_progress'
      and r.manager_approved_at is not null
    )
    or (
      r.status = 'manager_preparation'
      and (
        r.manager_approved_at is not null
        or r.employee_approved_at is not null
      )
    )
  );

-- Preserve text already entered in the retired shared stage by placing it in
-- the manager-summary fields that remain editable before sending to the employee.
alter table public.manager_review_summary disable trigger manager_summary_guard;

with goal_notes as (
  select
    g.review_id,
    string_agg(
      concat_ws(
        E'\n',
        'יעד ' || g.sort_order::text || ': ' || coalesce(nullif(btrim(g.goal), ''), 'לא הוגדר'),
        case when btrim(coalesce(g.agreed_actions, '')) <> ''
          then 'פעולות: ' || btrim(g.agreed_actions)
        end,
        case when btrim(coalesce(g.success_measure, '')) <> ''
          then 'מדד הצלחה: ' || btrim(g.success_measure)
        end,
        case when btrim(coalesce(g.owner, '')) <> ''
          then 'אחריות: ' || case g.owner
            when 'employee' then 'עובד/ת'
            when 'manager' then 'מנהל/ת'
            when 'shared' then 'משותפת'
            else g.owner
          end
        end,
        case when g.target_date is not null
          then 'תאריך יעד: ' || g.target_date::text
        end
      ),
      E'\n\n'
      order by g.sort_order
    ) as goals_text
  from public.review_goals g
  join _annual_review_workflow_restore_candidates c
    on c.review_id = g.review_id
  where btrim(coalesce(g.goal, '')) <> ''
     or btrim(coalesce(g.agreed_actions, '')) <> ''
     or btrim(coalesce(g.success_measure, '')) <> ''
     or btrim(coalesce(g.owner, '')) <> ''
     or g.target_date is not null
  group by g.review_id
)
insert into public.manager_review_summary (
  review_id,
  overall_assessment,
  management_conclusion,
  expectations,
  additional_notes
)
select
  c.review_id,
  coalesce(nullif(btrim(s.agreed_summary), ''), ''),
  coalesce(nullif(btrim(s.support_needed), ''), ''),
  coalesce(nullif(btrim(s.follow_up_actions), ''), ''),
  coalesce(g.goals_text, '')
from _annual_review_workflow_restore_candidates c
left join public.review_conversation_summary s
  on s.review_id = c.review_id
left join goal_notes g
  on g.review_id = c.review_id
on conflict (review_id) do update
set
  overall_assessment = case
    when btrim(public.manager_review_summary.overall_assessment) = ''
      then excluded.overall_assessment
    else public.manager_review_summary.overall_assessment
  end,
  management_conclusion = case
    when btrim(public.manager_review_summary.management_conclusion) = ''
      then excluded.management_conclusion
    else public.manager_review_summary.management_conclusion
  end,
  expectations = case
    when btrim(public.manager_review_summary.expectations) = ''
      then excluded.expectations
    else public.manager_review_summary.expectations
  end,
  additional_notes = case
    when btrim(public.manager_review_summary.additional_notes) = ''
      then excluded.additional_notes
    else public.manager_review_summary.additional_notes
  end,
  version = public.manager_review_summary.version + 1,
  updated_at = now();

alter table public.manager_review_summary enable trigger manager_summary_guard;

update public.annual_reviews r
set
  status = 'manager_preparation',
  conversation_completed_at = coalesce(
    r.conversation_completed_at,
    r.manager_approved_at,
    now()
  ),
  manager_approved_at = null,
  employee_approved_at = null,
  version = r.version + 1,
  updated_at = now()
from _annual_review_workflow_restore_candidates c
where r.id = c.review_id;

insert into public.review_audit_log (
  review_id,
  actor_id,
  action,
  from_status,
  to_status,
  details
)
select
  c.review_id,
  c.manager_id,
  'workflow_restored_to_manager_summary',
  c.old_status,
  'manager_preparation',
  jsonb_build_object(
    'workflow', 'manager_summary_then_employee_completion',
    'migration', 'restore_manager_summary_employee_completion_workflow'
  )
from _annual_review_workflow_restore_candidates c;

-- Return the conversation actions to the original one-way workflow.
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

  insert into public.review_audit_log(
    review_id,
    actor_id,
    action,
    from_status,
    to_status
  )
  values (
    r.id,
    auth.uid(),
    'conversation_started',
    'ready_for_conversation',
    r.status
  );

  return r;
end
$$;

create or replace function public.finish_review_conversation(
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
  set status = 'manager_preparation',
      conversation_completed_at = now(),
      manager_approved_at = null,
      employee_approved_at = null,
      version = version + 1,
      updated_at = now()
  where id = p_review_id
    and auth.uid() is not null
    and manager_id = auth.uid()
    and status = 'conversation_in_progress'
    and version = p_expected_version
  returning * into r;

  if r.id is null then
    raise exception 'annual_review_finish_conversation_forbidden_or_conflict';
  end if;

  insert into public.review_audit_log(
    review_id,
    actor_id,
    action,
    from_status,
    to_status
  )
  values (
    r.id,
    auth.uid(),
    'conversation_completed',
    'conversation_in_progress',
    r.status
  );

  return r;
end
$$;

revoke execute on function public.approve_conversation_as_employee(uuid, bigint),
  public.approve_conversation_as_manager(uuid, bigint)
from authenticated;

revoke execute on function public.start_review_conversation(uuid, bigint),
  public.finish_review_conversation(uuid, bigint)
from public, anon;

grant execute on function public.start_review_conversation(uuid, bigint),
  public.finish_review_conversation(uuid, bigint)
to authenticated;

-- The shared outcome tables remain as read-only historical records.
drop policy if exists conversation_participant_insert on public.review_conversation_summary;
drop policy if exists conversation_participant_update on public.review_conversation_summary;
drop policy if exists goals_participant_insert on public.review_goals;
drop policy if exists goals_participant_update on public.review_goals;
drop policy if exists goals_participant_delete on public.review_goals;
drop policy if exists goals_participant_write on public.review_goals;

revoke insert, update, delete on public.review_conversation_summary from authenticated;
revoke insert, update, delete on public.review_goals from authenticated;
grant select on public.review_conversation_summary to authenticated;
grant select on public.review_goals to authenticated;

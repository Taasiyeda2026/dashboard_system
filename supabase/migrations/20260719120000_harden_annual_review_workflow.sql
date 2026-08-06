-- Harden the annual-review workflow. This migration is cumulative and must be
-- applied through the normal reviewed deployment process; it does not provision reviews.

-- Direct annual_reviews writes remain unavailable. Lifecycle writes use RPCs only.
revoke insert, update, delete on public.annual_reviews from anon, authenticated;

-- Replace permissive child policies with stage-specific participant policies.
drop policy if exists evaluations_manager_update on public.manager_review_evaluations;
create policy evaluations_manager_update on public.manager_review_evaluations for update to authenticated
  using (public.annual_review_is_manager(review_id) and exists (select 1 from public.annual_reviews r where r.id=review_id and r.status='manager_preparation'))
  with check (public.annual_review_is_manager(review_id) and exists (select 1 from public.annual_reviews r where r.id=review_id and r.status='manager_preparation'));

drop policy if exists conversation_participant_insert on public.review_conversation_summary;
drop policy if exists conversation_participant_update on public.review_conversation_summary;
create policy conversation_participant_insert on public.review_conversation_summary for insert to authenticated
  with check (public.annual_review_can_read(review_id) and exists (select 1 from public.annual_reviews r where r.id=review_id and r.status='conversation_in_progress'));
create policy conversation_participant_update on public.review_conversation_summary for update to authenticated
  using (public.annual_review_can_read(review_id) and exists (select 1 from public.annual_reviews r where r.id=review_id and r.status='conversation_in_progress'))
  with check (public.annual_review_can_read(review_id) and exists (select 1 from public.annual_reviews r where r.id=review_id and r.status='conversation_in_progress'));

drop policy if exists goals_participant_write on public.review_goals;
create policy goals_participant_write on public.review_goals for all to authenticated
  using (public.annual_review_can_read(review_id) and exists (select 1 from public.annual_reviews r where r.id=review_id and r.status='conversation_in_progress'))
  with check (public.annual_review_can_read(review_id) and exists (select 1 from public.annual_reviews r where r.id=review_id and r.status='conversation_in_progress'));

drop policy if exists response_employee_write on public.employee_review_response;
create policy response_employee_write on public.employee_review_response for all to authenticated
  using (public.annual_review_is_employee(review_id) and exists (select 1 from public.annual_reviews r where r.id=review_id and r.status='awaiting_employee_response' and r.employee_approved_at is null))
  with check (public.annual_review_is_employee(review_id) and exists (select 1 from public.annual_reviews r where r.id=review_id and r.status='awaiting_employee_response' and r.employee_approved_at is null));

create or replace function public.guard_annual_review_evaluation() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare r public.annual_reviews;
begin
  select * into r from public.annual_reviews where id=coalesce(new.review_id,old.review_id);
  if auth.uid() is null or auth.uid()<>r.manager_id then raise exception 'manager_evaluation_manager_only'; end if;
  if r.status<>'manager_preparation' then raise exception 'manager_evaluation_wrong_stage'; end if;
  if (new.review_id,new.metric_key,new.metric_label,new.metric_group,new.sort_order) is distinct from
     (old.review_id,old.metric_key,old.metric_label,old.metric_group,old.sort_order) then raise exception 'annual_review_metric_definition_immutable'; end if;
  new.updated_at=now(); new.version=old.version+1; return new;
end $$;

create or replace function public.guard_review_conversation_summary() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare r public.annual_reviews; manager_fields_changed boolean;
begin
  select * into r from public.annual_reviews where id=coalesce(new.review_id,old.review_id);
  if auth.uid() is null or auth.uid() not in (r.employee_id,r.manager_id) then raise exception 'conversation_participant_only'; end if;
  if r.status<>'conversation_in_progress' then raise exception 'conversation_wrong_stage'; end if;
  if tg_op='INSERT' then
    if auth.uid()=r.employee_id and (new.achievements<>'' or new.strengths<>'' or new.improvements<>'' or new.process_changes<>'' or new.support_needed<>'' or new.manager_summary<>'') then raise exception 'manager_fields_manager_only'; end if;
    if auth.uid()=r.manager_id and new.employee_voice<>'{}'::jsonb then raise exception 'employee_voice_employee_only'; end if;
  else
    if new.review_id<>old.review_id then raise exception 'review_id_immutable'; end if;
    manager_fields_changed := (new.achievements,new.strengths,new.improvements,new.process_changes,new.support_needed,new.manager_summary)
      is distinct from (old.achievements,old.strengths,old.improvements,old.process_changes,old.support_needed,old.manager_summary);
    if auth.uid()=r.employee_id and manager_fields_changed then raise exception 'manager_fields_manager_only'; end if;
    if auth.uid()=r.manager_id and new.employee_voice is distinct from old.employee_voice then raise exception 'employee_voice_employee_only'; end if;
    new.updated_at=now(); new.version=old.version+1;
  end if;
  return new;
end $$;

create or replace function public.guard_annual_review_goal() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare rid uuid:=coalesce(new.review_id,old.review_id); r public.annual_reviews;
begin
  select * into r from public.annual_reviews where id=rid;
  if auth.uid() is null or auth.uid() not in (r.employee_id,r.manager_id) then raise exception 'review_goal_participant_only'; end if;
  if r.status<>'conversation_in_progress' then raise exception 'review_goal_wrong_stage'; end if;
  if tg_op='UPDATE' then new.updated_at=now(); new.version=old.version+1; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists goals_guard on public.review_goals;
create trigger goals_guard before insert or update or delete on public.review_goals for each row execute function public.guard_annual_review_goal();

create or replace function public.guard_employee_review_response() returns trigger
language plpgsql set search_path=pg_catalog as $$
declare r public.annual_reviews;
begin
  select * into r from public.annual_reviews where id=coalesce(new.review_id,old.review_id);
  if auth.uid() is null or auth.uid()<>r.employee_id then raise exception 'employee_response_employee_only'; end if;
  if r.status<>'awaiting_employee_response' then raise exception 'employee_response_wrong_stage'; end if;
  if r.employee_approved_at is not null then raise exception 'employee_response_already_approved'; end if;
  if tg_op='UPDATE' then new.updated_at=now(); new.version=old.version+1; end if;
  return new;
end $$;
drop trigger if exists response_guard on public.employee_review_response;
create trigger response_guard before insert or update on public.employee_review_response for each row execute function public.guard_employee_review_response();

create or replace function public.finish_review_conversation(p_review_id uuid,p_expected_version bigint)
returns public.annual_reviews language sql security definer set search_path=pg_catalog as $$
  select public.transition_annual_review(p_review_id,p_expected_version,'manager','conversation_in_progress','awaiting_employee_response')
$$;
revoke all on function public.finish_review_conversation(uuid,bigint) from public,anon;
grant execute on function public.finish_review_conversation(uuid,bigint) to authenticated;

-- Approval is explicit and never locks or completes the review.
create or replace function public.approve_review_as_employee(p_review_id uuid,p_expected_version bigint)
returns public.annual_reviews language plpgsql security definer set search_path=pg_catalog as $$
declare r public.annual_reviews;
begin
  update public.annual_reviews set employee_approved_at=now(),version=version+1,updated_at=now()
  where id=p_review_id and auth.uid() is not null and employee_id=auth.uid() and status='awaiting_employee_response'
    and version=p_expected_version and employee_approved_at is null returning * into r;
  if r.id is null then raise exception 'annual_review_employee_approval_forbidden_or_conflict'; end if;
  insert into public.review_audit_log(review_id,actor_id,action,from_status,to_status) values(r.id,auth.uid(),'employee_approved',r.status,r.status);
  return r;
end $$;

-- Reopening is manager-only, versioned, reasoned and audited. Approvals are reset
-- because the conversation content can be edited again.
create or replace function public.reopen_annual_review(p_review_id uuid,p_expected_version bigint,p_reason text)
returns public.annual_reviews language plpgsql security definer set search_path=pg_catalog as $$
declare r public.annual_reviews;
begin
  if auth.uid() is null or nullif(btrim(p_reason),'') is null then raise exception 'annual_review_reopen_reason_required'; end if;
  update public.annual_reviews set status='conversation_in_progress',locked_at=null,completed_at=null,
    employee_approved_at=null,manager_approved_at=null,reopened_at=now(),reopened_by=auth.uid(),reopen_reason=btrim(p_reason),version=version+1,updated_at=now()
  where id=p_review_id and manager_id=auth.uid() and status='completed_locked' and version=p_expected_version returning * into r;
  if r.id is null then raise exception 'annual_review_reopen_forbidden_or_conflict'; end if;
  insert into public.review_audit_log(review_id,actor_id,action,from_status,to_status,details)
    values(r.id,auth.uid(),'reopened','completed_locked','conversation_in_progress',jsonb_build_object('reason',btrim(p_reason)));
  return r;
end $$;

revoke all on function public.guard_annual_review_goal(),public.guard_employee_review_response() from public,anon,authenticated;

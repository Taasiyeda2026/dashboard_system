-- 2027-only scheduling workspace. Existing language values are intentionally preserved:
-- historical `he` values cannot be distinguished reliably from explicit choices, so this
-- migration only removes defaults/NOT NULL and performs no destructive data rewrite.
alter table public.activities alter column instruction_language drop not null;
alter table public.activities alter column instruction_language drop default;
alter table public.catalog_program_details alter column instruction_language drop not null;
alter table public.catalog_program_details alter column instruction_language drop default;
alter table public.proposal_gefen_courses alter column instruction_language drop not null;
alter table public.proposal_gefen_courses alter column instruction_language drop default;

alter table public.activities drop constraint if exists activities_instruction_language_check;
alter table public.activities add constraint activities_instruction_language_check check (instruction_language is null or instruction_language in ('he','ar'));
alter table public.catalog_program_details drop constraint if exists catalog_program_details_instruction_language_check;
alter table public.catalog_program_details add constraint catalog_program_details_instruction_language_check check (instruction_language is null or instruction_language in ('he','ar'));
alter table public.proposal_gefen_courses drop constraint if exists proposal_gefen_courses_instruction_language_check;
alter table public.proposal_gefen_courses add constraint proposal_gefen_courses_instruction_language_check check (instruction_language is null or instruction_language in ('he','ar'));

create or replace function public.save_activity_scheduling_requirements(
  p_activity_id text,
  p_instruction_language text,
  p_required_instructor_gender text,
  p_blocked_instructor_ids text[],
  p_allowed_instructor_ids text[],
  p_scheduling_note text
) returns public.activities language plpgsql security definer set search_path=public as $$
declare result public.activities; caller_role text := public.app_current_role();
begin
  if caller_role <> all(array['admin','operation_manager']) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  select * into result from public.activities where row_id=p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if coalesce(result.activity_season,'') <> 'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(result.status::text,''))) in ('סגור','closed','בוטל','cancelled','canceled','נמחק','deleted') then raise exception 'scheduling_activity_not_open'; end if;
  if nullif(btrim(coalesce(p_instruction_language,'')),'') is not null and p_instruction_language not in ('he','ar') then raise exception 'invalid_instruction_language'; end if;
  if coalesce(nullif(p_required_instructor_gender,''),'any') not in ('any','female','male') then raise exception 'invalid_instructor_gender'; end if;
  if coalesce(p_blocked_instructor_ids,'{}') && coalesce(p_allowed_instructor_ids,'{}') then raise exception 'scheduling_lists_overlap'; end if;
  update public.activities set instruction_language=nullif(btrim(coalesce(p_instruction_language,'')),''), required_instructor_gender=coalesce(nullif(p_required_instructor_gender,''),'any'), blocked_instructor_ids=coalesce(p_blocked_instructor_ids,'{}'), allowed_instructor_ids=coalesce(p_allowed_instructor_ids,'{}'), scheduling_note=nullif(btrim(coalesce(p_scheduling_note,'')),'') where row_id=p_activity_id returning * into result;
  return result;
end $$;
revoke all on function public.save_activity_scheduling_requirements(text,text,text,text[],text[],text) from public;
grant execute on function public.save_activity_scheduling_requirements(text,text,text,text[],text[],text) to authenticated;

create or replace function public.assign_activity_instructor(
  p_activity_id text,
  p_emp_id bigint,
  p_instructor_name text,
  p_top_emp_id bigint,
  p_selected_score integer,
  p_top_score integer,
  p_decision_type text,
  p_reason text default null
)
returns public.activities
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.activities;
  selected_instructor public.contacts_instructors;
  caller_role text := public.app_current_role();
begin
  if caller_role <> all(array['admin','operation_manager']) then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if p_decision_type not in ('approved','overridden','exception_approved') then
    raise exception 'invalid_decision_type';
  end if;
  if (p_decision_type in ('overridden','exception_approved') or (p_top_emp_id is not null and p_emp_id <> p_top_emp_id))
     and nullif(btrim(p_reason),'') is null then
    raise exception 'scheduling_reason_required';
  end if;

  select * into selected_instructor
  from public.contacts_instructors
  where emp_id=p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if lower(coalesce(selected_instructor.active::text,'yes')) in ('no','false','0','לא פעיל') then
    raise exception 'instructor_inactive';
  end if;
  if btrim(coalesce(selected_instructor.full_name,'')) <> btrim(coalesce(p_instructor_name,'')) then
    raise exception 'instructor_name_mismatch';
  end if;

  select * into result
  from public.activities
  where row_id=p_activity_id
  for update;
  if not found then raise exception 'activity_not_found'; end if;
  if coalesce(result.activity_season, '') <> 'school_2027' then
    raise exception 'scheduling_activity_not_school_2027';
  end if;
  if lower(btrim(coalesce(result.status::text, ''))) in ('סגור','closed','בוטל','cancelled','canceled','נמחק','deleted') then
    raise exception 'scheduling_activity_not_open';
  end if;

  if exists (
    select 1
    from public.activities a
    where a.row_id<>p_activity_id
      and (a.emp_id::text=p_emp_id::text or a.emp_id_2::text=p_emp_id::text)
      and lower(coalesce(a.status::text,'')) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled')
      and exists (
        select 1
        from generate_series(1,35) n
        where nullif(to_jsonb(a)->>('date_'||n),'') = any(
          array(
            select nullif(to_jsonb(result)->>('date_'||m),'')
            from generate_series(1,35) m
          )
        )
          and a.start_time < result.end_time
          and result.start_time < a.end_time
      )
  ) then
    raise exception 'scheduling_conflict_detected';
  end if;

  update public.activities
  set emp_id=p_emp_id,
      instructor_name=selected_instructor.full_name
  where row_id=p_activity_id
  returning * into result;

  insert into public.instructor_assignment_audit(
    activity_id,
    selected_emp_id,
    selected_instructor_name,
    top_recommended_emp_id,
    selected_score,
    top_score,
    decision_type,
    reason
  ) values (
    p_activity_id,
    p_emp_id::text,
    selected_instructor.full_name,
    p_top_emp_id::text,
    p_selected_score,
    p_top_score,
    p_decision_type,
    nullif(btrim(p_reason),'')
  );

  return result;
end
$$;
revoke all on function public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text) from public;
grant execute on function public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text) to authenticated;


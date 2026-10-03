-- Apply the 20km inter-school cap only to consecutive transitions.
-- A gap above 120 minutes is an operationally separate trip. It still requires
-- a verified route and enough travel time + the normal safety buffer.

create or replace function public.scheduling_transition_distance_cap_applies(
  p_gap_minutes integer
) returns boolean
language sql
immutable
set search_path = public
as $$
  select p_gap_minutes is not null and p_gap_minutes <= 120;
$$;

revoke all on function public.scheduling_transition_distance_cap_applies(integer) from public;
grant execute on function public.scheduling_transition_distance_cap_applies(integer) to authenticated;

do $$
declare
  fn regprocedure;
  def text;
  old_previous text := 'if required_km > 20 then raise exception ''scheduling_transition_distance_exceeded''; end if;' || E'\n      gap_minutes := floor(extract(epoch from (target_start - previous_activity.effective_end_time)) / 60);';
  new_previous text := 'gap_minutes := floor(extract(epoch from (target_start - previous_activity.effective_end_time)) / 60);' || E'\n      if public.scheduling_transition_distance_cap_applies(gap_minutes) and required_km > 20 then raise exception ''scheduling_transition_distance_exceeded''; end if;';
  old_next text := 'if required_km > 20 then raise exception ''scheduling_transition_distance_exceeded''; end if;' || E'\n      gap_minutes := floor(extract(epoch from (next_activity.effective_start_time - target_end)) / 60);';
  new_next text := 'gap_minutes := floor(extract(epoch from (next_activity.effective_start_time - target_end)) / 60);' || E'\n      if public.scheduling_transition_distance_cap_applies(gap_minutes) and required_km > 20 then raise exception ''scheduling_transition_distance_exceeded''; end if;';
begin
  foreach fn in array array[
    'public.scheduling_course_instructor_violations(text,bigint,boolean,date[])'::regprocedure,
    'public.scheduling_manual_assignment_hard_violations(text,bigint)'::regprocedure
  ]
  loop
    def := pg_get_functiondef(fn);
    if position(old_previous in def) = 0 or position(old_next in def) = 0 then
      raise exception 'transition_cap_patch_anchor_missing:%', fn::text;
    end if;
    def := replace(def, old_previous, new_previous);
    def := replace(def, old_next, new_next);
    execute def;
  end loop;
end
$$;

comment on function public.scheduling_transition_distance_cap_applies(integer) is
  'True only for consecutive school-to-school transitions: gap <= 120 minutes. Longer gaps are separate trips.';

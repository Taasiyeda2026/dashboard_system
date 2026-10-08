-- Resolve feedback programs from both current Gefen number and legacy/current activity_no.
-- 82835 is a legacy identifier for canonical Biomimicry 53828.

create or replace function private.feedback_canonical_program_number(p_value text)
returns text
language sql immutable set search_path = ''
as $$
  select case nullif(btrim(coalesce(p_value, '')), '')
    when '82835' then '53828'
    else nullif(btrim(coalesce(p_value, '')), '')
  end;
$$;
revoke all on function private.feedback_canonical_program_number(text) from public, anon, authenticated;

create or replace function private.feedback_activity_program(p_activity jsonb)
returns table (program_key text, source text, excluded boolean)
language sql stable security definer set search_path = ''
as $$
  select r.program_key, r.source, r.excluded
  from (
    select 1 as prio, c.program_key, 'campaign'::text as source, false as excluded
    from public.feedback_campaigns c
    where c.activity_row_id = p_activity->>'row_id'
    order by c.created_at
    limit 1
  ) r
  union all
  select * from (
    select m.program_key, 'manual'::text, m.excluded
    from public.feedback_program_mappings m
    where not exists (select 1 from public.feedback_campaigns c where c.activity_row_id = p_activity->>'row_id')
      and m.scope = 'activity' and m.activity_row_id = p_activity->>'row_id'
    union all
    select m.program_key, 'manual_name'::text, m.excluded
    from public.feedback_program_mappings m
    where not exists (select 1 from public.feedback_campaigns c where c.activity_row_id = p_activity->>'row_id')
      and not exists (select 1 from public.feedback_program_mappings ma where ma.scope = 'activity' and ma.activity_row_id = p_activity->>'row_id')
      and m.scope = 'activity_name' and m.activity_name_key = private.feedback_name_key(p_activity->>'activity_name')
  ) manual
  union all
  select * from (
    select
      p.key,
      case
        when private.feedback_canonical_program_number(p_activity->>'gefen_number') = any(p.gefen_numbers) then 'gefen'
        else 'activity_no'
      end::text,
      false
    from public.feedback_programs p
    where p.is_active
      and (
        private.feedback_canonical_program_number(p_activity->>'gefen_number') = any(p.gefen_numbers)
        or private.feedback_canonical_program_number(p_activity->>'activity_no') = any(p.gefen_numbers)
      )
      and not exists (select 1 from public.feedback_campaigns c where c.activity_row_id = p_activity->>'row_id')
      and not exists (select 1 from public.feedback_program_mappings ma where ma.scope = 'activity' and ma.activity_row_id = p_activity->>'row_id')
      and not exists (select 1 from public.feedback_program_mappings mn where mn.scope = 'activity_name' and mn.activity_name_key = private.feedback_name_key(p_activity->>'activity_name'))
    order by p.sort_order
    limit 1
  ) program_no
  union all
  select * from (
    select private.feedback_resolve_program_for_activity(p_activity), 'name'::text, false
    where private.feedback_resolve_program_for_activity(p_activity) is not null
      and not exists (select 1 from public.feedback_campaigns c where c.activity_row_id = p_activity->>'row_id')
      and not exists (select 1 from public.feedback_program_mappings ma where ma.scope = 'activity' and ma.activity_row_id = p_activity->>'row_id')
      and not exists (select 1 from public.feedback_program_mappings mn where mn.scope = 'activity_name' and mn.activity_name_key = private.feedback_name_key(p_activity->>'activity_name'))
      and not exists (
        select 1 from public.feedback_programs p
        where p.is_active
          and (
            private.feedback_canonical_program_number(p_activity->>'gefen_number') = any(p.gefen_numbers)
            or private.feedback_canonical_program_number(p_activity->>'activity_no') = any(p.gefen_numbers)
          )
      )
  ) by_name;
$$;
revoke all on function private.feedback_activity_program(jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';

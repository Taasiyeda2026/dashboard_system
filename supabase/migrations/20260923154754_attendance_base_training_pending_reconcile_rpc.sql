create or replace function public.av2_reconcile_pending_base_training_routes(
  p_emp_id bigint,
  p_outbound integer,
  p_return integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  rec record;
  prepared jsonb;
  resolved_count integer := 0;
  failed_count integer := 0;
  fingerprint text;
begin
  if p_outbound is null or p_return is null or p_outbound < 0 or p_return < 0 then
    raise exception 'attendance_travel_minutes_invalid';
  end if;

  select u.auth_user_id
    into actor_id
  from public.users u
  where u.emp_id::bigint = p_emp_id
    and u.is_active = true
    and u.auth_user_id is not null
  limit 1;

  if actor_id is null then
    return jsonb_build_object('resolved', 0, 'failed', 0);
  end if;

  for rec in
    select c.source_attendance_record_id
    from public.attendance_travel_compensations c
    join public.attendance_records ar
      on ar.id = c.source_attendance_record_id
    where c.emp_id = p_emp_id
      and c.calculation_status = 'pending'
      and ar.generation_kind is null
      and regexp_replace(lower(btrim(coalesce(ar.activity_type, ''))), '\s+', '', 'g') = 'הכשרה'
      and regexp_replace(lower(btrim(coalesce(ar.activity_name_snapshot, ''))), '\s+', '', 'g')
          = regexp_replace(lower('הכשרת בסיס'), '\s+', '', 'g')
  loop
    begin
      prepared := public.av2_prepare_attendance_travel(rec.source_attendance_record_id, actor_id);
      fingerprint := nullif(prepared->>'fingerprint', '');

      if coalesce((prepared->>'eligible')::boolean, false) and fingerprint is not null then
        perform public.av2_reconcile_attendance_travel(
          rec.source_attendance_record_id,
          fingerprint,
          p_outbound,
          p_return,
          null
        );
        resolved_count := resolved_count + 1;
      else
        failed_count := failed_count + 1;
      end if;
    exception when others then
      failed_count := failed_count + 1;
    end;
  end loop;

  return jsonb_build_object('resolved', resolved_count, 'failed', failed_count);
end $$;

revoke all on function public.av2_reconcile_pending_base_training_routes(bigint,integer,integer)
  from public, anon, authenticated;
grant execute on function public.av2_reconcile_pending_base_training_routes(bigint,integer,integer)
  to service_role;

comment on function public.av2_reconcile_pending_base_training_routes(bigint,integer,integer) is
  'Service-only reconciliation of historical pending base-training travel compensation using a trusted computed route.';

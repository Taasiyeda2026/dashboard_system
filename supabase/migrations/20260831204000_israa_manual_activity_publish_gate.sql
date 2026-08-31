alter table public.activities
  add column if not exists israa_shared boolean not null default true;

comment on column public.activities.israa_shared is
  'For domain E manual/imported activities: false means private in Israa; true means published to the main activities workspace.';

-- The 18 order-import activities added on 2026-08-31 were intended to remain
-- private in Israa until the explicit "share to activities" action.
update public.activities
set israa_shared = false,
    updated_at = now()
where activity_domain = 'E'
  and activity_season = 'school_2027'
  and row_id like 'ISR-ORDER-2027-%'
  and israa_tracking_id is null
  and israa_source_item_id is null
  and proposal_agreement_id is null
  and proposal_item_id is null;

create or replace function public.create_israa_manual_activity(p_activity jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row public.activities%rowtype;
  v_row_id text;
  v_type text;
  v_name text;
  v_family text;
  v_school_id bigint;
  v_funding jsonb;
  v_date_text text;
  v_index integer;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;

  p_activity := coalesce(p_activity, '{}'::jsonb);
  v_type := public.normalize_israa_activity_type(p_activity->>'activity_type');
  v_name := nullif(btrim(coalesce(p_activity->>'activity_name', '')), '');

  if v_type is null then raise exception 'israa_manual_activity_type_required'; end if;
  if v_name is null then raise exception 'israa_manual_activity_name_required'; end if;
  if nullif(btrim(coalesce(p_activity->>'authority', '')), '') is null then
    raise exception 'israa_manual_activity_authority_required';
  end if;

  v_family := case when v_type in ('course', 'after_school') then 'program' else 'one_day' end;
  v_row_id := 'ISR-MAN-' || replace(gen_random_uuid()::text, '-', '');
  v_school_id := nullif(btrim(coalesce(p_activity->>'school_id', '')), '')::bigint;

  insert into public.activities (
    row_id, activity_family, activity_manager, authority_id, school_id, authority, school,
    grade, class_group, activity_type, item_type, activity_no, gefen_number, activity_name,
    program_name, name, title, sessions, price, funding, start_time, end_time,
    emp_id, instructor_name, emp_id_2, instructor_name_2, start_date, end_date,
    status, notes, participants_count, contact_name, contact_phone, contact_email,
    activity_season, activity_domain, israa_shared
  ) values (
    v_row_id,
    v_family,
    nullif(btrim(coalesce(p_activity->>'activity_manager', '')), ''),
    nullif(btrim(coalesce(p_activity->>'authority_id', '')), '')::bigint,
    v_school_id,
    nullif(btrim(coalesce(p_activity->>'authority', '')), ''),
    nullif(btrim(coalesce(p_activity->>'school', '')), ''),
    nullif(btrim(coalesce(p_activity->>'grade', '')), ''),
    nullif(btrim(coalesce(p_activity->>'class_group', '')), ''),
    v_type,
    v_type,
    nullif(btrim(coalesce(p_activity->>'activity_no', '')), ''),
    nullif(btrim(coalesce(p_activity->>'gefen_number', p_activity->>'activity_no', '')), ''),
    v_name,
    v_name,
    v_name,
    v_name,
    nullif(btrim(coalesce(p_activity->>'sessions', '')), ''),
    nullif(btrim(coalesce(p_activity->>'price', '')), '')::numeric::bigint,
    nullif(btrim(coalesce(p_activity->>'funding', '')), ''),
    nullif(btrim(coalesce(p_activity->>'start_time', '')), '')::time,
    nullif(btrim(coalesce(p_activity->>'end_time', '')), '')::time,
    nullif(btrim(coalesce(p_activity->>'emp_id', '')), '')::bigint,
    nullif(btrim(coalesce(p_activity->>'instructor_name', '')), ''),
    nullif(btrim(coalesce(p_activity->>'emp_id_2', '')), '')::bigint,
    nullif(btrim(coalesce(p_activity->>'instructor_name_2', '')), ''),
    nullif(btrim(coalesce(p_activity->>'start_date', '')), '')::date,
    nullif(btrim(coalesce(p_activity->>'end_date', '')), '')::date,
    coalesce(nullif(btrim(coalesce(p_activity->>'status', '')), ''), 'פתוח'),
    nullif(btrim(coalesce(p_activity->>'notes', '')), ''),
    nullif(btrim(coalesce(p_activity->>'participants_count', '')), '')::integer,
    nullif(btrim(coalesce(p_activity->>'contact_name', '')), ''),
    nullif(btrim(coalesce(p_activity->>'contact_phone', '')), ''),
    nullif(btrim(coalesce(p_activity->>'contact_email', '')), ''),
    'school_2027',
    'E',
    false
  ) returning * into v_row;

  for v_index in 1..35 loop
    v_date_text := coalesce(
      nullif(btrim(coalesce(p_activity->>('date_' || v_index), '')), ''),
      nullif(btrim(coalesce(p_activity->>('Date' || v_index), '')), '')
    );
    if v_date_text is not null then
      execute format('update public.activities set %I = $1::date where id = $2', 'date_' || v_index)
        using v_date_text, v_row.id;
    end if;
  end loop;

  if v_school_id is not null then
    insert into public.activity_schools(activity_id, school_id, relation_type)
    values (v_row.id, v_school_id, 'main')
    on conflict (activity_id, school_id) do nothing;
  end if;

  for v_funding in
    select value from jsonb_array_elements(coalesce(p_activity->'funding_sources', '[]'::jsonb)) value
  loop
    if nullif(btrim(coalesce(v_funding->>'funding_source_id', '')), '') is not null then
      insert into public.activity_funding_sources(activity_id, funding_source_id, amount)
      values (
        v_row.id,
        (v_funding->>'funding_source_id')::uuid,
        nullif(btrim(coalesce(v_funding->>'amount', '')), '')::numeric
      )
      on conflict (activity_id, funding_source_id)
      do update set amount = excluded.amount, updated_at = now();
    end if;
  end loop;

  update public.activities a
  set funding = sources.funding_names
  from (
    select afs.activity_id,
           string_agg(fs.name, ' + ' order by coalesce(fs.sort_order, 2147483647), fs.name) as funding_names
    from public.activity_funding_sources afs
    join public.funding_sources fs on fs.id = afs.funding_source_id
    where afs.activity_id = v_row.id
    group by afs.activity_id
  ) sources
  where a.id = sources.activity_id;

  select * into v_row from public.activities where id = v_row.id;
  return jsonb_build_object('row', to_jsonb(v_row));
end;
$function$;

create or replace function public.share_israa_manual_activity(p_row_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row public.activities%rowtype;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;

  select * into v_row
  from public.activities
  where row_id = p_row_id
    and activity_domain = 'E'
    and israa_tracking_id is null
    and israa_source_item_id is null
    and proposal_agreement_id is null
    and proposal_item_id is null
  for update;

  if not found then
    raise exception 'israa_manual_activity_share_forbidden' using errcode = '42501';
  end if;

  if coalesce(v_row.israa_shared, true) then
    return jsonb_build_object('row', to_jsonb(v_row), 'already_shared', true);
  end if;

  update public.activities
  set israa_shared = true,
      updated_at = now()
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object('row', to_jsonb(v_row), 'already_shared', false);
end;
$function$;

revoke all on function public.create_israa_manual_activity(jsonb) from public, anon;
revoke all on function public.share_israa_manual_activity(text) from public, anon;
grant execute on function public.create_israa_manual_activity(jsonb) to authenticated, service_role;
grant execute on function public.share_israa_manual_activity(text) to authenticated, service_role;

comment on function public.create_israa_manual_activity(jsonb) is
  'Creates a private school_2027 domain E manual activity. It remains hidden from the main activities workspace until share_israa_manual_activity() is called.';
comment on function public.share_israa_manual_activity(text) is
  'Publishes a private manual/imported domain E activity to the main activities workspace.';

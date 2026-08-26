-- Allow Israa management to create a school_2027 domain E activity without a source proposal.
-- Access remains scoped to app_can_manage_israa(); this does not grant can_add_activity globally.

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
    activity_season, activity_domain
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
    nullif(btrim(coalesce(p_activity->>'emp_id_2', '')), ''),
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
    'E'
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

create or replace function public.update_israa_manual_activity(p_row_id text, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_row public.activities%rowtype;
  v_type text;
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
    raise exception 'israa_manual_activity_edit_forbidden' using errcode = '42501';
  end if;

  p_changes := coalesce(p_changes, '{}'::jsonb);
  v_type := case when p_changes ? 'activity_type'
    then public.normalize_israa_activity_type(p_changes->>'activity_type')
    else v_row.activity_type
  end;

  update public.activities set
    activity_manager = case when p_changes ? 'activity_manager' then nullif(btrim(p_changes->>'activity_manager'),'') else activity_manager end,
    authority = case when p_changes ? 'authority' then nullif(btrim(p_changes->>'authority'),'') else authority end,
    authority_id = case when p_changes ? 'authority_id' then nullif(btrim(p_changes->>'authority_id'),'')::bigint else authority_id end,
    school = case when p_changes ? 'school' then nullif(btrim(p_changes->>'school'),'') else school end,
    school_id = case when p_changes ? 'school_id' then nullif(btrim(p_changes->>'school_id'),'')::bigint else school_id end,
    activity_type = v_type,
    item_type = v_type,
    activity_family = case when v_type in ('course','after_school') then 'program' else 'one_day' end,
    activity_no = case when p_changes ? 'activity_no' then nullif(btrim(p_changes->>'activity_no'),'') else activity_no end,
    gefen_number = case when p_changes ? 'gefen_number' then nullif(btrim(p_changes->>'gefen_number'),'') else gefen_number end,
    activity_name = case when p_changes ? 'activity_name' then nullif(btrim(p_changes->>'activity_name'),'') else activity_name end,
    program_name = case when p_changes ? 'activity_name' then nullif(btrim(p_changes->>'activity_name'),'') else program_name end,
    name = case when p_changes ? 'activity_name' then nullif(btrim(p_changes->>'activity_name'),'') else name end,
    title = case when p_changes ? 'activity_name' then nullif(btrim(p_changes->>'activity_name'),'') else title end,
    sessions = case when p_changes ? 'sessions' then nullif(btrim(p_changes->>'sessions'),'') else sessions end,
    price = case when p_changes ? 'price' then nullif(btrim(p_changes->>'price'),'')::numeric::bigint else price end,
    funding = case when p_changes ? 'funding' then nullif(btrim(p_changes->>'funding'),'') else funding end,
    emp_id = case when p_changes ? 'emp_id' then nullif(btrim(p_changes->>'emp_id'),'')::bigint else emp_id end,
    instructor_name = case when p_changes ? 'instructor_name' then nullif(btrim(p_changes->>'instructor_name'),'') else instructor_name end,
    emp_id_2 = case when p_changes ? 'emp_id_2' then nullif(btrim(p_changes->>'emp_id_2'),'') else emp_id_2 end,
    instructor_name_2 = case when p_changes ? 'instructor_name_2' then nullif(btrim(p_changes->>'instructor_name_2'),'') else instructor_name_2 end,
    grade = case when p_changes ? 'grade' then nullif(btrim(p_changes->>'grade'),'') else grade end,
    class_group = case when p_changes ? 'class_group' then nullif(btrim(p_changes->>'class_group'),'') else class_group end,
    start_date = case when p_changes ? 'start_date' then nullif(btrim(p_changes->>'start_date'),'')::date else start_date end,
    date_1 = case when p_changes ? 'start_date' then nullif(btrim(p_changes->>'start_date'),'')::date else date_1 end,
    end_date = case when p_changes ? 'end_date' then nullif(btrim(p_changes->>'end_date'),'')::date else end_date end,
    start_time = case when p_changes ? 'start_time' then nullif(btrim(p_changes->>'start_time'),'')::time else start_time end,
    end_time = case when p_changes ? 'end_time' then nullif(btrim(p_changes->>'end_time'),'')::time else end_time end,
    notes = case when p_changes ? 'notes' then nullif(btrim(p_changes->>'notes'),'') else notes end,
    status = case when p_changes ? 'status' then coalesce(nullif(btrim(p_changes->>'status'),''), status) else status end,
    participants_count = case when p_changes ? 'participants_count' then nullif(btrim(p_changes->>'participants_count'),'')::integer else participants_count end,
    updated_at = now()
  where row_id = p_row_id
  returning * into v_row;

  return jsonb_build_object('row', to_jsonb(v_row));
end;
$function$;

revoke all on function public.create_israa_manual_activity(jsonb) from public, anon;
revoke all on function public.update_israa_manual_activity(text,jsonb) from public, anon;
grant execute on function public.create_israa_manual_activity(jsonb) to authenticated, service_role;
grant execute on function public.update_israa_manual_activity(text,jsonb) to authenticated, service_role;

comment on function public.create_israa_manual_activity(jsonb) is
  'Creates a school_2027 domain E activity from Israa management without a source proposal. Access is restricted by app_can_manage_israa().';
comment on function public.update_israa_manual_activity(text,jsonb) is
  'Updates only manually-created domain E activities from Israa management. Proposal-derived activities remain on update_israa_shared_activity().';

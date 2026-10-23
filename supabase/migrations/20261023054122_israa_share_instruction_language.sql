-- Preserve explicit instruction language throughout Israa drafts and publishing.
-- Keep existing permission/provenance/assignment gates and the mandatory-language constraint.
-- No activity data or language defaults are changed by this migration.

CREATE OR REPLACE FUNCTION public.create_israa_manual_activity(p_activity jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  if coalesce(nullif(btrim(p_activity->>'instruction_language'), ''), '') not in ('he', 'ar') then
    raise exception 'israa_instruction_language_required';
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
    activity_season, activity_domain, israa_shared, instruction_language
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
    false,
    btrim(p_activity->>'instruction_language')
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

CREATE OR REPLACE FUNCTION public.save_israa_activity_draft(p_tracking_id uuid, p_proposal_item_id uuid, p_draft jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tracking public.israa_program_tracking%rowtype;
  v_source_item jsonb;
  v_item public.proposal_agreement_items%rowtype;
  v_proposal public.proposals_agreements%rowtype;
  v_draft jsonb;
  v_existing_draft jsonb;
  v_instructor_emp_id text;
  v_instructor_name text;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;

  select * into v_tracking
  from public.israa_program_tracking
  where id = p_tracking_id
  for update;
  if not found then raise exception 'israa_tracking_not_found'; end if;

  select value into v_source_item
  from jsonb_array_elements(coalesce(v_tracking.proposal_items, '[]'::jsonb)) value
  where value->>'proposal_item_id' = p_proposal_item_id::text
  limit 1;
  if v_source_item is null then raise exception 'proposal_item_not_in_israa_tracking'; end if;

  select * into v_item
  from public.proposal_agreement_items
  where id = p_proposal_item_id
    and proposal_agreement_id = v_tracking.proposal_agreement_id;
  if not found then raise exception 'proposal_item_not_in_israa_tracking'; end if;

  select * into v_proposal
  from public.proposals_agreements
  where id = v_tracking.proposal_agreement_id;

  select value into v_existing_draft
  from jsonb_array_elements(coalesce(v_tracking.selected_activity_drafts, '[]'::jsonb)) value
  where value->>'proposal_item_id' = p_proposal_item_id::text
  limit 1;

  p_draft := coalesce(v_existing_draft, '{}'::jsonb) || coalesce(p_draft, '{}'::jsonb);

  if nullif(btrim(p_draft->>'instruction_language'), '') is not null and btrim(p_draft->>'instruction_language') not in ('he', 'ar') then
    raise exception 'israa_instruction_language_required';
  end if;

  v_instructor_emp_id := nullif(btrim(p_draft->>'emp_id'), '');
  if v_instructor_emp_id is not null then
    select ci.full_name
      into v_instructor_name
    from public.contacts_instructors ci
    where ci.emp_id = v_instructor_emp_id::bigint
      and lower(btrim(coalesce(ci.active, ''))) = 'yes';
    if not found then
      raise exception 'israa_instructor_not_active_or_missing';
    end if;
  end if;

  v_draft := jsonb_strip_nulls(jsonb_build_object(
    'proposal_item_id', p_proposal_item_id,
    'program_name', coalesce(nullif(btrim(p_draft->>'program_name'), ''), nullif(btrim(v_source_item->>'program_name'), ''), nullif(btrim(v_item.item_name), '')),
    'gefen_number', coalesce(nullif(btrim(p_draft->>'gefen_number'), ''), nullif(btrim(v_item.gefen_number), ''), nullif(btrim(v_source_item->>'gefen_number'), '')),
    'quantity', greatest(1, coalesce(v_item.quantity::integer, nullif(v_source_item->>'quantity', '')::integer, 1)),
    'activity_type', public.normalize_israa_activity_type(coalesce(nullif(p_draft->>'activity_type', ''), nullif(v_item.item_type, ''), v_source_item->>'item_type')),
    'activity_name', coalesce(nullif(btrim(p_draft->>'activity_name'), ''), nullif(btrim(v_item.item_name), ''), nullif(btrim(v_source_item->>'program_name'), '')),
    'activity_no', coalesce(nullif(btrim(p_draft->>'activity_no'), ''), nullif(btrim(v_item.activity_no), '')),
    'price', coalesce(
      nullif(btrim(p_draft->>'price'), '')::numeric,
      v_item.unit_price,
      v_item.total_price / nullif(greatest(1, coalesce(v_item.quantity, nullif(v_source_item->>'quantity', '')::numeric, 1)), 0)
    ),
    'funding', coalesce(nullif(btrim(p_draft->>'funding'), ''), case when nullif(btrim(v_item.gefen_number), '') is not null then 'גפן' end),
    'activity_manager', nullif(btrim(p_draft->>'activity_manager'), ''),
    'contact_name', coalesce(nullif(btrim(p_draft->>'contact_name'), ''), nullif(btrim(v_tracking.contact_person), ''), nullif(btrim(v_proposal.contact_name), '')),
    'contact_phone', coalesce(nullif(btrim(p_draft->>'contact_phone'), ''), nullif(btrim(v_tracking.phone), ''), nullif(btrim(v_proposal.contact_phone), ''), nullif(btrim(v_proposal.phone), '')),
    'contact_email', coalesce(nullif(btrim(p_draft->>'contact_email'), ''), nullif(btrim(v_tracking.email), ''), nullif(btrim(v_proposal.contact_email), ''), nullif(btrim(v_proposal.email), '')),
    'grade', coalesce(nullif(btrim(p_draft->>'grade'), ''), nullif(btrim(v_tracking.grade), '')),
    'class_group', nullif(btrim(p_draft->>'class_group'), ''),
    'sessions', coalesce(nullif(btrim(p_draft->>'sessions'), ''), v_item.meetings_count::text, v_source_item->>'meetings_count'),
    'start_date', nullif(btrim(p_draft->>'start_date'), ''),
    'start_time', nullif(btrim(p_draft->>'start_time'), ''),
    'end_time', nullif(btrim(p_draft->>'end_time'), ''),
    'emp_id', v_instructor_emp_id,
    'instructor_name', v_instructor_name,
    'instruction_language', nullif(btrim(p_draft->>'instruction_language'), ''),
    'group_overrides', p_draft->'group_overrides',
    'notes', nullif(btrim(p_draft->>'notes'), '')
  ));

  update public.israa_program_tracking
  set selected_activity_drafts = coalesce((
        select jsonb_agg(value)
        from jsonb_array_elements(selected_activity_drafts) value
        where value->>'proposal_item_id' <> p_proposal_item_id::text
      ), '[]'::jsonb) || jsonb_build_array(v_draft),
      updated_at = now()
  where id = p_tracking_id;

  return v_draft;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_israa_activity_group_draft(p_tracking_id uuid, p_proposal_item_id uuid, p_group_number integer, p_draft jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tracking public.israa_program_tracking%rowtype;
  v_base_draft jsonb;
  v_quantity integer;
  v_group_overrides jsonb;
  v_existing_override jsonb;
  v_changes jsonb;
  v_override jsonb;
  v_updated_draft jsonb;
  v_emp_id text;
  v_instructor_name text;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;

  select * into v_tracking
  from public.israa_program_tracking
  where id = p_tracking_id
  for update;
  if not found then raise exception 'israa_tracking_not_found'; end if;

  select value into v_base_draft
  from jsonb_array_elements(coalesce(v_tracking.selected_activity_drafts, '[]'::jsonb)) value
  where value->>'proposal_item_id' = p_proposal_item_id::text
  limit 1;
  if v_base_draft is null then raise exception 'israa_activity_not_selected'; end if;

  v_quantity := greatest(1, coalesce(nullif(v_base_draft->>'quantity', '')::integer, 1));
  if p_group_number is null or p_group_number < 1 or p_group_number > v_quantity then
    raise exception 'israa_group_number_invalid';
  end if;

  if nullif(btrim(p_draft->>'instruction_language'), '') is not null and btrim(p_draft->>'instruction_language') not in ('he', 'ar') then
    raise exception 'israa_instruction_language_required';
  end if;

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    into v_changes
  from jsonb_each(coalesce(p_draft, '{}'::jsonb))
  where key = any(array[
    'activity_type','activity_name','activity_no','gefen_number','price','funding',
    'activity_manager','contact_name','contact_phone','contact_email','grade',
    'class_group','sessions','start_date','end_date','start_time','end_time',
    'emp_id','notes','instruction_language'
  ]);

  v_group_overrides := case
    when jsonb_typeof(v_base_draft->'group_overrides') = 'object' then v_base_draft->'group_overrides'
    else '{}'::jsonb
  end;
  v_existing_override := coalesce(v_group_overrides->(p_group_number::text), '{}'::jsonb);
  v_override := v_existing_override || v_changes;

  if v_changes ? 'emp_id' then
    v_emp_id := nullif(btrim(v_override->>'emp_id'), '');
    if v_emp_id is not null then
      select ci.full_name
        into v_instructor_name
      from public.contacts_instructors ci
      where ci.emp_id = v_emp_id::bigint
        and lower(btrim(coalesce(ci.active, ''))) = 'yes';
      if not found then
        raise exception 'israa_instructor_not_active_or_missing';
      end if;
      v_override := jsonb_set(v_override, '{instructor_name}', to_jsonb(v_instructor_name), true);
    else
      v_override := jsonb_set(v_override, '{emp_id}', 'null'::jsonb, true);
      v_override := jsonb_set(v_override, '{instructor_name}', 'null'::jsonb, true);
    end if;
  end if;

  if nullif(btrim(v_override->>'class_group'), '') is null then
    v_override := jsonb_set(v_override, '{class_group}', to_jsonb('קבוצה ' || p_group_number), true);
  end if;

  v_group_overrides := jsonb_set(v_group_overrides, array[p_group_number::text], v_override, true);
  v_updated_draft := jsonb_set(v_base_draft, '{group_overrides}', v_group_overrides, true);

  update public.israa_program_tracking
  set selected_activity_drafts = coalesce((
        select jsonb_agg(
          case
            when value->>'proposal_item_id' = p_proposal_item_id::text then v_updated_draft
            else value
          end
        )
        from jsonb_array_elements(coalesce(selected_activity_drafts, '[]'::jsonb)) value
      ), '[]'::jsonb),
      updated_at = now()
  where id = p_tracking_id;

  return v_updated_draft;
end;
$function$;

CREATE OR REPLACE FUNCTION public.share_israa_activity(p_tracking_id uuid, p_proposal_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tracking public.israa_program_tracking%rowtype;
  v_base_draft jsonb;
  v_group_override jsonb;
  v_draft jsonb;
  v_item public.proposal_agreement_items%rowtype;
  v_proposal public.proposals_agreements%rowtype;
  v_quantity integer;
  v_activity_type text;
  v_group integer;
  v_row public.activities%rowtype;
  v_rows jsonb := '[]'::jsonb;
  v_row_id text;
  v_draft_emp_id text;
  v_draft_instructor_name text;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;

  select * into v_tracking
  from public.israa_program_tracking
  where id = p_tracking_id
  for update;
  if not found then raise exception 'israa_tracking_not_found'; end if;

  select value into v_base_draft
  from jsonb_array_elements(v_tracking.selected_activity_drafts) value
  where value->>'proposal_item_id' = p_proposal_item_id::text
  limit 1;
  if v_base_draft is null then raise exception 'israa_activity_not_selected'; end if;

  if not exists (
    select 1
    from jsonb_array_elements(coalesce(v_tracking.proposal_items, '[]'::jsonb)) source_item
    where source_item->>'proposal_item_id' = p_proposal_item_id::text
  ) then
    raise exception 'proposal_item_not_in_israa_tracking';
  end if;

  select * into v_item
  from public.proposal_agreement_items
  where id = p_proposal_item_id;
  if found and v_item.proposal_agreement_id <> v_tracking.proposal_agreement_id then
    raise exception 'proposal_item_not_in_israa_tracking';
  end if;

  select * into v_proposal
  from public.proposals_agreements
  where id = v_tracking.proposal_agreement_id;

  v_quantity := greatest(1, coalesce((v_base_draft->>'quantity')::integer, v_item.quantity::integer, 1));

  for v_group in 1..v_quantity loop
    v_group_override := coalesce(v_base_draft->'group_overrides'->(v_group::text), '{}'::jsonb);
    v_draft := (v_base_draft - 'group_overrides') || v_group_override;

    if coalesce(nullif(btrim(v_draft->>'instruction_language'), ''), '') not in ('he', 'ar') then
      raise exception 'israa_instruction_language_required';
    end if;


    v_activity_type := public.normalize_israa_activity_type(coalesce(v_draft->>'activity_type', v_item.item_type));
    if v_activity_type is not null then
      v_draft := jsonb_set(v_draft, '{activity_type}', to_jsonb(v_activity_type), true);
    end if;

    v_draft_emp_id := nullif(btrim(v_draft->>'emp_id'), '');
    v_draft_instructor_name := null;
    if v_draft_emp_id is not null then
      select ci.full_name
        into v_draft_instructor_name
      from public.contacts_instructors ci
      where ci.emp_id = v_draft_emp_id::bigint
        and lower(btrim(coalesce(ci.active, ''))) = 'yes';
      if not found then
        raise exception 'israa_instructor_not_active_or_missing';
      end if;
    end if;

    v_row_id := 'ISR-' || replace(p_tracking_id::text, '-', '') || '-' || replace(p_proposal_item_id::text, '-', '') || '-' || v_group;

    insert into public.activities (
      row_id, activity_family, authority, authority_id, school, school_id, grade, class_group,
      activity_type, item_type, activity_no, gefen_number, activity_name, program_name, name, title,
      sessions, price, funding, contact_name, contact_phone, contact_email, start_date, date_1,
      start_time, end_time, notes, status, activity_season, activity_domain, proposal_agreement_id,
      draft_emp_id, draft_instructor_name, draft_created_at, draft_created_by,
      israa_tracking_id, israa_source_item_id, israa_group_number, instruction_language
    ) values (
      v_row_id,
      case when v_activity_type in ('course','after_school') then 'program' when v_activity_type is not null then 'one_day' end,
      v_tracking.authority,
      v_tracking.authority_id,
      v_tracking.school_name,
      v_tracking.school_id,
      v_draft->>'grade',
      coalesce(nullif(v_draft->>'class_group',''), 'קבוצה ' || v_group),
      v_activity_type,
      v_activity_type,
      coalesce(nullif(v_draft->>'activity_no',''), nullif(v_item.activity_no,'')),
      coalesce(nullif(v_draft->>'gefen_number',''), nullif(v_item.gefen_number,'')),
      coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
      coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
      coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
      coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
      coalesce(nullif(v_draft->>'sessions',''), v_item.meetings_count::text),
      coalesce(
        nullif(v_draft->>'price','')::numeric::bigint,
        round(coalesce(v_item.unit_price, v_item.total_price / nullif(greatest(1, coalesce(v_item.quantity, 1)), 0)))::bigint
      ),
      coalesce(nullif(v_draft->>'funding',''), case when nullif(btrim(v_item.gefen_number),'') is not null then 'גפן' end),
      coalesce(nullif(v_draft->>'contact_name',''), nullif(v_tracking.contact_person,''), nullif(v_proposal.contact_name,'')),
      coalesce(nullif(v_draft->>'contact_phone',''), nullif(v_tracking.phone,''), nullif(v_proposal.contact_phone,''), nullif(v_proposal.phone,'')),
      coalesce(nullif(v_draft->>'contact_email',''), nullif(v_tracking.email,''), nullif(v_proposal.contact_email,''), nullif(v_proposal.email,'')),
      nullif(v_draft->>'start_date','')::date,
      nullif(v_draft->>'start_date','')::date,
      nullif(v_draft->>'start_time','')::time,
      nullif(v_draft->>'end_time','')::time,
      v_draft->>'notes',
      'פתוח',
      'school_2027',
      'E',
      v_tracking.proposal_agreement_id,
      v_draft_emp_id,
      v_draft_instructor_name,
      case when v_draft_emp_id is not null then now() else null end,
      case when v_draft_emp_id is not null then auth.uid() else null end,
      p_tracking_id,
      p_proposal_item_id,
      v_group,
      btrim(v_draft->>'instruction_language')
    )
    on conflict (israa_tracking_id, israa_source_item_id, israa_group_number)
      where israa_tracking_id is not null
    do update set
      draft_emp_id = case
        when public.activities.emp_id is null then excluded.draft_emp_id
        else public.activities.draft_emp_id
      end,
      draft_instructor_name = case
        when public.activities.emp_id is null then excluded.draft_instructor_name
        else public.activities.draft_instructor_name
      end,
      draft_created_at = case
        when public.activities.emp_id is null
          and public.activities.draft_emp_id is distinct from excluded.draft_emp_id
          then excluded.draft_created_at
        else public.activities.draft_created_at
      end,
      draft_created_by = case
        when public.activities.emp_id is null
          and public.activities.draft_emp_id is distinct from excluded.draft_emp_id
          then excluded.draft_created_by
        else public.activities.draft_created_by
      end,
      updated_at = public.activities.updated_at
    returning * into v_row;

    v_rows := v_rows || jsonb_build_array(to_jsonb(v_row));
  end loop;

  return jsonb_build_object('activities', v_rows, 'created_count', v_quantity);
end;
$function$;

CREATE OR REPLACE FUNCTION public.share_israa_activity_group(p_tracking_id uuid, p_proposal_item_id uuid, p_group_number integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tracking public.israa_program_tracking%rowtype;
  v_base_draft jsonb;
  v_group_override jsonb;
  v_draft jsonb;
  v_item public.proposal_agreement_items%rowtype;
  v_proposal public.proposals_agreements%rowtype;
  v_quantity integer;
  v_activity_type text;
  v_row public.activities%rowtype;
  v_row_id text;
  v_draft_emp_id text;
  v_draft_instructor_name text;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;

  select * into v_tracking
  from public.israa_program_tracking
  where id = p_tracking_id
  for update;
  if not found then raise exception 'israa_tracking_not_found'; end if;

  select value into v_base_draft
  from jsonb_array_elements(coalesce(v_tracking.selected_activity_drafts, '[]'::jsonb)) value
  where value->>'proposal_item_id' = p_proposal_item_id::text
  limit 1;
  if v_base_draft is null then raise exception 'israa_activity_not_selected'; end if;

  if not exists (
    select 1
    from jsonb_array_elements(coalesce(v_tracking.proposal_items, '[]'::jsonb)) source_item
    where source_item->>'proposal_item_id' = p_proposal_item_id::text
  ) then
    raise exception 'proposal_item_not_in_israa_tracking';
  end if;

  select * into v_item
  from public.proposal_agreement_items
  where id = p_proposal_item_id;
  if found and v_item.proposal_agreement_id <> v_tracking.proposal_agreement_id then
    raise exception 'proposal_item_not_in_israa_tracking';
  end if;

  select * into v_proposal
  from public.proposals_agreements
  where id = v_tracking.proposal_agreement_id;

  v_quantity := greatest(1, coalesce((v_base_draft->>'quantity')::integer, v_item.quantity::integer, 1));
  if p_group_number is null or p_group_number < 1 or p_group_number > v_quantity then
    raise exception 'israa_group_number_invalid';
  end if;

  v_group_override := coalesce(v_base_draft->'group_overrides'->(p_group_number::text), '{}'::jsonb);
  v_draft := (v_base_draft - 'group_overrides') || v_group_override;

  if coalesce(nullif(btrim(v_draft->>'instruction_language'), ''), '') not in ('he', 'ar') then
    raise exception 'israa_instruction_language_required';
  end if;


  v_activity_type := public.normalize_israa_activity_type(coalesce(v_draft->>'activity_type', v_item.item_type));
  if v_activity_type is not null then
    v_draft := jsonb_set(v_draft, '{activity_type}', to_jsonb(v_activity_type), true);
  end if;

  v_draft_emp_id := nullif(btrim(v_draft->>'emp_id'), '');
  if v_draft_emp_id is not null then
    select ci.full_name
      into v_draft_instructor_name
    from public.contacts_instructors ci
    where ci.emp_id = v_draft_emp_id::bigint
      and lower(btrim(coalesce(ci.active, ''))) = 'yes';
    if not found then
      raise exception 'israa_instructor_not_active_or_missing';
    end if;
  end if;

  v_row_id := 'ISR-' || replace(p_tracking_id::text, '-', '') || '-' || replace(p_proposal_item_id::text, '-', '') || '-' || p_group_number;

  insert into public.activities (
    row_id, activity_family, authority, authority_id, school, school_id, grade, class_group,
    activity_type, item_type, activity_no, gefen_number, activity_name, program_name, name, title,
    sessions, price, funding, contact_name, contact_phone, contact_email, start_date, date_1,
    start_time, end_time, notes, status, activity_season, activity_domain, proposal_agreement_id,
    draft_emp_id, draft_instructor_name, draft_created_at, draft_created_by,
    israa_tracking_id, israa_source_item_id, israa_group_number, instruction_language
  ) values (
    v_row_id,
    case when v_activity_type in ('course','after_school') then 'program' when v_activity_type is not null then 'one_day' end,
    v_tracking.authority,
    v_tracking.authority_id,
    v_tracking.school_name,
    v_tracking.school_id,
    v_draft->>'grade',
    coalesce(nullif(v_draft->>'class_group',''), 'קבוצה ' || p_group_number),
    v_activity_type,
    v_activity_type,
    coalesce(nullif(v_draft->>'activity_no',''), nullif(v_item.activity_no,'')),
    coalesce(nullif(v_draft->>'gefen_number',''), nullif(v_item.gefen_number,'')),
    coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
    coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
    coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
    coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
    coalesce(nullif(v_draft->>'sessions',''), v_item.meetings_count::text),
    coalesce(
      nullif(v_draft->>'price','')::numeric::bigint,
      round(coalesce(v_item.unit_price, v_item.total_price / nullif(greatest(1, coalesce(v_item.quantity, 1)), 0)))::bigint
    ),
    coalesce(nullif(v_draft->>'funding',''), case when nullif(btrim(v_item.gefen_number),'') is not null then 'גפן' end),
    coalesce(nullif(v_draft->>'contact_name',''), nullif(v_tracking.contact_person,''), nullif(v_proposal.contact_name,'')),
    coalesce(nullif(v_draft->>'contact_phone',''), nullif(v_tracking.phone,''), nullif(v_proposal.contact_phone,''), nullif(v_proposal.phone,'')),
    coalesce(nullif(v_draft->>'contact_email',''), nullif(v_tracking.email,''), nullif(v_proposal.contact_email,''), nullif(v_proposal.email,'')),
    nullif(v_draft->>'start_date','')::date,
    nullif(v_draft->>'start_date','')::date,
    nullif(v_draft->>'start_time','')::time,
    nullif(v_draft->>'end_time','')::time,
    v_draft->>'notes',
    'פתוח',
    'school_2027',
    'E',
    v_tracking.proposal_agreement_id,
    v_draft_emp_id,
    v_draft_instructor_name,
    case when v_draft_emp_id is not null then now() else null end,
    case when v_draft_emp_id is not null then auth.uid() else null end,
    p_tracking_id,
    p_proposal_item_id,
    p_group_number,
    btrim(v_draft->>'instruction_language')
  )
  on conflict (israa_tracking_id, israa_source_item_id, israa_group_number)
    where israa_tracking_id is not null
  do update set
    draft_emp_id = case
      when public.activities.emp_id is null then excluded.draft_emp_id
      else public.activities.draft_emp_id
    end,
    draft_instructor_name = case
      when public.activities.emp_id is null then excluded.draft_instructor_name
      else public.activities.draft_instructor_name
    end,
    draft_created_at = case
      when public.activities.emp_id is null
        and public.activities.draft_emp_id is distinct from excluded.draft_emp_id
        then excluded.draft_created_at
      else public.activities.draft_created_at
    end,
    draft_created_by = case
      when public.activities.emp_id is null
        and public.activities.draft_emp_id is distinct from excluded.draft_emp_id
        then excluded.draft_created_by
      else public.activities.draft_created_by
    end,
    updated_at = public.activities.updated_at
  returning * into v_row;

  return jsonb_build_object(
    'activity', to_jsonb(v_row),
    'created_count', 1,
    'group_number', p_group_number
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_israa_manual_activity(p_row_id text, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  if nullif(btrim(p_changes->>'instruction_language'), '') is not null and btrim(p_changes->>'instruction_language') not in ('he', 'ar') then
    raise exception 'israa_instruction_language_required';
  end if;

  v_type := case when p_changes ? 'activity_type'
    then public.normalize_israa_activity_type(p_changes->>'activity_type')
    else v_row.activity_type
  end;

  update public.activities set
    instruction_language = case when p_changes ? 'instruction_language' then nullif(btrim(p_changes->>'instruction_language'),'') else instruction_language end,
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

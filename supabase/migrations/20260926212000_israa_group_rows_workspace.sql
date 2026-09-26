-- Expand proposal quantities into separate editable Israa activity rows.
-- The base selected draft stays one record per proposal item; per-group edits are
-- stored in group_overrides and applied when publishing to main activities.

create or replace function public.save_israa_activity_group_draft(
  p_tracking_id uuid,
  p_proposal_item_id uuid,
  p_group_number integer,
  p_draft jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    into v_changes
  from jsonb_each(coalesce(p_draft, '{}'::jsonb))
  where key = any(array[
    'activity_type','activity_name','activity_no','gefen_number','price','funding',
    'activity_manager','contact_name','contact_phone','contact_email','grade',
    'class_group','sessions','start_date','end_date','start_time','end_time',
    'emp_id','notes'
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
$$;

grant execute on function public.save_israa_activity_group_draft(uuid,uuid,integer,jsonb)
  to authenticated, service_role;

create or replace function public.share_israa_activity(
  p_tracking_id uuid,
  p_proposal_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
      israa_tracking_id, israa_source_item_id, israa_group_number
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
      v_group
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
$$;

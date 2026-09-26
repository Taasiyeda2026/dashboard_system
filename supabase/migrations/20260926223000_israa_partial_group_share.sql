-- Allow publishing one selected Israa group at a time while keeping the
-- remaining groups in Israa's private activities workspace.

create or replace function public.share_israa_activity_group(
  p_tracking_id uuid,
  p_proposal_item_id uuid,
  p_group_number integer
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
    israa_tracking_id, israa_source_item_id, israa_group_number
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
    p_group_number
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
$$;

revoke all on function public.share_israa_activity_group(uuid,uuid,integer) from public, anon;
grant execute on function public.share_israa_activity_group(uuid,uuid,integer) to authenticated, service_role;

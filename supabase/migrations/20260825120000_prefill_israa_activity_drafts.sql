-- Populate Israa private activity drafts from their canonical proposal line and
-- proposal/tracking metadata. Existing draft values remain authoritative.
create or replace function public.save_israa_activity_draft(
  p_tracking_id uuid,
  p_proposal_item_id uuid,
  p_draft jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tracking public.israa_program_tracking%rowtype;
  v_source_item jsonb;
  v_item public.proposal_agreement_items%rowtype;
  v_proposal public.proposals_agreements%rowtype;
  v_draft jsonb;
  v_existing_draft jsonb;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;
  select * into v_tracking from public.israa_program_tracking where id = p_tracking_id for update;
  if not found then raise exception 'israa_tracking_not_found'; end if;
  select value into v_source_item
  from jsonb_array_elements(coalesce(v_tracking.proposal_items, '[]'::jsonb)) value
  where value->>'proposal_item_id' = p_proposal_item_id::text limit 1;
  if v_source_item is null then raise exception 'proposal_item_not_in_israa_tracking'; end if;
  select * into v_item from public.proposal_agreement_items
  where id = p_proposal_item_id and proposal_agreement_id = v_tracking.proposal_agreement_id;
  if not found then raise exception 'proposal_item_not_in_israa_tracking'; end if;
  select * into v_proposal from public.proposals_agreements
  where id = v_tracking.proposal_agreement_id;
  select value into v_existing_draft
  from jsonb_array_elements(coalesce(v_tracking.selected_activity_drafts, '[]'::jsonb)) value
  where value->>'proposal_item_id' = p_proposal_item_id::text limit 1;
  p_draft := coalesce(v_existing_draft, '{}'::jsonb) || coalesce(p_draft, '{}'::jsonb);

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
    'notes', nullif(btrim(p_draft->>'notes'), '')
  ));
  update public.israa_program_tracking
  set selected_activity_drafts = coalesce((
        select jsonb_agg(value) from jsonb_array_elements(selected_activity_drafts) value
        where value->>'proposal_item_id' <> p_proposal_item_id::text
      ), '[]'::jsonb) || jsonb_build_array(v_draft),
      updated_at = now()
  where id = p_tracking_id;
  return v_draft;
end;
$$;

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
  v_draft jsonb;
  v_item public.proposal_agreement_items%rowtype;
  v_proposal public.proposals_agreements%rowtype;
  v_quantity integer;
  v_activity_type text;
  v_group integer;
  v_row public.activities%rowtype;
  v_rows jsonb := '[]'::jsonb;
  v_row_id text;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;
  select * into v_tracking from public.israa_program_tracking where id = p_tracking_id for update;
  if not found then raise exception 'israa_tracking_not_found'; end if;
  select value into v_draft from jsonb_array_elements(v_tracking.selected_activity_drafts) value
  where value->>'proposal_item_id' = p_proposal_item_id::text limit 1;
  if v_draft is null then raise exception 'israa_activity_not_selected'; end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(v_tracking.proposal_items, '[]'::jsonb)) source_item
    where source_item->>'proposal_item_id' = p_proposal_item_id::text
  ) then raise exception 'proposal_item_not_in_israa_tracking'; end if;
  select * into v_item from public.proposal_agreement_items where id = p_proposal_item_id;
  if found and v_item.proposal_agreement_id <> v_tracking.proposal_agreement_id then
    raise exception 'proposal_item_not_in_israa_tracking';
  end if;
  select * into v_proposal from public.proposals_agreements where id = v_tracking.proposal_agreement_id;
  v_activity_type := public.normalize_israa_activity_type(coalesce(v_draft->>'activity_type', v_item.item_type));
  if v_activity_type is not null then
    v_draft := jsonb_set(v_draft, '{activity_type}', to_jsonb(v_activity_type), true);
  end if;
  v_quantity := greatest(1, coalesce((v_draft->>'quantity')::integer, 1));

  for v_group in 1..v_quantity loop
    v_row_id := 'ISR-' || replace(p_tracking_id::text, '-', '') || '-' || replace(p_proposal_item_id::text, '-', '') || '-' || v_group;
    insert into public.activities (
      row_id, activity_family, authority, authority_id, school, school_id, grade, class_group,
      activity_type, item_type, activity_no, gefen_number, activity_name, program_name, name, title,
      sessions, price, funding, contact_name, contact_phone, contact_email, start_date, date_1,
      start_time, end_time, notes, status, activity_season, activity_domain, proposal_agreement_id,
      israa_tracking_id, israa_source_item_id, israa_group_number
    ) values (
      v_row_id, case when v_activity_type in ('course','after_school') then 'program' when v_activity_type is not null then 'one_day' end,
      v_tracking.authority, v_tracking.authority_id, v_tracking.school_name, v_tracking.school_id, v_draft->>'grade',
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
      nullif(v_draft->>'start_date','')::date, nullif(v_draft->>'start_date','')::date,
      nullif(v_draft->>'start_time','')::time, nullif(v_draft->>'end_time','')::time, v_draft->>'notes', 'פתוח', 'school_2027', 'E', v_tracking.proposal_agreement_id,
      p_tracking_id, p_proposal_item_id, v_group
    )
    on conflict (israa_tracking_id, israa_source_item_id, israa_group_number)
      where israa_tracking_id is not null
    do update set updated_at = public.activities.updated_at
    returning * into v_row;
    v_rows := v_rows || jsonb_build_array(to_jsonb(v_row));
  end loop;
  return jsonb_build_object('activities', v_rows, 'created_count', v_quantity);
end;
$$;

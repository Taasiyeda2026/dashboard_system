-- Private Israa activity drafts live on the tracking row. Once shared, the
-- canonical record lives only in activities and is identified by three small
-- source columns (tracking row, proposal item, group number).
alter table public.israa_program_tracking
  add column if not exists selected_activity_drafts jsonb not null default '[]'::jsonb;

alter table public.activities
  add column if not exists israa_tracking_id uuid,
  add column if not exists israa_source_item_id uuid,
  add column if not exists israa_group_number integer;

create unique index if not exists activities_israa_source_group_uidx
  on public.activities (israa_tracking_id, israa_source_item_id, israa_group_number)
  where israa_tracking_id is not null;

create index if not exists activities_israa_tracking_idx
  on public.activities (israa_tracking_id)
  where israa_tracking_id is not null;

create or replace function public.app_can_manage_israa()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.app_current_role() = 'admin'
    or public.app_has_permission('view_israa_management'),
    false
  );
$$;

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
  v_item jsonb;
  v_draft jsonb;
  v_existing_draft jsonb;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;
  select * into v_tracking from public.israa_program_tracking where id = p_tracking_id for update;
  if not found then raise exception 'israa_tracking_not_found'; end if;
  select value into v_item
  from jsonb_array_elements(coalesce(v_tracking.proposal_items, '[]'::jsonb)) value
  where value->>'proposal_item_id' = p_proposal_item_id::text limit 1;
  if v_item is null then raise exception 'proposal_item_not_in_israa_tracking'; end if;
  select value into v_existing_draft
  from jsonb_array_elements(coalesce(v_tracking.selected_activity_drafts, '[]'::jsonb)) value
  where value->>'proposal_item_id' = p_proposal_item_id::text limit 1;
  p_draft := coalesce(v_existing_draft, '{}'::jsonb) || coalesce(p_draft, '{}'::jsonb);

  v_draft := jsonb_strip_nulls(jsonb_build_object(
    'proposal_item_id', p_proposal_item_id,
    'program_name', coalesce(nullif(btrim(p_draft->>'program_name'), ''), v_item->>'program_name'),
    'gefen_number', coalesce(nullif(btrim(p_draft->>'gefen_number'), ''), v_item->>'gefen_number'),
    'quantity', greatest(1, coalesce((v_item->>'quantity')::integer, 1)),
    'activity_type', coalesce(nullif(btrim(p_draft->>'activity_type'), ''), 'course'),
    'activity_name', nullif(btrim(p_draft->>'activity_name'), ''),
    'activity_no', nullif(btrim(p_draft->>'activity_no'), ''),
    'price', nullif(btrim(p_draft->>'price'), ''),
    'funding', nullif(btrim(p_draft->>'funding'), ''),
    'activity_manager', nullif(btrim(p_draft->>'activity_manager'), ''),
    'contact_name', nullif(btrim(p_draft->>'contact_name'), ''),
    'contact_phone', nullif(btrim(p_draft->>'contact_phone'), ''),
    'contact_email', nullif(btrim(p_draft->>'contact_email'), ''),
    'grade', nullif(btrim(p_draft->>'grade'), ''),
    'class_group', nullif(btrim(p_draft->>'class_group'), ''),
    'sessions', coalesce(nullif(btrim(p_draft->>'sessions'), ''), v_item->>'meetings_count'),
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
  select * into v_item from public.proposal_agreement_items where id = p_proposal_item_id;
  if found and v_item.proposal_agreement_id <> v_tracking.proposal_agreement_id then
    raise exception 'proposal_item_not_in_israa_tracking';
  end if;
  select * into v_proposal from public.proposals_agreements where id = v_tracking.proposal_agreement_id;
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
      v_row_id, case when coalesce(v_draft->>'activity_type','course') in ('course','after_school') then 'program' else 'one_day' end,
      v_tracking.authority, v_tracking.authority_id, v_tracking.school_name, v_tracking.school_id, v_draft->>'grade',
      coalesce(nullif(v_draft->>'class_group',''), 'קבוצה ' || v_group),
      coalesce(nullif(v_draft->>'activity_type',''), nullif(v_item.item_type,''), 'course'),
      coalesce(nullif(v_draft->>'activity_type',''), nullif(v_item.item_type,''), 'course'),
      coalesce(nullif(v_draft->>'activity_no',''), nullif(v_item.activity_no,'')),
      coalesce(nullif(v_draft->>'gefen_number',''), nullif(v_item.gefen_number,'')),
      coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
      coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
      coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
      coalesce(nullif(v_draft->>'activity_name',''), nullif(v_draft->>'program_name',''), nullif(v_item.item_name,'')),
      coalesce(nullif(v_draft->>'sessions',''), v_item.meetings_count::text),
      coalesce(nullif(v_draft->>'price',''), round(coalesce(v_item.total_price, v_item.unit_price))::bigint::text),
      coalesce(nullif(v_draft->>'funding',''), case when nullif(btrim(v_item.gefen_number),'') is not null then 'גפן' end),
      coalesce(nullif(v_draft->>'contact_name',''), nullif(v_tracking.contact_person,''), nullif(v_proposal.contact_name,'')),
      coalesce(nullif(v_draft->>'contact_phone',''), nullif(v_tracking.phone,''), nullif(v_proposal.contact_phone,''), nullif(v_proposal.phone,'')),
      coalesce(nullif(v_draft->>'contact_email',''), nullif(v_tracking.email,''), nullif(v_proposal.contact_email,''), nullif(v_proposal.email,'')),
      v_draft->>'start_date', v_draft->>'start_date',
      v_draft->>'start_time', v_draft->>'end_time', v_draft->>'notes', 'פתוח', 'school_2027', 'E', v_tracking.proposal_agreement_id,
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

create or replace function public.update_israa_shared_activity(p_row_id text, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.activities%rowtype;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;
  select * into v_row from public.activities
  where row_id = p_row_id and activity_domain = 'E' and israa_tracking_id is not null for update;
  if not found then raise exception 'israa_activity_edit_forbidden' using errcode = '42501'; end if;
  update public.activities set
    activity_manager = case when p_changes ? 'activity_manager' then nullif(btrim(p_changes->>'activity_manager'),'') else activity_manager end,
    activity_type = case when p_changes ? 'activity_type' then nullif(btrim(p_changes->>'activity_type'),'') else activity_type end,
    item_type = case when p_changes ? 'activity_type' then nullif(btrim(p_changes->>'activity_type'),'') else item_type end,
    activity_no = case when p_changes ? 'activity_no' then nullif(btrim(p_changes->>'activity_no'),'') else activity_no end,
    gefen_number = case when p_changes ? 'gefen_number' then nullif(btrim(p_changes->>'gefen_number'),'') else gefen_number end,
    activity_name = case when p_changes ? 'activity_name' then nullif(btrim(p_changes->>'activity_name'),'') else activity_name end,
    sessions = case when p_changes ? 'sessions' then nullif(btrim(p_changes->>'sessions'),'') else sessions end,
    price = case when p_changes ? 'price' then nullif(btrim(p_changes->>'price'),'') else price end,
    funding = case when p_changes ? 'funding' then nullif(btrim(p_changes->>'funding'),'') else funding end,
    contact_name = case when p_changes ? 'contact_name' then nullif(btrim(p_changes->>'contact_name'),'') else contact_name end,
    contact_phone = case when p_changes ? 'contact_phone' then nullif(btrim(p_changes->>'contact_phone'),'') else contact_phone end,
    contact_email = case when p_changes ? 'contact_email' then nullif(btrim(p_changes->>'contact_email'),'') else contact_email end,
    emp_id = case when p_changes ? 'emp_id' then nullif(btrim(p_changes->>'emp_id'),'') else emp_id end,
    instructor_name = case when p_changes ? 'instructor_name' then nullif(btrim(p_changes->>'instructor_name'),'') else instructor_name end,
    emp_id_2 = case when p_changes ? 'emp_id_2' then nullif(btrim(p_changes->>'emp_id_2'),'') else emp_id_2 end,
    instructor_name_2 = case when p_changes ? 'instructor_name_2' then nullif(btrim(p_changes->>'instructor_name_2'),'') else instructor_name_2 end,
    grade = case when p_changes ? 'grade' then nullif(btrim(p_changes->>'grade'),'') else grade end,
    class_group = case when p_changes ? 'class_group' then nullif(btrim(p_changes->>'class_group'),'') else class_group end,
    start_date = case when p_changes ? 'start_date' then nullif(btrim(p_changes->>'start_date'),'') else start_date end,
    date_1 = case when p_changes ? 'start_date' then nullif(btrim(p_changes->>'start_date'),'') else date_1 end,
    end_date = case when p_changes ? 'end_date' then nullif(btrim(p_changes->>'end_date'),'') else end_date end,
    start_time = case when p_changes ? 'start_time' then nullif(btrim(p_changes->>'start_time'),'') else start_time end,
    end_time = case when p_changes ? 'end_time' then nullif(btrim(p_changes->>'end_time'),'') else end_time end,
    notes = case when p_changes ? 'notes' then nullif(btrim(p_changes->>'notes'),'') else notes end,
    updated_at = now()
  where row_id = p_row_id returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.app_can_manage_israa() from public, anon;
revoke all on function public.save_israa_activity_draft(uuid,uuid,jsonb) from public, anon;
revoke all on function public.share_israa_activity(uuid,uuid) from public, anon;
revoke all on function public.update_israa_shared_activity(text,jsonb) from public, anon;
grant execute on function public.app_can_manage_israa() to authenticated, service_role;
grant execute on function public.save_israa_activity_draft(uuid,uuid,jsonb) to authenticated, service_role;
grant execute on function public.share_israa_activity(uuid,uuid) to authenticated, service_role;
grant execute on function public.update_israa_shared_activity(text,jsonb) to authenticated, service_role;

-- Preserve the Y guard while allowing only the dedicated, provenance-marked E path.
create or replace function public.guard_proposal_linked_activity_domain_y()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_proposal_id uuid; v_domain text;
begin
  if new.israa_tracking_id is not null then
    if new.activity_domain <> 'E' or new.israa_source_item_id is null or new.israa_group_number < 1
       or not exists (select 1 from public.israa_program_tracking t where t.id = new.israa_tracking_id) then
      raise exception 'invalid_israa_activity_source' using errcode = '23514';
    end if;
    return new;
  end if;
  v_proposal_id := new.proposal_agreement_id;
  if v_proposal_id is null and new.proposal_item_id is not null then
    select pai.proposal_agreement_id into v_proposal_id from public.proposal_agreement_items pai where pai.id = new.proposal_item_id;
  end if;
  if v_proposal_id is null then return new; end if;
  select upper(btrim(coalesce(pa.proposal_domain,''))) into v_domain from public.proposals_agreements pa where pa.id = v_proposal_id;
  if coalesce(v_domain,'') <> 'Y' then raise exception 'proposal_domain_not_routed_to_activities' using errcode = '23514'; end if;
  return new;
end; $$;

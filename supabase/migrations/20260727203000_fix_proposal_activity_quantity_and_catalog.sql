-- Fix proposal -> activity creation for school year 2027.
-- One proposal item creates one activity row per quoted group/quantity.
-- Catalog data supplies the operational activity type and short display name.

alter table public.activities
  add column if not exists proposal_item_sequence integer;

update public.activities a
set proposal_item_sequence = numbered.sequence_no
from (
  select id,
         row_number() over (
           partition by proposal_item_id
           order by created_at nulls last, id, row_id
         )::integer as sequence_no
  from public.activities
  where proposal_item_id is not null
) numbered
where a.id = numbered.id
  and a.proposal_item_sequence is null;

alter table public.activities
  drop constraint if exists activities_proposal_item_sequence_positive;

alter table public.activities
  add constraint activities_proposal_item_sequence_positive
  check (proposal_item_sequence is null or proposal_item_sequence >= 1);

drop index if exists public.activities_proposal_item_id_uidx;

create unique index if not exists activities_proposal_item_sequence_uidx
  on public.activities (proposal_item_id, proposal_item_sequence)
  where proposal_item_id is not null;

create index if not exists activities_proposal_item_id_idx
  on public.activities (proposal_item_id)
  where proposal_item_id is not null;

create or replace function public.proposal_item_required_activity_count(
  p_quantity numeric
)
returns integer
language sql
immutable
parallel safe
as $function$
  select greatest(1, least(100, coalesce(floor(p_quantity)::integer, 1)));
$function$;

create or replace function public.create_activity_from_proposal_item(
  p_proposal_item_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_item public.proposal_agreement_items%rowtype;
  v_proposal public.proposals_agreements%rowtype;
  v_proposal_group text;
  v_item_group text;
  v_status text;
  v_is_gefen boolean;
  v_required_count integer;
  v_created_count integer := 0;
  v_catalog_name text;
  v_catalog_type text;
  v_activity_type text;
  v_activity_family text;
  v_short_name text;
  v_sequence integer;
  v_row_id text;
  v_activity public.activities%rowtype;
  v_activities jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if not (
    public.app_can_add_activity()
    or public.app_can_manage_proposals_agreements()
  ) then
    raise exception 'create_activity_from_proposal_forbidden' using errcode = '42501';
  end if;

  select *
  into v_item
  from public.proposal_agreement_items
  where id = p_proposal_item_id;

  if not found then
    raise exception 'proposal_item_not_found';
  end if;

  select *
  into v_proposal
  from public.proposals_agreements
  where id = v_item.proposal_agreement_id
    and archived_at is null;

  if not found then
    raise exception 'proposal_not_found_or_archived';
  end if;

  v_status := lower(trim(coalesce(v_proposal.status, '')));
  if v_status not in ('approved', 'sent', 'מאושר', 'מאושר וחתום', 'נשלח') then
    raise exception 'proposal_must_be_approved_or_sent';
  end if;

  v_proposal_group := lower(trim(coalesce(v_proposal.activity_type_group, '')));
  v_item_group := lower(trim(coalesce(v_item.proposal_group, '')));

  if not (
    v_proposal_group in ('next_year', 'gefen', 'combined')
    or trim(coalesce(v_proposal.activity_type_group, '')) in (
      'תשפ"ז', 'תשפ״ז', 'גפן', 'גפ"ן', 'גפ״ן',
      'שנת הלימודים תשפ"ז', 'שנת הלימודים תשפ״ז',
      'תוכניות תשפ"ז', 'תוכניות תשפ״ז'
    )
  ) then
    raise exception 'proposal_is_not_for_school_2027';
  end if;

  if v_item_group in ('summer', 'קיץ', 'קיץ תשפ"ו', 'קיץ תשפ״ו')
    or coalesce(v_item.item_name, '') ~* '(שעות[[:space:]]*)?בדיק(ה|ות)?'
  then
    raise exception 'proposal_item_is_not_a_2027_activity';
  end if;

  select
    nullif(trim(coalesce(l.activity_name, l.label_he, l.label, '')), ''),
    nullif(trim(coalesce(l.activity_type, l.type, l.parent_value, '')), '')
  into v_catalog_name, v_catalog_type
  from public.lists l
  where l.category = 'activity_names'
    and coalesce(l.is_active, l.active, true)
    and (
      (v_item.list_id is not null and l.list_id = v_item.list_id)
      or (trim(coalesce(v_item.activity_no, '')) <> '' and trim(coalesce(l.activity_no, '')) = trim(v_item.activity_no))
      or (trim(coalesce(v_item.gefen_number, '')) <> '' and trim(coalesce(l.gefen_number, '')) = trim(v_item.gefen_number))
      or (trim(coalesce(v_item.activity_no, '')) <> '' and trim(coalesce(l.value, '')) = trim(v_item.activity_no))
    )
  order by
    case when v_item.list_id is not null and l.list_id = v_item.list_id then 0 else 1 end,
    case when trim(coalesce(l.activity_no, '')) = trim(coalesce(v_item.activity_no, '')) then 0 else 1 end,
    l.sort_order nulls last,
    l.list_id
  limit 1;

  v_activity_type := lower(trim(coalesce(v_catalog_type, '')));
  if v_activity_type in ('course', 'program', 'תוכנית', 'תכנית', 'קורס')
    or lower(trim(coalesce(v_item.item_type, ''))) in ('course', 'program', 'תוכנית', 'תכנית', 'קורס')
  then
    v_activity_type := 'course';
    v_activity_family := 'program';
  elsif v_activity_type in ('workshop', 'סדנה')
    or lower(trim(coalesce(v_item.item_type, ''))) in ('workshop', 'סדנה')
  then
    v_activity_type := 'workshop';
    v_activity_family := 'workshop';
  elsif v_activity_type in ('tour', 'סיור')
    or lower(trim(coalesce(v_item.item_type, ''))) in ('tour', 'סיור')
  then
    v_activity_type := 'tour';
    v_activity_family := 'tour';
  else
    -- A quoted "program" is operationally a course in the activities module.
    v_activity_type := 'course';
    v_activity_family := 'program';
  end if;

  v_short_name := coalesce(v_catalog_name, nullif(trim(v_item.item_name), ''), 'ללא שם פעילות');
  v_required_count := public.proposal_item_required_activity_count(v_item.quantity);
  v_is_gefen :=
    trim(coalesce(v_item.gefen_number, '')) <> ''
    or v_proposal_group = 'gefen'
    or trim(coalesce(v_proposal.activity_type_group, '')) in ('גפן', 'גפ"ן', 'גפ״ן');

  -- Repair any rows previously created by the first version of this workflow.
  update public.activities a
  set activity_family = v_activity_family,
      activity_type = v_activity_type,
      item_type = v_activity_type,
      activity_name = v_short_name,
      program_name = null,
      name = null,
      title = null,
      class_group = coalesce(a.class_group, ''),
      price = case
        when v_item.unit_price is not null then round(v_item.unit_price)::bigint
        when v_item.total_price is not null then round(v_item.total_price / v_required_count)::bigint
        else a.price
      end,
      proposal_item_sequence = coalesce(a.proposal_item_sequence, 1),
      updated_at = now()
  where a.proposal_item_id = p_proposal_item_id;

  for v_sequence in 1..v_required_count loop
    if exists (
      select 1
      from public.activities a
      where a.proposal_item_id = p_proposal_item_id
        and a.proposal_item_sequence = v_sequence
    ) then
      continue;
    end if;

    v_row_id := 'PAI-' || p_proposal_item_id::text
      || case when v_sequence = 1 then '' else '-' || v_sequence::text end;

    insert into public.activities (
      row_id,
      activity_family,
      authority,
      school,
      class_group,
      activity_type,
      item_type,
      activity_no,
      activity_name,
      program_name,
      name,
      title,
      sessions,
      price,
      funding,
      status,
      gefen_number,
      activity_season,
      authority_id,
      school_id,
      contact_name,
      contact_phone,
      contact_email,
      proposal_agreement_id,
      proposal_item_id,
      proposal_item_sequence,
      is_gefen_funded,
      exists_in_gefen,
      gefen_order_number,
      created_at,
      updated_at
    )
    values (
      v_row_id,
      v_activity_family,
      nullif(trim(coalesce(v_proposal.client_authority, '')), ''),
      nullif(trim(coalesce(v_proposal.school_framework, '')), ''),
      '',
      v_activity_type,
      v_activity_type,
      nullif(trim(coalesce(v_item.activity_no, v_item.gefen_number, '')), ''),
      v_short_name,
      null,
      null,
      null,
      case when v_item.meetings_count is null then null else v_item.meetings_count::text end,
      case
        when v_item.unit_price is not null then round(v_item.unit_price)::bigint
        when v_item.total_price is not null then round(v_item.total_price / v_required_count)::bigint
        else null
      end,
      case when v_is_gefen then 'גפן' else null end,
      'פתוח',
      nullif(trim(coalesce(v_item.gefen_number, '')), ''),
      'school_2027',
      v_proposal.authority_id,
      v_proposal.school_id,
      nullif(trim(coalesce(v_proposal.contact_name, '')), ''),
      coalesce(
        nullif(trim(coalesce(v_proposal.contact_phone, '')), ''),
        nullif(trim(coalesce(v_proposal.phone, '')), '')
      ),
      coalesce(
        nullif(trim(coalesce(v_proposal.contact_email, '')), ''),
        nullif(trim(coalesce(v_proposal.email, '')), '')
      ),
      v_proposal.id,
      v_item.id,
      v_sequence,
      v_is_gefen,
      false,
      null,
      now(),
      now()
    )
    on conflict (proposal_item_id, proposal_item_sequence)
      where proposal_item_id is not null
    do nothing
    returning * into v_activity;

    if found then
      v_created_count := v_created_count + 1;
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.proposal_item_sequence), '[]'::jsonb)
  into v_activities
  from public.activities a
  where a.proposal_item_id = p_proposal_item_id;

  return jsonb_build_object(
    'created', v_created_count > 0,
    'created_count', v_created_count,
    'required_count', v_required_count,
    'activities', v_activities,
    'activity', coalesce(v_activities -> 0, 'null'::jsonb)
  );
end;
$function$;

revoke all on function public.proposal_item_required_activity_count(numeric) from public;
grant execute on function public.proposal_item_required_activity_count(numeric) to authenticated;
grant execute on function public.proposal_item_required_activity_count(numeric) to service_role;

revoke all on function public.create_activity_from_proposal_item(uuid) from public;
revoke all on function public.create_activity_from_proposal_item(uuid) from anon;
grant execute on function public.create_activity_from_proposal_item(uuid) to authenticated;
grant execute on function public.create_activity_from_proposal_item(uuid) to service_role;

comment on column public.activities.proposal_item_sequence is
  'One-based group number created from the quoted proposal item quantity.';

comment on column public.activities.proposal_item_id is
  'Proposal item source. One activity is created for each quoted quantity/group.';

-- Repair rows already created from proposal items and complete missing group rows.
do $repair$
declare
  v_item_id uuid;
begin
  for v_item_id in
    select distinct proposal_item_id
    from public.activities
    where proposal_item_id is not null
      and activity_season = 'school_2027'
  loop
    with source_data as (
      select
        pai.*,
        pa.client_authority,
        pa.school_framework,
        pa.authority_id as proposal_authority_id,
        pa.school_id as proposal_school_id,
        pa.contact_name as proposal_contact_name,
        pa.contact_phone as proposal_contact_phone,
        pa.phone as proposal_phone,
        pa.contact_email as proposal_contact_email,
        pa.email as proposal_email,
        coalesce(
          nullif(trim(coalesce(l.activity_name, l.label_he, l.label, '')), ''),
          nullif(trim(pai.item_name), ''),
          'ללא שם פעילות'
        ) as short_name,
        case
          when lower(trim(coalesce(l.activity_type, l.type, l.parent_value, pai.item_type, ''))) in ('workshop', 'סדנה') then 'workshop'
          when lower(trim(coalesce(l.activity_type, l.type, l.parent_value, pai.item_type, ''))) in ('tour', 'סיור') then 'tour'
          else 'course'
        end as normalized_type,
        public.proposal_item_required_activity_count(pai.quantity) as required_count,
        (
          trim(coalesce(pai.gefen_number, '')) <> ''
          or lower(trim(coalesce(pa.activity_type_group, ''))) = 'gefen'
          or trim(coalesce(pa.activity_type_group, '')) in ('גפן', 'גפ"ן', 'גפ״ן')
        ) as is_gefen
      from public.proposal_agreement_items pai
      join public.proposals_agreements pa on pa.id = pai.proposal_agreement_id
      left join lateral (
        select l.*
        from public.lists l
        where l.category = 'activity_names'
          and coalesce(l.is_active, l.active, true)
          and (
            (pai.list_id is not null and l.list_id = pai.list_id)
            or (trim(coalesce(pai.activity_no, '')) <> '' and trim(coalesce(l.activity_no, '')) = trim(pai.activity_no))
            or (trim(coalesce(pai.gefen_number, '')) <> '' and trim(coalesce(l.gefen_number, '')) = trim(pai.gefen_number))
            or (trim(coalesce(pai.activity_no, '')) <> '' and trim(coalesce(l.value, '')) = trim(pai.activity_no))
          )
        order by
          case when pai.list_id is not null and l.list_id = pai.list_id then 0 else 1 end,
          case when trim(coalesce(l.activity_no, '')) = trim(coalesce(pai.activity_no, '')) then 0 else 1 end,
          l.sort_order nulls last,
          l.list_id
        limit 1
      ) l on true
      where pai.id = v_item_id
    )
    update public.activities a
    set activity_family = case when s.normalized_type = 'course' then 'program' else s.normalized_type end,
        activity_type = s.normalized_type,
        item_type = s.normalized_type,
        activity_name = s.short_name,
        program_name = null,
        name = null,
        title = null,
        class_group = coalesce(a.class_group, ''),
        price = case
          when s.unit_price is not null then round(s.unit_price)::bigint
          when s.total_price is not null then round(s.total_price / s.required_count)::bigint
          else a.price
        end,
        proposal_item_sequence = coalesce(a.proposal_item_sequence, 1),
        updated_at = now()
    from source_data s
    where a.proposal_item_id = s.id;

    with source_data as (
      select
        pai.*,
        pa.client_authority,
        pa.school_framework,
        pa.authority_id as proposal_authority_id,
        pa.school_id as proposal_school_id,
        pa.contact_name as proposal_contact_name,
        pa.contact_phone as proposal_contact_phone,
        pa.phone as proposal_phone,
        pa.contact_email as proposal_contact_email,
        pa.email as proposal_email,
        coalesce(
          nullif(trim(coalesce(l.activity_name, l.label_he, l.label, '')), ''),
          nullif(trim(pai.item_name), ''),
          'ללא שם פעילות'
        ) as short_name,
        case
          when lower(trim(coalesce(l.activity_type, l.type, l.parent_value, pai.item_type, ''))) in ('workshop', 'סדנה') then 'workshop'
          when lower(trim(coalesce(l.activity_type, l.type, l.parent_value, pai.item_type, ''))) in ('tour', 'סיור') then 'tour'
          else 'course'
        end as normalized_type,
        public.proposal_item_required_activity_count(pai.quantity) as required_count,
        (
          trim(coalesce(pai.gefen_number, '')) <> ''
          or lower(trim(coalesce(pa.activity_type_group, ''))) = 'gefen'
          or trim(coalesce(pa.activity_type_group, '')) in ('גפן', 'גפ"ן', 'גפ״ן')
        ) as is_gefen
      from public.proposal_agreement_items pai
      join public.proposals_agreements pa on pa.id = pai.proposal_agreement_id
      left join lateral (
        select l.*
        from public.lists l
        where l.category = 'activity_names'
          and coalesce(l.is_active, l.active, true)
          and (
            (pai.list_id is not null and l.list_id = pai.list_id)
            or (trim(coalesce(pai.activity_no, '')) <> '' and trim(coalesce(l.activity_no, '')) = trim(pai.activity_no))
            or (trim(coalesce(pai.gefen_number, '')) <> '' and trim(coalesce(l.gefen_number, '')) = trim(pai.gefen_number))
            or (trim(coalesce(pai.activity_no, '')) <> '' and trim(coalesce(l.value, '')) = trim(pai.activity_no))
          )
        order by
          case when pai.list_id is not null and l.list_id = pai.list_id then 0 else 1 end,
          case when trim(coalesce(l.activity_no, '')) = trim(coalesce(pai.activity_no, '')) then 0 else 1 end,
          l.sort_order nulls last,
          l.list_id
        limit 1
      ) l on true
      where pai.id = v_item_id
    )
    insert into public.activities (
      row_id,
      activity_family,
      authority,
      school,
      class_group,
      activity_type,
      item_type,
      activity_no,
      activity_name,
      sessions,
      price,
      funding,
      status,
      gefen_number,
      activity_season,
      authority_id,
      school_id,
      contact_name,
      contact_phone,
      contact_email,
      proposal_agreement_id,
      proposal_item_id,
      proposal_item_sequence,
      is_gefen_funded,
      exists_in_gefen,
      gefen_order_number,
      created_at,
      updated_at
    )
    select
      'PAI-' || s.id::text || '-' || seq.sequence_no::text,
      case when s.normalized_type = 'course' then 'program' else s.normalized_type end,
      nullif(trim(coalesce(s.client_authority, '')), ''),
      nullif(trim(coalesce(s.school_framework, '')), ''),
      '',
      s.normalized_type,
      s.normalized_type,
      nullif(trim(coalesce(s.activity_no, s.gefen_number, '')), ''),
      s.short_name,
      case when s.meetings_count is null then null else s.meetings_count::text end,
      case
        when s.unit_price is not null then round(s.unit_price)::bigint
        when s.total_price is not null then round(s.total_price / s.required_count)::bigint
        else null
      end,
      case when s.is_gefen then 'גפן' else null end,
      'פתוח',
      nullif(trim(coalesce(s.gefen_number, '')), ''),
      'school_2027',
      s.proposal_authority_id,
      s.proposal_school_id,
      nullif(trim(coalesce(s.proposal_contact_name, '')), ''),
      coalesce(
        nullif(trim(coalesce(s.proposal_contact_phone, '')), ''),
        nullif(trim(coalesce(s.proposal_phone, '')), '')
      ),
      coalesce(
        nullif(trim(coalesce(s.proposal_contact_email, '')), ''),
        nullif(trim(coalesce(s.proposal_email, '')), '')
      ),
      s.proposal_agreement_id,
      s.id,
      seq.sequence_no,
      s.is_gefen,
      false,
      null,
      now(),
      now()
    from source_data s
    cross join lateral generate_series(2, s.required_count) as seq(sequence_no)
    where not exists (
      select 1
      from public.activities existing
      where existing.proposal_item_id = s.id
        and existing.proposal_item_sequence = seq.sequence_no
    )
    on conflict (proposal_item_id, proposal_item_sequence)
      where proposal_item_id is not null
    do nothing;
  end loop;
end
$repair$;

-- Create one 2027 activity row directly from one proposal item.
-- No link table is used: the source proposal and source item are stored on activities.

alter table public.activities
  add column if not exists proposal_agreement_id uuid,
  add column if not exists proposal_item_id uuid,
  add column if not exists is_gefen_funded boolean not null default false,
  add column if not exists exists_in_gefen boolean not null default false,
  add column if not exists gefen_order_number text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'activities_proposal_agreement_id_fkey'
      and conrelid = 'public.activities'::regclass
  ) then
    alter table public.activities
      add constraint activities_proposal_agreement_id_fkey
      foreign key (proposal_agreement_id)
      references public.proposals_agreements(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'activities_proposal_item_id_fkey'
      and conrelid = 'public.activities'::regclass
  ) then
    alter table public.activities
      add constraint activities_proposal_item_id_fkey
      foreign key (proposal_item_id)
      references public.proposal_agreement_items(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'activities_gefen_exists_requires_funding'
      and conrelid = 'public.activities'::regclass
  ) then
    alter table public.activities
      add constraint activities_gefen_exists_requires_funding
      check (not exists_in_gefen or is_gefen_funded);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'activities_proposal_item_school_2027_only'
      and conrelid = 'public.activities'::regclass
  ) then
    alter table public.activities
      add constraint activities_proposal_item_school_2027_only
      check (proposal_item_id is null or activity_season = 'school_2027');
  end if;
end
$$;

create index if not exists activities_proposal_agreement_id_idx
  on public.activities (proposal_agreement_id)
  where proposal_agreement_id is not null;

create unique index if not exists activities_proposal_item_id_uidx
  on public.activities (proposal_item_id)
  where proposal_item_id is not null;

drop policy if exists activities_insert_from_proposal_manager on public.activities;
create policy activities_insert_from_proposal_manager
on public.activities
for insert
to authenticated
with check (
  public.app_can_manage_proposals_agreements()
  and activity_season = 'school_2027'
  and proposal_agreement_id is not null
  and proposal_item_id is not null
  and exists (
    select 1
    from public.proposal_agreement_items pai
    join public.proposals_agreements pa
      on pa.id = pai.proposal_agreement_id
    where pai.id = activities.proposal_item_id
      and pa.id = activities.proposal_agreement_id
      and pa.archived_at is null
      and lower(trim(pa.status)) in ('approved', 'sent', 'מאושר', 'מאושר וחתום', 'נשלח')
      and (
        lower(trim(pa.activity_type_group)) in ('next_year', 'gefen', 'combined')
        or trim(pa.activity_type_group) in (
          'תשפ"ז', 'תשפ״ז', 'גפן', 'גפ"ן', 'גפ״ן',
          'שנת הלימודים תשפ"ז', 'שנת הלימודים תשפ״ז',
          'תוכניות תשפ"ז', 'תוכניות תשפ״ז'
        )
      )
  )
);

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
  v_existing public.activities%rowtype;
  v_activity public.activities%rowtype;
  v_proposal_group text;
  v_item_group text;
  v_status text;
  v_is_gefen boolean;
  v_row_id text;
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
  into v_existing
  from public.activities
  where proposal_item_id = p_proposal_item_id
  limit 1;

  if found then
    return jsonb_build_object(
      'created', false,
      'activity', to_jsonb(v_existing)
    );
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

  v_is_gefen :=
    trim(coalesce(v_item.gefen_number, '')) <> ''
    or v_proposal_group = 'gefen'
    or trim(coalesce(v_proposal.activity_type_group, '')) in ('גפן', 'גפ"ן', 'גפ״ן');

  v_row_id := 'PAI-' || p_proposal_item_id::text;

  insert into public.activities (
    row_id,
    activity_family,
    authority,
    school,
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
    is_gefen_funded,
    exists_in_gefen,
    gefen_order_number,
    created_at,
    updated_at
  )
  values (
    v_row_id,
    nullif(trim(coalesce(v_item.item_type, '')), ''),
    nullif(trim(coalesce(v_proposal.client_authority, '')), ''),
    nullif(trim(coalesce(v_proposal.school_framework, '')), ''),
    nullif(trim(coalesce(v_item.item_type, '')), ''),
    nullif(trim(coalesce(v_item.item_type, '')), ''),
    nullif(trim(coalesce(v_item.activity_no, '')), ''),
    trim(v_item.item_name),
    trim(v_item.item_name),
    trim(v_item.item_name),
    trim(v_item.item_name),
    case when v_item.meetings_count is null then null else v_item.meetings_count::text end,
    case
      when v_item.total_price is not null then round(v_item.total_price)::bigint
      when v_item.unit_price is not null then round(v_item.unit_price)::bigint
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
    v_is_gefen,
    false,
    null,
    now(),
    now()
  )
  on conflict (proposal_item_id) where proposal_item_id is not null
  do nothing
  returning * into v_activity;

  if not found then
    select *
    into v_activity
    from public.activities
    where proposal_item_id = p_proposal_item_id
    limit 1;

    return jsonb_build_object(
      'created', false,
      'activity', to_jsonb(v_activity)
    );
  end if;

  return jsonb_build_object(
    'created', true,
    'activity', to_jsonb(v_activity)
  );
end;
$function$;

revoke all on function public.create_activity_from_proposal_item(uuid) from public;
revoke all on function public.create_activity_from_proposal_item(uuid) from anon;
grant execute on function public.create_activity_from_proposal_item(uuid) to authenticated;
grant execute on function public.create_activity_from_proposal_item(uuid) to service_role;

comment on column public.activities.proposal_agreement_id is
  'Proposal from which the 2027 activity was created.';

comment on column public.activities.proposal_item_id is
  'Exact proposal item from which the activity was created; one item can create only one activity.';

comment on column public.activities.exists_in_gefen is
  'Manual confirmation that the activity/order exists in the external Gefen system; unrelated to generated approval PDF status.';

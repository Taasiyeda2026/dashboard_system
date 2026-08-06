-- Route proposal-domain E records to Israa's compact 2027 tracking table.
-- Proposal-domain Y continues to create rows in public.activities exactly as before.

alter table public.israa_program_tracking
  add column if not exists proposal_agreement_id uuid,
  add column if not exists quote_number text,
  add column if not exists semel_mosad text,
  add column if not exists school_id bigint,
  add column if not exists authority_id bigint,
  add column if not exists gefen_numbers text,
  add column if not exists proposal_nature text not null default 'ממוקדת',
  add column if not exists probability smallint not null default 30,
  add column if not exists total_amount numeric(14,2),
  add column if not exists proposal_date date,
  add column if not exists follow_up_date date,
  add column if not exists next_action text,
  add column if not exists proposal_items jsonb not null default '[]'::jsonb,
  add column if not exists updated_from_proposal_at timestamptz;

alter table public.israa_program_tracking
  drop constraint if exists israa_program_tracking_proposal_nature_check;
alter table public.israa_program_tracking
  add constraint israa_program_tracking_proposal_nature_check
  check (proposal_nature in ('ממוקדת', 'לבחירה', 'משולבת'));

alter table public.israa_program_tracking
  drop constraint if exists israa_program_tracking_probability_check;
alter table public.israa_program_tracking
  add constraint israa_program_tracking_probability_check
  check (probability in (30, 50, 100));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'israa_program_tracking_proposal_agreement_id_fkey'
      and conrelid = 'public.israa_program_tracking'::regclass
  ) then
    alter table public.israa_program_tracking
      add constraint israa_program_tracking_proposal_agreement_id_fkey
      foreign key (proposal_agreement_id)
      references public.proposals_agreements(id)
      on delete set null;
  end if;
end
$$;

create unique index if not exists israa_program_tracking_proposal_uidx
  on public.israa_program_tracking (proposal_agreement_id)
  where proposal_agreement_id is not null;

create index if not exists israa_program_tracking_follow_up_idx
  on public.israa_program_tracking (follow_up_date, status);

update public.israa_program_tracking
set total_amount = case
  when regexp_replace(coalesce(total_cost, ''), '[^0-9.\-]', '', 'g') ~ '^-?[0-9]+(\.[0-9]+)?$'
    then regexp_replace(coalesce(total_cost, ''), '[^0-9.\-]', '', 'g')::numeric
  else null
end
where total_amount is null;

update public.israa_program_tracking
set proposal_date = activity_date
where proposal_date is null
  and activity_date is not null;

alter table public.israa_program_tracking
  drop column if exists realistic_value;
alter table public.israa_program_tracking
  add column realistic_value numeric(14,2)
  generated always as (
    round(coalesce(total_amount, 0) * coalesce(probability, 0)::numeric / 100, 2)
  ) stored;

comment on column public.israa_program_tracking.proposal_agreement_id is
  'Source proposal. One proposal can have at most one Israa tracking row.';
comment on column public.israa_program_tracking.semel_mosad is
  'School institution code, stored as text so leading zeroes are preserved.';
comment on column public.israa_program_tracking.realistic_value is
  'Automatically calculated pipeline value: total_amount multiplied by probability.';

create or replace function public.create_israa_tracking_from_proposal(
  p_proposal_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_proposal public.proposals_agreements%rowtype;
  v_existing_id uuid;
  v_row public.israa_program_tracking%rowtype;
  v_semel text;
  v_program_names text;
  v_gefen_numbers text;
  v_groups integer;
  v_items_total numeric(14,2);
  v_item_count integer;
  v_items_json jsonb;
  v_nature text;
  v_probability smallint;
  v_tracking_status text;
  v_total numeric(14,2);
  v_can_manage boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.is_active = true
      and (
        coalesce(u.manage_proposals_agreements, false)
        or u.user_id = '3030'
        or u.role in ('admin', 'operation_manager', 'domain_manager')
      )
  ) into v_can_manage;

  if not coalesce(v_can_manage, false) then
    raise exception 'create_israa_tracking_forbidden' using errcode = '42501';
  end if;

  select *
  into v_proposal
  from public.proposals_agreements
  where id = p_proposal_id
    and archived_at is null;

  if not found then
    raise exception 'proposal_not_found_or_archived';
  end if;

  if upper(btrim(coalesce(v_proposal.proposal_domain, ''))) <> 'E' then
    raise exception 'proposal_domain_is_not_e';
  end if;

  if lower(btrim(coalesce(v_proposal.status, ''))) not in (
    'approved', 'sent', 'מאושר', 'מאושר וחתום', 'נשלח'
  ) then
    raise exception 'proposal_must_be_approved_or_sent';
  end if;

  select nullif(btrim(d.semel_mosad::text), '')
  into v_semel
  from public.proposals_agreements_directory_view d
  where d.id = v_proposal.id
  limit 1;

  with eligible_items as (
    select
      pai.id,
      pai.sort_order,
      coalesce(nullif(btrim(pgc.short_name), ''), nullif(btrim(pai.item_name), ''), 'תוכנית') as short_name,
      nullif(btrim(coalesce(pai.gefen_number, pai.activity_no, '')), '') as gefen_number,
      greatest(1, floor(coalesce(pai.quantity, 1)))::integer as quantity,
      coalesce(
        pai.total_price,
        pai.unit_price * greatest(1, coalesce(pai.quantity, 1)),
        0
      )::numeric(14,2) as total_price,
      pai.item_name,
      pai.item_type,
      pai.meetings_count,
      pai.hours_count
    from public.proposal_agreement_items pai
    left join public.proposal_gefen_courses pgc
      on btrim(coalesce(pgc.gefen_number, '')) = btrim(coalesce(pai.gefen_number, ''))
     and pgc.is_active = true
    where pai.proposal_agreement_id = v_proposal.id
      and lower(btrim(coalesce(pai.proposal_group, ''))) not in ('summer', 'קיץ', 'קיץ תשפ"ו', 'קיץ תשפ״ו')
      and coalesce(pai.item_name, '') !~* '(שעות[[:space:]]*)?בדיק(ה|ות)?'
  )
  select
    string_agg(short_name, ' • ' order by sort_order, id),
    string_agg(gefen_number, ', ' order by sort_order, id) filter (where gefen_number is not null),
    coalesce(sum(quantity), 0)::integer,
    coalesce(sum(total_price), 0)::numeric(14,2),
    count(*)::integer,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'proposal_item_id', id,
          'program_name', short_name,
          'gefen_number', gefen_number,
          'quantity', quantity,
          'total_price', total_price,
          'item_name', item_name,
          'item_type', item_type,
          'meetings_count', meetings_count,
          'hours_count', hours_count
        ) order by sort_order, id
      ),
      '[]'::jsonb
    )
  into
    v_program_names,
    v_gefen_numbers,
    v_groups,
    v_items_total,
    v_item_count,
    v_items_json
  from eligible_items;

  if coalesce(v_item_count, 0) = 0 then
    raise exception 'proposal_has_no_eligible_2027_items';
  end if;

  v_nature := case when v_item_count = 1 then 'ממוקדת' else 'לבחירה' end;
  v_probability := case when v_item_count = 1 then 50 else 30 end;
  v_tracking_status := case
    when lower(btrim(coalesce(v_proposal.status, ''))) in ('approved', 'מאושר', 'מאושר וחתום') then 'אושרה'
    else 'נשלחה'
  end;
  v_total := coalesce(nullif(v_proposal.total_amount, 0), v_items_total, 0)::numeric(14,2);

  select id
  into v_existing_id
  from public.israa_program_tracking
  where proposal_agreement_id = v_proposal.id
  limit 1;

  insert into public.israa_program_tracking as current_row (
    owner_user_id,
    proposal_agreement_id,
    quote_number,
    school_id,
    authority_id,
    semel_mosad,
    authority,
    school_name,
    contact_person,
    phone,
    email,
    program_name,
    gefen_numbers,
    quantity,
    total_amount,
    total_cost,
    proposal_date,
    activity_date,
    proposal_nature,
    probability,
    status,
    proposal_items,
    updated_from_proposal_at,
    created_at,
    updated_at
  )
  values (
    '92bfb9d9-1b17-4022-901a-5f7cf17a263a'::uuid,
    v_proposal.id,
    nullif(btrim(coalesce(v_proposal.quote_number, '')), ''),
    v_proposal.school_id,
    v_proposal.authority_id,
    v_semel,
    nullif(btrim(coalesce(v_proposal.client_authority, '')), ''),
    nullif(btrim(coalesce(v_proposal.school_framework, '')), ''),
    nullif(btrim(coalesce(v_proposal.contact_name, '')), ''),
    coalesce(
      nullif(btrim(coalesce(v_proposal.contact_phone, '')), ''),
      nullif(btrim(coalesce(v_proposal.phone, '')), '')
    ),
    coalesce(
      nullif(btrim(coalesce(v_proposal.contact_email, '')), ''),
      nullif(btrim(coalesce(v_proposal.email, '')), '')
    ),
    v_program_names,
    v_gefen_numbers,
    v_groups,
    v_total,
    trim(to_char(v_total, 'FM999999999999990.00')),
    v_proposal.proposal_date,
    v_proposal.proposal_date,
    v_nature,
    v_probability,
    v_tracking_status,
    v_items_json,
    now(),
    now(),
    now()
  )
  on conflict (proposal_agreement_id) where proposal_agreement_id is not null
  do update set
    quote_number = excluded.quote_number,
    school_id = excluded.school_id,
    authority_id = excluded.authority_id,
    semel_mosad = excluded.semel_mosad,
    authority = excluded.authority,
    school_name = excluded.school_name,
    contact_person = excluded.contact_person,
    phone = excluded.phone,
    email = excluded.email,
    program_name = excluded.program_name,
    gefen_numbers = excluded.gefen_numbers,
    quantity = excluded.quantity,
    total_amount = excluded.total_amount,
    total_cost = excluded.total_cost,
    proposal_date = excluded.proposal_date,
    activity_date = excluded.activity_date,
    proposal_nature = coalesce(nullif(btrim(current_row.proposal_nature), ''), excluded.proposal_nature),
    probability = coalesce(current_row.probability, excluded.probability),
    status = case
      when nullif(btrim(coalesce(current_row.status, '')), '') is null then excluded.status
      when current_row.status = 'נשלחה' and excluded.status = 'אושרה' then 'אושרה'
      else current_row.status
    end,
    proposal_items = excluded.proposal_items,
    updated_from_proposal_at = now(),
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'created', v_existing_id is null,
    'row', to_jsonb(v_row)
  );
end;
$function$;

revoke all on function public.create_israa_tracking_from_proposal(uuid) from public, anon;
grant execute on function public.create_israa_tracking_from_proposal(uuid) to authenticated, service_role;

comment on function public.create_israa_tracking_from_proposal(uuid) is
  'Creates or refreshes one Israa tracking row for an approved/sent domain E proposal. Manual tracking fields are preserved.';

create or replace function public.guard_proposal_linked_activity_domain_y()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_proposal_id uuid;
  v_domain text;
begin
  v_proposal_id := new.proposal_agreement_id;

  if v_proposal_id is null and new.proposal_item_id is not null then
    select pai.proposal_agreement_id
    into v_proposal_id
    from public.proposal_agreement_items pai
    where pai.id = new.proposal_item_id;
  end if;

  if v_proposal_id is null then
    return new;
  end if;

  select upper(btrim(coalesce(pa.proposal_domain, '')))
  into v_domain
  from public.proposals_agreements pa
  where pa.id = v_proposal_id;

  if coalesce(v_domain, '') <> 'Y' then
    raise exception 'proposal_domain_not_routed_to_activities'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_guard_proposal_linked_activity_domain_y on public.activities;
create trigger trg_guard_proposal_linked_activity_domain_y
before insert or update of proposal_agreement_id, proposal_item_id
on public.activities
for each row
execute function public.guard_proposal_linked_activity_domain_y();

comment on function public.guard_proposal_linked_activity_domain_y() is
  'Ensures only proposal-domain Y may create or relink rows in public.activities. Domain E is routed to Israa tracking.';

-- Idempotently refresh only proposal/client source data for linked Israa rows.
-- Manual tracking decisions are deliberately not part of this update.
create temporary table israa_source_audit on commit drop as
with item_source as (
  select
    pai.proposal_agreement_id,
    string_agg(coalesce(nullif(btrim(pgc.short_name), ''), nullif(btrim(pai.item_name), ''), 'תוכנית'), ' • ' order by pai.sort_order, pai.id) as program_name,
    string_agg(nullif(btrim(coalesce(pai.gefen_number, pai.activity_no, '')), ''), ', ' order by pai.sort_order, pai.id)
      filter (where nullif(btrim(coalesce(pai.gefen_number, pai.activity_no, '')), '') is not null) as gefen_numbers,
    coalesce(sum(greatest(1, floor(coalesce(pai.quantity, 1)))::integer), 0)::integer as quantity,
    coalesce(sum(coalesce(pai.total_price, pai.unit_price * greatest(1, coalesce(pai.quantity, 1)), 0)), 0)::numeric(14,2) as items_total,
    coalesce(jsonb_agg(jsonb_build_object(
      'proposal_item_id', pai.id,
      'program_name', coalesce(nullif(btrim(pgc.short_name), ''), nullif(btrim(pai.item_name), ''), 'תוכנית'),
      'gefen_number', nullif(btrim(coalesce(pai.gefen_number, pai.activity_no, '')), ''),
      'quantity', greatest(1, floor(coalesce(pai.quantity, 1)))::integer
    ) order by pai.sort_order, pai.id), '[]'::jsonb) as proposal_items
  from public.proposal_agreement_items pai
  left join public.proposal_gefen_courses pgc
    on btrim(coalesce(pgc.gefen_number, '')) = btrim(coalesce(pai.gefen_number, ''))
   and pgc.is_active = true
  where lower(btrim(coalesce(pai.proposal_group, ''))) not in ('summer', 'קיץ', 'קיץ תשפ"ו', 'קיץ תשפ״ו')
    and coalesce(pai.item_name, '') !~* '(שעות[[:space:]]*)?בדיק(ה|ות)?'
  group by pai.proposal_agreement_id
), source_rows as (
  select
    t.id as tracking_id,
    t.proposal_agreement_id,
    nullif(btrim(coalesce(p.quote_number, '')), '') as quote_number,
    p.proposal_date,
    nullif(btrim(coalesce(d.authority_name, p.client_authority, '')), '') as authority,
    nullif(btrim(coalesce(d.contact_client_type, '')), '') as ownership,
    nullif(btrim(coalesce(d.school_name, p.school_framework, '')), '') as school_name,
    nullif(btrim(d.semel_mosad::text), '') as semel_mosad,
    nullif(btrim(coalesce(p.contact_name, '')), '') as contact_person,
    nullif(btrim(coalesce(p.contact_role, '')), '') as contact_role,
    nullif(btrim(coalesce(p.contact_phone, p.phone, '')), '') as phone,
    nullif(btrim(coalesce(p.contact_email, p.email, '')), '') as email,
    coalesce(nullif(p.total_amount, 0), i.items_total, 0)::numeric(14,2) as total_amount,
    coalesce(i.program_name, '') as program_name,
    i.gefen_numbers,
    coalesce(i.quantity, 0) as quantity,
    coalesce(i.proposal_items, '[]'::jsonb) as proposal_items,
    (t.quote_number, t.proposal_date, t.authority, t.ownership, t.school_name, t.semel_mosad,
     t.contact_person, t.additional_contact, t.phone, t.email, t.total_amount, t.program_name,
     t.gefen_numbers, t.quantity, t.proposal_items)
      is distinct from
    (nullif(btrim(coalesce(p.quote_number, '')), ''), p.proposal_date,
     nullif(btrim(coalesce(d.authority_name, p.client_authority, '')), ''),
     nullif(btrim(coalesce(d.contact_client_type, '')), ''),
     nullif(btrim(coalesce(d.school_name, p.school_framework, '')), ''), nullif(btrim(d.semel_mosad::text), ''),
     nullif(btrim(coalesce(p.contact_name, '')), ''), nullif(btrim(coalesce(p.contact_role, '')), ''),
     nullif(btrim(coalesce(p.contact_phone, p.phone, '')), ''), nullif(btrim(coalesce(p.contact_email, p.email, '')), ''),
     coalesce(nullif(p.total_amount, 0), i.items_total, 0)::numeric(14,2), coalesce(i.program_name, ''),
     i.gefen_numbers, coalesce(i.quantity, 0), coalesce(i.proposal_items, '[]'::jsonb)) as changed,
    num_nonnull(
      nullif(t.quote_number is distinct from nullif(btrim(coalesce(p.quote_number, '')), ''), false),
      nullif(t.proposal_date is distinct from p.proposal_date, false),
      nullif(t.authority is distinct from nullif(btrim(coalesce(d.authority_name, p.client_authority, '')), ''), false),
      nullif(t.ownership is distinct from nullif(btrim(coalesce(d.contact_client_type, '')), ''), false),
      nullif(t.school_name is distinct from nullif(btrim(coalesce(d.school_name, p.school_framework, '')), ''), false),
      nullif(t.semel_mosad is distinct from nullif(btrim(d.semel_mosad::text), ''), false),
      nullif(t.contact_person is distinct from nullif(btrim(coalesce(p.contact_name, '')), ''), false),
      nullif(t.additional_contact is distinct from nullif(btrim(coalesce(p.contact_role, '')), ''), false),
      nullif(t.phone is distinct from nullif(btrim(coalesce(p.contact_phone, p.phone, '')), ''), false),
      nullif(t.email is distinct from nullif(btrim(coalesce(p.contact_email, p.email, '')), ''), false),
      nullif(t.total_amount is distinct from coalesce(nullif(p.total_amount, 0), i.items_total, 0)::numeric(14,2), false),
      nullif(t.program_name is distinct from coalesce(i.program_name, ''), false),
      nullif(t.gefen_numbers is distinct from i.gefen_numbers, false),
      nullif(t.quantity is distinct from coalesce(i.quantity, 0), false),
      nullif(t.proposal_items is distinct from coalesce(i.proposal_items, '[]'::jsonb), false)
    ) as changed_values
  from public.israa_program_tracking t
  join public.proposals_agreements p on p.id = t.proposal_agreement_id
  left join public.proposals_agreements_directory_view d on d.id = p.id
  left join item_source i on i.proposal_agreement_id = p.id
)
select * from source_rows;

update public.israa_program_tracking t
set
  quote_number = s.quote_number,
  proposal_date = s.proposal_date,
  activity_date = s.proposal_date,
  authority = s.authority,
  ownership = s.ownership,
  school_name = s.school_name,
  semel_mosad = s.semel_mosad,
  contact_person = s.contact_person,
  manager_name = s.contact_person,
  additional_contact = s.contact_role,
  phone = s.phone,
  manager_phone = s.phone,
  email = s.email,
  manager_email = s.email,
  total_amount = s.total_amount,
  total_cost = trim(to_char(s.total_amount, 'FM999999999999990.00')),
  program_name = s.program_name,
  gefen_numbers = s.gefen_numbers,
  quantity = s.quantity,
  proposal_items = s.proposal_items,
  updated_from_proposal_at = now(),
  updated_at = now()
from israa_source_audit s
where t.id = s.tracking_id
  and s.changed;

do $audit$
declare
  v_total integer;
  v_linked integer;
  v_unlinked integer;
  v_refreshed integer;
  v_completed_values integer;
  v_unlinked_rows text;
  v_missing text;
begin
  select count(*), count(*) filter (where proposal_agreement_id is not null), count(*) filter (where proposal_agreement_id is null)
  into v_total, v_linked, v_unlinked
  from public.israa_program_tracking;
  select count(*) filter (where changed), coalesce(sum(changed_values), 0) into v_refreshed, v_completed_values from israa_source_audit;
  select string_agg(format('%s (%s)', coalesce(quote_number, 'ללא מספר'), id), ', ' order by created_at)
  into v_unlinked_rows from public.israa_program_tracking where proposal_agreement_id is null;
  select string_agg(format('%s: %s', coalesce(quote_number, proposal_agreement_id::text), missing), '; ')
  into v_missing
  from (
    select quote_number, proposal_agreement_id,
      concat_ws(', ',
        case when proposal_date is null then 'תאריך הצעה' end,
        case when authority is null then 'רשות' end,
        case when ownership is null then 'בעלות' end,
        case when school_name is null then 'בית ספר' end,
        case when semel_mosad is null then 'סמל מוסד' end,
        case when contact_person is null then 'איש קשר' end,
        case when contact_role is null then 'תפקיד' end,
        case when phone is null then 'טלפון' end,
        case when email is null then 'דוא״ל' end,
        case when proposal_items = '[]'::jsonb then 'פעילויות' end
      ) as missing
    from israa_source_audit
  ) q where missing <> '';
  raise notice 'Israa audit: total=%, linked=%, unlinked=%, refreshed_source_rows=%, completed_source_values=%', v_total, v_linked, v_unlinked, v_refreshed, v_completed_values;
  raise notice 'Unlinked rows (left unchanged): %', coalesce(v_unlinked_rows, 'none');
  raise notice 'Source data still absent: %', coalesce(v_missing, 'none');
end
$audit$;

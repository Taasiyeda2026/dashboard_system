-- Return only the active application profile linked to the authenticated caller.
create or replace function public.get_current_app_user()
returns setof public.current_app_user
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select v.*
  from public.current_app_user as v
  limit 1
$$;

revoke all on function public.get_current_app_user() from public, anon;
grant execute on function public.get_current_app_user() to authenticated;

-- Reinstall the atomic item writer with an explicit pre-delete name guard.
create or replace function public.save_proposal_agreement_items_atomic(
  p_proposal_id uuid,
  p_items jsonb default '[]'::jsonb
)
returns table(id uuid, item_name text, sort_order integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.proposals_agreements
  where proposals_agreements.id = p_proposal_id
  for update;

  if not found then
    raise exception 'proposal_agreement_not_found';
  end if;

  if v_status = 'sent' then
    raise exception 'proposal_agreement_sent_locked';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as input(item)
    where nullif(btrim(item->>'item_name'), '') is null
  ) then
    raise exception 'proposal_item_name_required';
  end if;

  delete from public.proposal_agreement_items
  where proposal_agreement_id = p_proposal_id;

  return query
  insert into public.proposal_agreement_items (
    proposal_agreement_id, activity_no, item_name, item_type, gefen_number,
    meetings_count, hours_count, quantity, unit_price, hourly_price, total_price,
    description, course_note, unit_duration, proposal_group, sort_order,
    proposal_display_mode, source_pricing_key, selected_bundle_items, list_id
  )
  select
    p_proposal_id,
    nullif(item->>'activity_no', ''),
    nullif(item->>'item_name', ''),
    coalesce(nullif(item->>'item_type', ''), 'פעילות'),
    nullif(item->>'gefen_number', ''),
    nullif(item->>'meetings_count', '')::numeric,
    nullif(item->>'hours_count', '')::numeric,
    coalesce(nullif(item->>'quantity', '')::numeric, 1),
    nullif(item->>'unit_price', '')::numeric,
    nullif(item->>'hourly_price', '')::numeric,
    nullif(item->>'total_price', '')::numeric,
    nullif(item->>'description', ''),
    nullif(item->>'course_note', ''),
    nullif(item->>'unit_duration', ''),
    nullif(item->>'proposal_group', ''),
    coalesce(nullif(item->>'sort_order', '')::integer, ordinality::integer - 1),
    coalesce(nullif(item->>'proposal_display_mode', ''), 'single'),
    nullif(item->>'source_pricing_key', ''),
    coalesce(item->'selected_bundle_items', '[]'::jsonb),
    nullif(item->>'list_id', '')::bigint
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as input(item, ordinality)
  returning proposal_agreement_items.id, proposal_agreement_items.item_name, proposal_agreement_items.sort_order;
end;
$$;

revoke all on function public.save_proposal_agreement_items_atomic(uuid, jsonb) from public;
revoke all on function public.save_proposal_agreement_items_atomic(uuid, jsonb) from anon;
grant execute on function public.save_proposal_agreement_items_atomic(uuid, jsonb) to authenticated;

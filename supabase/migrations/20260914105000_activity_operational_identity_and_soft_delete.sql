-- Keep proposal linkage as provenance after an operational activity is created,
-- and make the existing "delete activity" action a true soft delete.
--
-- 1. Proposal-linked activities are canonicalized when they are first created or
--    when they are explicitly re-linked to another proposal item. Later edits to
--    the operational activity may change its catalog/type/name without the
--    proposal snapshot forcing the original catalog identity back onto the row.
-- 2. status = 'נמחק' remains the deletion signal. The row stays in activities so
--    attendance/coordination/finance foreign keys cannot turn a user delete into
--    an FK failure. The existing screens already exclude deleted rows.

create or replace function public.enforce_proposal_activity_catalog_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_item public.proposal_agreement_items%rowtype;
  v_catalog record;
  v_canonical_no text;
  v_catalog_type text;
  v_operational_name text;
  v_course_short_name text;
begin
  if new.proposal_item_id is null
    or trim(coalesce(new.activity_season, '')) <> 'school_2027'
  then
    return new;
  end if;

  -- Once an activity exists, proposal_item_id is provenance rather than a live
  -- lock on the operational catalog identity. Only an explicit re-link to a
  -- different proposal item should re-canonicalize the row from the proposal.
  if tg_op = 'UPDATE'
    and new.proposal_item_id is not distinct from old.proposal_item_id
  then
    return new;
  end if;

  select *
  into v_item
  from public.proposal_agreement_items
  where id = new.proposal_item_id;

  if not found then
    if tg_op = 'INSERT' then
      raise exception 'proposal_item_not_found';
    end if;
    return new;
  end if;

  select l.*
  into v_catalog
  from public.lists l
  where l.category = 'activity_names'
    and coalesce(l.is_active, l.active, true)
    and (
      (v_item.list_id is not null and l.list_id = v_item.list_id)
      or (
        nullif(trim(coalesce(v_item.activity_no, '')), '') is not null
        and trim(coalesce(l.activity_no, '')) = trim(v_item.activity_no)
      )
      or (
        nullif(trim(coalesce(v_item.gefen_number, '')), '') is not null
        and trim(coalesce(l.gefen_number, '')) = trim(v_item.gefen_number)
      )
      or (
        nullif(trim(coalesce(v_item.activity_no, '')), '') is not null
        and trim(coalesce(l.value, '')) = trim(v_item.activity_no)
      )
    )
  order by
    case when v_item.list_id is not null and l.list_id = v_item.list_id then 0 else 1 end,
    case when trim(coalesce(l.activity_no, '')) = trim(coalesce(v_item.activity_no, '')) then 0 else 1 end,
    l.sort_order nulls last,
    l.list_id
  limit 1;

  if not found then
    if tg_op = 'INSERT' then
      raise exception 'proposal_item_catalog_link_required';
    end if;
    return new;
  end if;

  v_canonical_no := coalesce(
    nullif(trim(coalesce(v_catalog.activity_no, '')), ''),
    nullif(trim(coalesce(v_catalog.value, '')), ''),
    nullif(trim(coalesce(v_catalog.gefen_number, '')), '')
  );

  if v_canonical_no is null then
    if tg_op = 'INSERT' then
      raise exception 'proposal_item_activity_number_required';
    end if;
    return new;
  end if;

  v_catalog_type := lower(trim(coalesce(
    nullif(trim(coalesce(v_catalog.activity_type, '')), ''),
    nullif(trim(coalesce(v_catalog.type, '')), ''),
    nullif(trim(coalesce(v_catalog.parent_value, '')), ''),
    ''
  )));

  v_operational_name := coalesce(
    nullif(trim(coalesce(v_catalog.activity_name, '')), ''),
    nullif(trim(coalesce(v_catalog.label_he, '')), ''),
    nullif(trim(coalesce(v_catalog.label, '')), '')
  );

  if v_catalog_type in ('course', 'program', 'תוכנית', 'תכנית', 'קורס') then
    select nullif(trim(c.short_name), '')
    into v_course_short_name
    from public.proposal_gefen_courses c
    where c.is_active
      and (
        trim(c.gefen_number) = v_canonical_no
        or (
          nullif(trim(coalesce(v_catalog.gefen_number, '')), '') is not null
          and trim(c.gefen_number) = trim(v_catalog.gefen_number)
        )
        or (
          nullif(trim(coalesce(v_item.gefen_number, '')), '') is not null
          and trim(c.gefen_number) = trim(v_item.gefen_number)
        )
      )
    order by
      case when trim(c.gefen_number) = v_canonical_no then 0 else 1 end,
      c.sort_order nulls last,
      c.gefen_number
    limit 1;

    v_operational_name := coalesce(v_course_short_name, v_operational_name);
  end if;

  new.activity_no := v_canonical_no;
  if v_operational_name is not null then
    new.activity_name := v_operational_name;
  end if;

  if nullif(trim(coalesce(v_catalog.gefen_number, '')), '') is not null then
    new.gefen_number := trim(v_catalog.gefen_number);
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_proposal_activity_catalog_identity() from public;
grant execute on function public.enforce_proposal_activity_catalog_identity() to authenticated;
grant execute on function public.enforce_proposal_activity_catalog_identity() to service_role;

comment on function public.enforce_proposal_activity_catalog_identity() is
  'Canonicalizes proposal-linked activities on creation or explicit proposal-item relink; later operational catalog edits remain independent of the proposal snapshot.';

-- Deletion from the application is intentionally a soft delete. The client
-- already performs UPDATE status = 'נמחק'; remove the legacy trigger that turned
-- that update into a physical DELETE and remove direct authenticated DELETE.
drop trigger if exists trg_hard_delete_activity_after_deleted_status on public.activities;
drop function if exists public.hard_delete_activity_after_deleted_status();

drop policy if exists activities_delete_admin_operation_only on public.activities;
revoke delete on table public.activities from authenticated;
revoke delete on table public.activities from anon;

comment on table public.activities is
  'Operational activities. Application deletion is soft-delete via status = ''נמחק''; proposal links are provenance and do not lock later operational catalog edits.';

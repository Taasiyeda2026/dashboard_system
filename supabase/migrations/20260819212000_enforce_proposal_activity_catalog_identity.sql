-- Proposal -> activity identity contract.
--
-- The proposal row may keep its own commercial snapshot text, but every
-- operational activity created from it must carry the canonical activity_no.
-- The operational display name is the catalog short name when one exists.
--
-- This migration does not rewrite existing data in bulk. Existing linked rows
-- are normalized only when they are updated through the normal workflow.

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
    -- Historical proposal-linked activities are allowed to remain editable.
    -- New operational activities, however, may not be created from free text.
    if tg_op = 'INSERT' then
      raise exception 'proposal_item_catalog_link_required';
    end if;
    return new;
  end if;

  v_canonical_no := nullif(trim(coalesce(
    v_catalog.activity_no,
    v_catalog.value,
    v_catalog.gefen_number,
    ''
  )), '');

  if v_canonical_no is null then
    if tg_op = 'INSERT' then
      raise exception 'proposal_item_activity_number_required';
    end if;
    return new;
  end if;

  v_catalog_type := lower(trim(coalesce(
    v_catalog.activity_type,
    v_catalog.type,
    v_catalog.parent_value,
    ''
  )));

  v_operational_name := nullif(trim(coalesce(
    v_catalog.activity_name,
    v_catalog.label_he,
    v_catalog.label,
    ''
  )), '');

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

  -- Keep the Gefen identity aligned when the catalog row has one. For
  -- non-Gefen activities, do not manufacture a Gefen number from activity_no.
  if nullif(trim(coalesce(v_catalog.gefen_number, '')), '') is not null then
    new.gefen_number := trim(v_catalog.gefen_number);
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_proposal_activity_catalog_identity() from public;
grant execute on function public.enforce_proposal_activity_catalog_identity() to authenticated;
grant execute on function public.enforce_proposal_activity_catalog_identity() to service_role;

drop trigger if exists aab_activities_proposal_catalog_identity on public.activities;
create trigger aab_activities_proposal_catalog_identity
before insert or update of proposal_item_id, activity_name, activity_no, gefen_number
on public.activities
for each row
execute function public.enforce_proposal_activity_catalog_identity();

comment on function public.enforce_proposal_activity_catalog_identity() is
  'Canonicalizes proposal-linked school_2027 activities by catalog activity_no and operational short name; new free-text proposal items cannot create operational activities.';

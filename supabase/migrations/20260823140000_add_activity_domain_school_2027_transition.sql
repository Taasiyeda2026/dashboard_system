-- Phase 1: introduce a separate E/Y activity domain.
-- The column is reusable for future seasons; only the backfill below is scoped to school_2027.

begin;

alter table public.activities
  add column if not exists activity_domain text;

alter table public.activities
  drop constraint if exists activities_activity_domain_check;

alter table public.activities
  add constraint activities_activity_domain_check
  check (activity_domain is null or activity_domain in ('E', 'Y'));

-- Keep trg_guard_proposal_linked_activity_domain_y, the existing E-routing guard,
-- unchanged. This separate server-side trigger initializes Y from a linked
-- proposal only when the activity has no domain yet; activity_domain remains
-- the final source of truth after a user saves a manual value.
create or replace function public.assign_y_proposal_domain_to_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_proposal_id uuid;
  v_domain text;
begin
  if new.activity_season is distinct from 'school_2027' then
    return new;
  end if;

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

  if v_domain = 'Y' and new.activity_domain is null then
    new.activity_domain := 'Y';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_assign_y_proposal_domain_to_activity on public.activities;
create trigger trg_assign_y_proposal_domain_to_activity
before insert or update of proposal_agreement_id, proposal_item_id
on public.activities
for each row
execute function public.assign_y_proposal_domain_to_activity();

comment on function public.assign_y_proposal_domain_to_activity() is
  'Initializes a NULL activity_domain to Y server-side when an activity is linked to a proposal-domain Y source. A saved activity_domain remains authoritative. The existing E-to-Israa guard remains unchanged.';

-- Backfill only school_2027 rows with one unambiguous, real proposal source.
-- Direct agreement links are authoritative when present; an item link may resolve
-- the source only if a direct agreement link is absent. Any disagreement is skipped.
with link_candidates as (
  select
    a.row_id,
    pa_direct.id as direct_proposal_id,
    upper(btrim(coalesce(pa_direct.proposal_domain, ''))) as direct_domain,
    pa_item.id as item_proposal_id,
    upper(btrim(coalesce(pa_item.proposal_domain, ''))) as item_domain
  from public.activities a
  left join public.proposals_agreements pa_direct
    on pa_direct.id = a.proposal_agreement_id
  left join public.proposal_agreement_items pai
    on pai.id = a.proposal_item_id
  left join public.proposals_agreements pa_item
    on pa_item.id = pai.proposal_agreement_id
  where a.activity_season = 'school_2027'
    and a.activity_domain is null
),
resolved_y_links as (
  select row_id
  from link_candidates
  where (
    direct_proposal_id is not null
    and direct_domain = 'Y'
    and (
      item_proposal_id is null
      or (direct_proposal_id = item_proposal_id and item_domain = 'Y')
    )
  )
  or (
    direct_proposal_id is null
    and item_proposal_id is not null
    and item_domain = 'Y'
  )
)
update public.activities a
set activity_domain = 'Y'
from resolved_y_links r
where a.row_id = r.row_id
  and a.activity_season = 'school_2027'
  and a.activity_domain is null;

commit;
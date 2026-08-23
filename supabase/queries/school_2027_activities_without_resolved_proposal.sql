-- Manual-link review only. This is a saved SELECT query, not a view or CSV export.
-- It returns school_2027 activities whose existing proposal_agreement_id /
-- proposal_item_id values do not resolve to one unambiguous proposal.

with activity_links as (
  select
    a.row_id,
    a.activity_domain,
    a.proposal_agreement_id,
    a.proposal_item_id,
    a.authority,
    a.school,
    a.activity_name,
    a.activity_type,
    a.activity_no,
    pa_direct.id as direct_proposal_id,
    pai.proposal_agreement_id as item_agreement_id,
    pa_item.id as item_proposal_id
  from public.activities a
  left join public.proposals_agreements pa_direct
    on pa_direct.id = a.proposal_agreement_id
  left join public.proposal_agreement_items pai
    on pai.id = a.proposal_item_id
  left join public.proposals_agreements pa_item
    on pa_item.id = pai.proposal_agreement_id
  where a.activity_season = 'school_2027'
),
resolved as (
  select
    *,
    case
      when direct_proposal_id is not null
        and (item_proposal_id is null or direct_proposal_id = item_proposal_id)
        then direct_proposal_id
      when direct_proposal_id is null and item_proposal_id is not null
        then item_proposal_id
      else null
    end as resolved_proposal_id
  from activity_links
)
select
  row_id,
  activity_domain,
  authority,
  school,
  activity_name,
  activity_type,
  activity_no,
  proposal_agreement_id,
  proposal_item_id,
  case
    when proposal_agreement_id is null and proposal_item_id is null then 'no_link'
    when proposal_agreement_id is not null and direct_proposal_id is null then 'missing_direct_proposal'
    when proposal_item_id is not null and item_proposal_id is null then 'missing_item_proposal'
    when direct_proposal_id is not null and item_proposal_id is not null and direct_proposal_id <> item_proposal_id then 'conflicting_links'
    else 'unresolved'
  end as link_resolution
from resolved
where resolved_proposal_id is null
order by authority nulls last, school nulls last, activity_name nulls last, row_id;
alter table public.proposals_agreements
  add column if not exists proposal_domain text not null default 'A';

update public.proposals_agreements
set proposal_domain = case
  when lower(coalesce(created_by, '')) in ('3030', 'esraaa') then 'N'
  else 'A'
end
where proposal_domain is null
   or proposal_domain not in ('A', 'N');

alter table public.proposals_agreements
  drop constraint if exists proposals_agreements_proposal_domain_chk;

alter table public.proposals_agreements
  add constraint proposals_agreements_proposal_domain_chk
  check (proposal_domain in ('A', 'N'));

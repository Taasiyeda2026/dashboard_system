-- Make the GEFEN approval page an explicit per-proposal choice.
-- Existing rows, sent proposals, snapshots, PDFs and linked documents are not modified.
alter table public.proposals_agreements
  alter column combine_gefen_approval set default false;

-- Keep the item trigger only as a safety guard: it may clear an invalid choice,
-- but must never enable the choice when an eligible item is added.
create or replace function public.sync_next_year_gefen_combination()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_new_proposal_id uuid;
  v_old_proposal_id uuid;
begin
  if tg_op <> 'DELETE' then
    v_new_proposal_id := new.proposal_agreement_id;
  end if;
  if tg_op <> 'INSERT' then
    v_old_proposal_id := old.proposal_agreement_id;
  end if;

  update public.proposals_agreements p
  set combine_gefen_approval = false
  where p.id in (v_new_proposal_id, v_old_proposal_id)
    and lower(btrim(coalesce(p.status, ''))) <> 'sent'
    and p.combine_gefen_approval = true
    and not public.proposal_has_eligible_gefen_items(p.id);

  return null;
end;
$function$;

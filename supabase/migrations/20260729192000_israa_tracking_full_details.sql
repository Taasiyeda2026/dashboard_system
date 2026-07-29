alter table public.israa_program_tracking
  add column if not exists valid_until date,
  add column if not exists outreach_method text,
  add column if not exists barriers text;

update public.israa_program_tracking t
set valid_until = p.valid_until
from public.proposals_agreements p
where t.proposal_agreement_id = p.id
  and t.valid_until is null
  and p.valid_until is not null;

comment on column public.israa_program_tracking.valid_until is 'Proposal validity date.';
comment on column public.israa_program_tracking.outreach_method is 'How the lead or proposal was initiated.';
comment on column public.israa_program_tracking.barriers is 'Current blockers or barriers for advancing the proposal.';

do $migration$
declare
  v_definition text;
  v_original text;
begin
  select pg_get_functiondef('public.create_israa_tracking_from_proposal(uuid)'::regprocedure)
  into v_definition;

  if position(E'    valid_until,\n    proposal_nature,' in v_definition) > 0
     and position(E'    notes = case\n' in v_definition) > 0 then
    return;
  end if;

  v_original := v_definition;

  v_definition := replace(
    v_definition,
    E'    activity_date,\n    proposal_nature,',
    E'    activity_date,\n    valid_until,\n    proposal_nature,'
  );
  v_definition := replace(
    v_definition,
    E'    status,\n    proposal_items,',
    E'    status,\n    notes,\n    proposal_items,'
  );
  v_definition := replace(
    v_definition,
    E'    v_proposal.proposal_date,\n    v_proposal.proposal_date,\n    v_nature,',
    E'    v_proposal.proposal_date,\n    v_proposal.proposal_date,\n    v_proposal.valid_until,\n    v_nature,'
  );
  v_definition := replace(
    v_definition,
    E'    v_tracking_status,\n    v_items_json,',
    E'    v_tracking_status,\n    nullif(btrim(coalesce(v_proposal.notes, '''')), ''''),\n    v_items_json,'
  );
  v_definition := replace(
    v_definition,
    E'    activity_date = excluded.activity_date,\n    proposal_nature =',
    E'    activity_date = excluded.activity_date,\n    valid_until = coalesce(excluded.valid_until, current_row.valid_until),\n    proposal_nature ='
  );
  v_definition := replace(
    v_definition,
    E'    proposal_items = excluded.proposal_items,',
    E'    notes = case\n      when nullif(btrim(coalesce(current_row.notes, '''')), '''') is null then excluded.notes\n      else current_row.notes\n    end,\n    proposal_items = excluded.proposal_items,'
  );

  if v_definition = v_original then
    raise exception 'create_israa_tracking_from_proposal was not updated';
  end if;
  if position('valid_until' in v_definition) = 0
     or position('notes = case' in v_definition) = 0 then
    raise exception 'proposal detail fields were not added to function';
  end if;

  execute v_definition;
end
$migration$;

comment on function public.create_israa_tracking_from_proposal(uuid) is
  'Creates or refreshes one Israa tracking row for a domain E proposal, including validity and proposal notes. New rows start as נשלחה; manual tracking fields are preserved.';

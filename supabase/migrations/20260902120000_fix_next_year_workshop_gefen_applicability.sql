-- Keep editable next-year workshops out of the GEFEN course flow and derive
-- combined GEFEN approval strictly from actual eligible GEFEN course items.
-- Sent proposals are intentionally left immutable.

create or replace function public.normalize_next_year_workshop_item()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_group text := lower(btrim(coalesce(new.proposal_group, '')));
  v_item_type text := lower(btrim(coalesce(new.item_type, '')));
  v_source_key text := lower(btrim(coalesce(new.source_pricing_key, '')));
  v_item_name text := lower(btrim(coalesce(new.item_name, '')));
begin
  if v_group in ('next_year', 'next_year_courses', 'next_year_workshops')
     and (
       v_item_type ~ '(סדנ|workshop)'
       or v_source_key in ('maker_workshop', 'space_workshop')
       or v_item_name ~ '^סדנ'
     )
  then
    new.proposal_group := 'next_year_workshops';
    new.gefen_number := '';
  end if;

  return new;
end;
$function$;

drop trigger if exists proposal_agreement_items_normalize_next_year_workshop
  on public.proposal_agreement_items;
create trigger proposal_agreement_items_normalize_next_year_workshop
before insert or update of proposal_group, item_type, source_pricing_key, item_name, gefen_number
on public.proposal_agreement_items
for each row execute function public.normalize_next_year_workshop_item();

-- Correct editable rows already saved as next_year_courses although they are workshops.
update public.proposal_agreement_items i
set proposal_group = 'next_year_workshops',
    gefen_number = ''
from public.proposals_agreements p
where p.id = i.proposal_agreement_id
  and lower(btrim(coalesce(p.status, ''))) <> 'sent'
  and lower(btrim(coalesce(i.proposal_group, ''))) in ('next_year', 'next_year_courses', 'next_year_workshops')
  and (
    lower(btrim(coalesce(i.item_type, ''))) ~ '(סדנ|workshop)'
    or lower(btrim(coalesce(i.source_pricing_key, ''))) in ('maker_workshop', 'space_workshop')
    or lower(btrim(coalesce(i.item_name, ''))) ~ '^סדנ'
  );

create or replace function public.proposal_has_eligible_gefen_items(p_proposal_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select exists (
    select 1
    from public.proposal_agreement_items i
    where i.proposal_agreement_id = p_proposal_id
      and nullif(btrim(coalesce(i.gefen_number, '')), '') is not null
      and lower(btrim(coalesce(i.proposal_group, ''))) <> 'next_year_workshops'
      and lower(btrim(coalesce(i.proposal_display_mode, ''))) <> 'bundle_child'
      and lower(btrim(coalesce(i.item_type, ''))) !~ '(סדנ|workshop)'
  );
$function$;

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

  if v_new_proposal_id is not null then
    update public.proposals_agreements p
    set combine_gefen_approval = public.proposal_has_eligible_gefen_items(p.id)
    where p.id = v_new_proposal_id
      and lower(btrim(coalesce(p.status, ''))) <> 'sent'
      and lower(btrim(coalesce(p.activity_type_group, ''))) in (
        'next_year', 'שנה הבאה', 'שנת הלימודים תשפ״ז', 'תוכניות תשפ״ז', 'תשפ״ז'
      )
      and p.combine_gefen_approval is distinct from public.proposal_has_eligible_gefen_items(p.id);
  end if;

  if v_old_proposal_id is not null and v_old_proposal_id is distinct from v_new_proposal_id then
    update public.proposals_agreements p
    set combine_gefen_approval = public.proposal_has_eligible_gefen_items(p.id)
    where p.id = v_old_proposal_id
      and lower(btrim(coalesce(p.status, ''))) <> 'sent'
      and lower(btrim(coalesce(p.activity_type_group, ''))) in (
        'next_year', 'שנה הבאה', 'שנת הלימודים תשפ״ז', 'תוכניות תשפ״ז', 'תשפ״ז'
      )
      and p.combine_gefen_approval is distinct from public.proposal_has_eligible_gefen_items(p.id);
  end if;

  return null;
end;
$function$;

drop trigger if exists proposal_agreement_items_sync_next_year_gefen
  on public.proposal_agreement_items;
create constraint trigger proposal_agreement_items_sync_next_year_gefen
after insert or update or delete on public.proposal_agreement_items
deferrable initially deferred
for each row execute function public.sync_next_year_gefen_combination();

-- Backfill the parent flag for editable next-year proposals. This prevents an
-- empty GEFEN approval page from being appended to workshop-only/non-GEFEN proposals.
update public.proposals_agreements p
set combine_gefen_approval = public.proposal_has_eligible_gefen_items(p.id)
where lower(btrim(coalesce(p.status, ''))) <> 'sent'
  and lower(btrim(coalesce(p.activity_type_group, ''))) in (
    'next_year', 'שנה הבאה', 'שנת הלימודים תשפ״ז', 'תוכניות תשפ״ז', 'תשפ״ז'
  )
  and p.combine_gefen_approval is distinct from public.proposal_has_eligible_gefen_items(p.id);

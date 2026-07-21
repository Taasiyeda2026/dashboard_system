create or replace function public.set_proposal_final_pdf_display_name()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  snapshot_row jsonb := coalesce(new.document_snapshot -> 'row', '{}'::jsonb);
  school_name text := btrim(coalesce(
    nullif(snapshot_row ->> 'school_framework', ''),
    nullif(new.school_framework, ''),
    ''
  ));
  authority_name text := btrim(coalesce(
    nullif(snapshot_row ->> 'client_authority', ''),
    nullif(new.client_authority, ''),
    ''
  ));
  type_key text := btrim(coalesce(
    nullif(snapshot_row ->> 'activity_type_group', ''),
    nullif(new.activity_type_group, ''),
    ''
  ));
  type_label text;
  recipient_label text;
begin
  if coalesce(btrim(new.final_pdf_path), '') = '' then
    return new;
  end if;

  type_label := case type_key
    when 'next_year' then 'תשפז'
    when 'summer' then 'קיץ'
    when 'tour' then 'סיור'
    when 'combined' then 'קיץ ותשפז'
    when 'תשפ״ז' then 'תשפז'
    when 'תשפז' then 'תשפז'
    else type_key
  end;

  if school_name <> '' and authority_name <> '' then
    if regexp_replace(lower(school_name), '\s+', '', 'g') = regexp_replace(lower(authority_name), '\s+', '', 'g') then
      recipient_label := school_name;
    else
      recipient_label := school_name || ' - ' || authority_name;
    end if;
  elsif school_name <> '' then
    recipient_label := school_name;
  elsif authority_name <> '' then
    recipient_label := authority_name;
  else
    recipient_label := 'לקוח';
  end if;

  recipient_label := btrim(translate(recipient_label, E'\\/:*?"<>|', '_________'));
  type_label := btrim(translate(coalesce(type_label, ''), E'\\/:*?"<>|', '_________'));

  new.final_pdf_file_name := 'הצעת מחיר'
    || case when type_label <> '' then ' ' || type_label else '' end
    || ' (' || recipient_label || ').pdf';

  return new;
end;
$function$;

comment on function public.set_proposal_final_pdf_display_name() is
'Keeps the storage object key ASCII-safe while assigning a readable Hebrew proposal PDF display filename from the proposal type, school and authority.';

drop trigger if exists trg_set_proposal_final_pdf_display_name on public.proposals_agreements;
create trigger trg_set_proposal_final_pdf_display_name
before insert or update on public.proposals_agreements
for each row
execute function public.set_proposal_final_pdf_display_name();

update public.proposals_agreements
set final_pdf_file_name = coalesce(final_pdf_file_name, '')
where coalesce(btrim(final_pdf_path), '') <> '';

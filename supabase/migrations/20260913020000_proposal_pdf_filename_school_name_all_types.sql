-- Any newly saved proposal PDF that belongs to a school receives one readable name:
-- "הצעת מחיר <שם בית הספר>.pdf".
-- The storage object key remains unchanged. Proposals without a school keep the existing fallback naming.

create or replace function public.set_proposal_final_pdf_display_name()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  snapshot_row jsonb := coalesce(new.document_snapshot -> 'row', '{}'::jsonb);
  school_name text := btrim(coalesce(
    nullif(snapshot_row ->> 'school_framework', ''),
    nullif(snapshot_row ->> 'school_name', ''),
    nullif(new.school_framework, ''),
    ''
  ));
  semel_mosad text := btrim(coalesce(
    nullif(snapshot_row ->> 'semel_mosad', ''),
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
  school_filename_name text := '';
  catalog_school_name text := '';
  catalog_semel_mosad text := '';
  contact_school_name text := '';
  contact_semel_mosad text := '';
begin
  if coalesce(btrim(new.final_pdf_path), '') = '' then
    return new;
  end if;

  if new.school_id is not null then
    select
      btrim(coalesce(s.school_name, '')),
      btrim(coalesce(s.semel_mosad::text, ''))
    into catalog_school_name, catalog_semel_mosad
    from public.schools s
    where s.id = new.school_id;
  end if;

  if new.contact_school_id is not null
    and (school_name = '' or semel_mosad = '')
  then
    select
      btrim(coalesce(cs.school, '')),
      btrim(coalesce(cs.semel_mosad::text, ''))
    into contact_school_name, contact_semel_mosad
    from public.contacts_schools cs
    where cs.id = new.contact_school_id;
  end if;

  school_name := coalesce(
    nullif(school_name, ''),
    nullif(catalog_school_name, ''),
    nullif(contact_school_name, ''),
    ''
  );
  semel_mosad := coalesce(
    nullif(semel_mosad, ''),
    nullif(catalog_semel_mosad, ''),
    nullif(contact_semel_mosad, ''),
    ''
  );

  school_filename_name := btrim(regexp_replace(
    translate(school_name, E'\\/:*?"<>|״“”', ''),
    '\s+',
    ' ',
    'g'
  ));

  if school_filename_name <> '' or semel_mosad <> '' then
    recipient_label := coalesce(
      nullif(school_filename_name, ''),
      nullif(semel_mosad, ''),
      'לקוח'
    );
    new.final_pdf_file_name := 'הצעת מחיר ' || recipient_label || '.pdf';
    return new;
  end if;

  school_name := btrim(translate(school_name, E'\\/:*?"<>|', '_________'));

  type_label := case type_key
    when 'next_year' then 'תשפז'
    when 'summer' then 'קיץ'
    when 'tour' then 'סיור'
    when 'combined' then 'קיץ ותשפז'
    when 'תשפ״ז' then 'תשפז'
    when 'תשפז' then 'תשפז'
    else type_key
  end;

  if authority_name <> '' and school_name <> '' then
    if regexp_replace(lower(authority_name), '\s+', '', 'g') = regexp_replace(lower(school_name), '\s+', '', 'g') then
      recipient_label := authority_name;
    else
      recipient_label := authority_name || ' - ' || school_name;
    end if;
  elsif authority_name <> '' then
    recipient_label := authority_name;
  elsif school_name <> '' then
    recipient_label := school_name;
  else
    recipient_label := 'לקוח';
  end if;

  recipient_label := btrim(translate(recipient_label, E'\\/:*?"<>|', '_________'));
  type_label := btrim(translate(coalesce(type_label, ''), E'\\/:*?"<>|', '_________'));

  new.final_pdf_file_name := recipient_label
    || case when type_label <> '' then ' - ' || type_label else '' end
    || ' - הצעת מחיר.pdf';

  return new;
end;
$function$;

comment on function public.set_proposal_final_pdf_display_name() is
  'Names newly saved school proposal PDFs as quote plus the school name, regardless of proposal type; non-school proposals keep the existing fallback naming.';

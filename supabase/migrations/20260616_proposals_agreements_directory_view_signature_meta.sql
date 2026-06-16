-- Keep proposals_agreements_directory_view aligned with the fields selected by the proposals screen.
-- signature_meta is stored on the source proposals_agreements row and is required to render
-- the saved approval signature placement for approved proposals/agreements.
do $$
begin
  if to_regclass('public.proposals_agreements_directory_view') is not null
     and not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'proposals_agreements_directory_view'
         and column_name = 'signature_meta'
     ) then
    drop view if exists public.proposals_agreements_directory_view_without_signature_meta_20260616;

    alter view public.proposals_agreements_directory_view
      rename to proposals_agreements_directory_view_without_signature_meta_20260616;

    create view public.proposals_agreements_directory_view as
      select
        directory_row.*,
        coalesce(pa.signature_meta, '{}'::jsonb) as signature_meta
      from public.proposals_agreements_directory_view_without_signature_meta_20260616 directory_row
      left join public.proposals_agreements pa on pa.id = directory_row.id;

    grant select on public.proposals_agreements_directory_view to authenticated;
  end if;
end $$;

-- External agreements and quotations belong ONLY to an existing client file.
-- They are not proposals, carry no internal quote number, and never enter
-- proposal approval, pricing, payment or GEFEN workflows.

create table if not exists public.client_external_documents (
  id uuid primary key default gen_random_uuid(),
  client_key text not null check (length(client_key) between 3 and 256 and client_key ~ '^(school|authority|other):.+$'),
  document_kind text not null check (document_kind in ('agreement', 'quote')),
  title text not null check (length(btrim(title)) between 1 and 200),
  external_number text check (external_number is null or length(external_number) <= 100),
  document_date date,
  amount numeric(14,2) check (amount is null or amount >= 0),
  notes text check (notes is null or length(notes) <= 2000),
  file_path text not null unique,
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint client_external_document_path_check
    check (file_path = 'documents/' || id::text || '.pdf')
);
create index if not exists client_external_documents_client_created_idx
  on public.client_external_documents(client_key, created_at desc);

alter table public.client_external_documents enable row level security;
revoke all on public.client_external_documents from public, anon;
grant select, insert, delete on public.client_external_documents to authenticated;

create policy client_external_documents_read
  on public.client_external_documents for select to authenticated
  using (public.app_can_view_proposals_agreements());

create policy client_external_documents_insert
  on public.client_external_documents for insert to authenticated
  with check (public.app_can_manage_proposals_agreements() and created_by = auth.uid());

create policy client_external_documents_delete
  on public.client_external_documents for delete to authenticated
  using (public.app_can_manage_proposals_agreements());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-external-documents', 'client-external-documents', false, 15728640, array['application/pdf']::text[])
on conflict (id) do nothing;

create policy client_external_documents_storage_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'client-external-documents'
    and public.app_can_view_proposals_agreements()
  );

create policy client_external_documents_storage_upload
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'client-external-documents'
    and public.app_can_manage_proposals_agreements()
    and name ~ '^documents/[a-f0-9-]{36}\.pdf$'
  );

create policy client_external_documents_storage_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'client-external-documents'
    and public.app_can_manage_proposals_agreements()
  );

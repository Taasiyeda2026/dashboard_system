-- Admin-managed paper-only PDF alternatives to digital feedback.
-- Never regenerate PDFs and never connect paper responses to online reporting.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-template-pdfs', 'feedback-template-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf'];

create table if not exists public.feedback_template_pdfs (
  template_id uuid primary key references public.feedback_templates(id) on delete cascade,
  version_id uuid not null references public.feedback_template_versions(id),
  storage_path text not null unique,
  file_name text not null,
  uploaded_by uuid not null default auth.uid(),
  uploaded_at timestamptz not null default now(),
  constraint feedback_pdf_path_format check (
    storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.]pdf$'
  ),
  constraint feedback_pdf_filename check (length(file_name) between 1 and 255)
);

create or replace function private.feedback_validate_paper_pdf()
returns trigger language plpgsql security definer
set search_path = '' as $$
declare
  published_version uuid;
  published_status text;
begin
  if not private.feedback_is_admin() then
    raise exception 'feedback_forbidden' using errcode = '42501';
  end if;
  select current_version_id into published_version
  from public.feedback_templates where id = new.template_id for update;
  select status into published_status from public.feedback_template_versions
    where id = new.version_id and template_id = new.template_id;
  if published_version is distinct from new.version_id or published_status is distinct from 'published' then
    raise exception 'feedback_pdf_version_mismatch' using errcode = '23514';
  end if;
  if split_part(new.storage_path, '/', 1) <> new.template_id::text then
    raise exception 'feedback_pdf_invalid_path' using errcode = '23514';
  end if;
  new.uploaded_by := auth.uid();
  new.uploaded_at := now();
  return new;
end;
$$;
revoke all on function private.feedback_validate_paper_pdf() from public, anon, authenticated;
drop trigger if exists feedback_validate_paper_pdf_trigger on public.feedback_template_pdfs;
create trigger feedback_validate_paper_pdf_trigger
  before insert or update on public.feedback_template_pdfs
  for each row execute function private.feedback_validate_paper_pdf();

alter table public.feedback_template_pdfs enable row level security;
revoke all on public.feedback_template_pdfs from public, anon, authenticated;
grant select, insert, update, delete on public.feedback_template_pdfs to authenticated;
drop policy if exists feedback_template_pdfs_admin_select on public.feedback_template_pdfs;
create policy feedback_template_pdfs_admin_select on public.feedback_template_pdfs
  for select to authenticated using ((select private.feedback_is_admin()));
drop policy if exists feedback_template_pdfs_admin_insert on public.feedback_template_pdfs;
create policy feedback_template_pdfs_admin_insert on public.feedback_template_pdfs
  for insert to authenticated with check ((select private.feedback_is_admin()));
drop policy if exists feedback_template_pdfs_admin_update on public.feedback_template_pdfs;
create policy feedback_template_pdfs_admin_update on public.feedback_template_pdfs
  for update to authenticated using ((select private.feedback_is_admin()))
  with check ((select private.feedback_is_admin()));
drop policy if exists feedback_template_pdfs_admin_delete on public.feedback_template_pdfs;
create policy feedback_template_pdfs_admin_delete on public.feedback_template_pdfs
  for delete to authenticated using ((select private.feedback_is_admin()));

-- Private bucket; only a genuine administrator can read/write objects.
drop policy if exists feedback_template_pdf_read_admin on storage.objects;
create policy feedback_template_pdf_read_admin on storage.objects
  for select to authenticated using (
    bucket_id = 'feedback-template-pdfs' and (select private.feedback_is_admin())
  );
drop policy if exists feedback_template_pdf_insert_admin on storage.objects;
create policy feedback_template_pdf_insert_admin on storage.objects
  for insert to authenticated with check (
    bucket_id = 'feedback-template-pdfs' and (select private.feedback_is_admin())
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and lower(storage.extension(name)) = 'pdf'
  );
drop policy if exists feedback_template_pdf_update_admin on storage.objects;
create policy feedback_template_pdf_update_admin on storage.objects
  for update to authenticated using (
    bucket_id = 'feedback-template-pdfs' and (select private.feedback_is_admin())
  ) with check (
    bucket_id = 'feedback-template-pdfs' and (select private.feedback_is_admin())
  );
drop policy if exists feedback_template_pdf_delete_admin on storage.objects;
create policy feedback_template_pdf_delete_admin on storage.objects
  for delete to authenticated using (
    bucket_id = 'feedback-template-pdfs' and (select private.feedback_is_admin())
  );

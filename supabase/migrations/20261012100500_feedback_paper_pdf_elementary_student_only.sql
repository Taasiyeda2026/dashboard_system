-- Paper PDFs belong only to student pre/post templates of elementary programs.
-- Program education_level (not title/grade text) is the source of truth.
-- Templates, bilingual questions, published versions and digital submissions remain unchanged.

create or replace function private.feedback_is_elementary_student_template(p_template_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.feedback_templates t
    join public.feedback_programs p on p.key = t.program_key
    where t.id::text = p_template_id
      and t.audience = 'student'
      and t.stage in ('pre', 'post')
      and p.education_level = 'elementary'
  );
$$;
revoke all on function private.feedback_is_elementary_student_template(text) from public, anon, authenticated;
grant execute on function private.feedback_is_elementary_student_template(text) to authenticated;

-- Retain original admin, published-version and path checks.
create or replace function private.feedback_validate_paper_pdf()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  published_version uuid;
  published_status text;
begin
  if not private.feedback_is_admin() then
    raise exception 'feedback_forbidden' using errcode = '42501';
  end if;
  if not private.feedback_is_elementary_student_template(new.template_id::text) then
    raise exception 'feedback_pdf_elementary_only' using errcode = '23514';
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

-- Make both admin and pilot-viewer PDF metadata access elementary-only.
drop policy if exists feedback_template_pdfs_admin_select on public.feedback_template_pdfs;
create policy feedback_template_pdfs_admin_select on public.feedback_template_pdfs
  for select to authenticated using (
    (select private.feedback_is_admin())
    and private.feedback_is_elementary_student_template(template_id::text)
  );
drop policy if exists feedback_template_pdfs_pilot_select on public.feedback_template_pdfs;
create policy feedback_template_pdfs_pilot_select on public.feedback_template_pdfs
  for select to authenticated using (
    (select private.feedback_can_view())
    and private.feedback_is_elementary_student_template(template_id::text)
    and exists (select 1 from public.feedback_templates t
      where t.id = template_id and t.current_version_id is not null)
  );
drop policy if exists feedback_template_pdfs_admin_insert on public.feedback_template_pdfs;
create policy feedback_template_pdfs_admin_insert on public.feedback_template_pdfs
  for insert to authenticated with check (
    (select private.feedback_is_admin())
    and private.feedback_is_elementary_student_template(template_id::text)
  );
drop policy if exists feedback_template_pdfs_admin_update on public.feedback_template_pdfs;
create policy feedback_template_pdfs_admin_update on public.feedback_template_pdfs
  for update to authenticated using (
    (select private.feedback_is_admin())
    and private.feedback_is_elementary_student_template(template_id::text)
  ) with check (
    (select private.feedback_is_admin())
    and private.feedback_is_elementary_student_template(template_id::text)
  );
drop policy if exists feedback_template_pdfs_admin_delete on public.feedback_template_pdfs;
create policy feedback_template_pdfs_admin_delete on public.feedback_template_pdfs
  for delete to authenticated using (
    (select private.feedback_is_admin())
    and private.feedback_is_elementary_student_template(template_id::text)
  );

-- Restrict direct Storage access as well, not just the front end or metadata trigger.
drop policy if exists feedback_template_pdf_read_admin on storage.objects;
create policy feedback_template_pdf_read_admin on storage.objects
  for select to authenticated using (
    bucket_id = 'feedback-template-pdfs'
    and (select private.feedback_is_admin())
    and private.feedback_is_elementary_student_template((storage.foldername(name))[1])
  );
drop policy if exists feedback_template_pdf_read_pilot on storage.objects;
create policy feedback_template_pdf_read_pilot on storage.objects
  for select to authenticated using (
    bucket_id = 'feedback-template-pdfs'
    and (select private.feedback_can_view())
    and private.feedback_is_elementary_student_template((storage.foldername(name))[1])
  );
drop policy if exists feedback_template_pdf_insert_admin on storage.objects;
create policy feedback_template_pdf_insert_admin on storage.objects
  for insert to authenticated with check (
    bucket_id = 'feedback-template-pdfs'
    and (select private.feedback_is_admin())
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and lower(storage.extension(name)) = 'pdf'
    and private.feedback_is_elementary_student_template((storage.foldername(name))[1])
  );
drop policy if exists feedback_template_pdf_update_admin on storage.objects;
create policy feedback_template_pdf_update_admin on storage.objects
  for update to authenticated using (
    bucket_id = 'feedback-template-pdfs'
    and (select private.feedback_is_admin())
    and private.feedback_is_elementary_student_template((storage.foldername(name))[1])
  ) with check (
    bucket_id = 'feedback-template-pdfs'
    and (select private.feedback_is_admin())
    and private.feedback_is_elementary_student_template((storage.foldername(name))[1])
  );
drop policy if exists feedback_template_pdf_delete_admin on storage.objects;
create policy feedback_template_pdf_delete_admin on storage.objects
  for delete to authenticated using (
    bucket_id = 'feedback-template-pdfs'
    and (select private.feedback_is_admin())
    and private.feedback_is_elementary_student_template((storage.foldername(name))[1])
  );

notify pgrst, 'reload schema';

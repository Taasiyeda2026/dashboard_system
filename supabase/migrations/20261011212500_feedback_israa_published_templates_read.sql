-- Pilot access: admins keep full rights; only Israa (user_id 3030) may
-- READ currently published feedback templates, their questions, and PDF files.
-- Existing private.feedback_can_view() validates the active auth.uid() account.
-- Leave existing admin-only RLS write policies, draft RPCs, and edits unchanged.

create policy feedback_templates_pilot_view_select
  on public.feedback_templates for select to authenticated
  using ((select private.feedback_can_view()));

create policy feedback_template_versions_pilot_published_select
  on public.feedback_template_versions for select to authenticated
  using (
    (select private.feedback_can_view())
    and status = 'published'
    and exists (
      select 1 from public.feedback_templates t
      where t.id = template_id and t.current_version_id = id
    )
  );

create policy feedback_template_questions_pilot_published_select
  on public.feedback_template_questions for select to authenticated
  using (
    (select private.feedback_can_view())
    and exists (
      select 1 from public.feedback_template_versions v
      where v.id = version_id and v.status = 'published'
    )
  );

create policy feedback_template_pdfs_pilot_select
  on public.feedback_template_pdfs for select to authenticated
  using (
    (select private.feedback_can_view())
    and exists (
      select 1 from public.feedback_templates t
      where t.id = template_id and t.current_version_id is not null
    )
  );

-- A PDF for a published questionnaire may be downloaded by a pilot viewer.
-- Upload, replacement and deletion remain restricted by the existing admin policies.
create policy feedback_template_pdf_read_pilot
  on storage.objects for select to authenticated
  using (
    bucket_id = 'feedback-template-pdfs'
    and (select private.feedback_can_view())
  );

-- Protect against accidentally exposing draft versions and modifying access.
do $validate_feedback_viewer_policies$
declare n integer;
begin
  select count(*) into n from pg_policies
  where (schemaname,tablename,policyname) in (
    ('public','feedback_templates','feedback_templates_pilot_view_select'),
    ('public','feedback_template_versions','feedback_template_versions_pilot_published_select'),
    ('public','feedback_template_questions','feedback_template_questions_pilot_published_select'),
    ('public','feedback_template_pdfs','feedback_template_pdfs_pilot_select'),
    ('storage','objects','feedback_template_pdf_read_pilot')
  );
  if n <> 5 then raise exception 'feedback pilot template select policies missing: %',n; end if;

  if exists (
    select 1 from pg_policies
    where policyname in (
      'feedback_templates_pilot_view_select',
      'feedback_template_versions_pilot_published_select',
      'feedback_template_questions_pilot_published_select',
      'feedback_template_pdfs_pilot_select',
      'feedback_template_pdf_read_pilot'
    ) and cmd <> 'SELECT'
  ) then raise exception 'feedback pilot templates policy unexpectedly writes'; end if;
end $validate_feedback_viewer_policies$;

notify pgrst, 'reload schema';

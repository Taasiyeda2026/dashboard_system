-- Correct correlated column references in the published template RLS policy.
-- In the original SQL, unqualified "id" was resolved to the nested templates
-- table rather than the outer template_versions row.
alter policy feedback_template_versions_pilot_published_select
  on public.feedback_template_versions
  using (
    (select private.feedback_can_view())
    and status = 'published'
    and exists (
      select 1 from public.feedback_templates t
      where t.id = feedback_template_versions.template_id
        and t.current_version_id = feedback_template_versions.id
    )
  );
notify pgrst, 'reload schema';

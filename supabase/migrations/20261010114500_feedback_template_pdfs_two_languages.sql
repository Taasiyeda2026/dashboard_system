-- Separate stored printable PDFs for Hebrew and Arabic within each approved template.
-- Preserve existing Hebrew PDFs: existing rows automatically inherit language = 'he'.
-- This does NOT translate, publish or modify any digital questionnaire.
alter table public.feedback_template_pdfs
  add column if not exists language text not null default 'he';

alter table public.feedback_template_pdfs
  drop constraint if exists feedback_template_pdfs_language_check;
alter table public.feedback_template_pdfs
  add constraint feedback_template_pdfs_language_check
  check (language in ('he', 'ar'));

-- A template may have exactly one saved PDF per language, independently versioned.
alter table public.feedback_template_pdfs
  drop constraint if exists feedback_template_pdfs_pkey;
alter table public.feedback_template_pdfs
  add constraint feedback_template_pdfs_pkey primary key (template_id, language);

-- The existing RLS policies continue to restrict reads/writes to feedback admins.
-- Storage bucket and object path policy stay unchanged; no documents are moved.

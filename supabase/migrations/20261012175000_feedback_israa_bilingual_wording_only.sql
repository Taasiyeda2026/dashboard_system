-- Let Israa (specific active employee 3030) edit question wording in shared drafts.
-- Do not grant template publishing, structural changes, bank-question editing or PDF upload.
-- The published questionnaire remains immutable until an admin publishes its draft.

create or replace function private.feedback_is_israa_wording_editor()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.user_id = '3030'
      and u.role = 'business_development_manager'
      and coalesce(u.is_active, false)
  );
$$;
revoke all on function private.feedback_is_israa_wording_editor() from public, anon, authenticated;
grant execute on function private.feedback_is_israa_wording_editor() to authenticated;

-- Read drafts needed for the bilingual wording form, but never expose drafts to other viewers.
drop policy if exists feedback_template_versions_israa_draft_select on public.feedback_template_versions;
create policy feedback_template_versions_israa_draft_select
on public.feedback_template_versions for select to authenticated
using (status = 'draft' and (select private.feedback_is_israa_wording_editor()));

drop policy if exists feedback_template_questions_israa_draft_select on public.feedback_template_questions;
create policy feedback_template_questions_israa_draft_select
on public.feedback_template_questions for select to authenticated
using (
  (select private.feedback_is_israa_wording_editor())
  and exists (
    select 1 from public.feedback_template_versions v
    where v.id = version_id and v.status = 'draft'
  )
);

-- Only Israa can request or reopen a shared wording draft. The row lock serializes
-- concurrent callers and the existing unique partial index allows one draft per template.
create or replace function public.feedback_israa_get_wording_draft(p_template_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_current uuid;
  v_draft uuid;
begin
  if not private.feedback_is_israa_wording_editor() then
    raise exception 'feedback_forbidden' using errcode = '42501';
  end if;

  select t.current_version_id into v_current
  from public.feedback_templates t
  where t.id = p_template_id for update;
  if not found then raise exception 'feedback_template_not_found'; end if;
  if v_current is null then
    raise exception 'feedback_template_not_published';
  end if;

  select v.id into v_draft from public.feedback_template_versions v
  where v.template_id = p_template_id and v.status = 'draft';
  if v_draft is not null then return v_draft; end if;

  insert into public.feedback_template_versions
    (template_id, version_no, status, intro_text, intro_text_ar, created_by)
  select p_template_id,
    coalesce((select max(v.version_no) from public.feedback_template_versions v where v.template_id = p_template_id), 0) + 1,
    'draft', s.intro_text, s.intro_text_ar, auth.uid()
  from public.feedback_template_versions s
  where s.id = v_current
  returning id into v_draft;

  insert into public.feedback_template_questions
    (version_id, question_id, section, sort_order, required, metric_key,
     question_type, is_comparison, wording, options, scoring)
  select v_draft, q.question_id, q.section, q.sort_order, q.required,
    q.metric_key, q.question_type, q.is_comparison, q.wording, q.options, q.scoring
  from public.feedback_template_questions q
  where q.version_id = v_current;

  return v_draft;
end;
$$;
revoke all on function public.feedback_israa_get_wording_draft(uuid) from public, anon;
grant execute on function public.feedback_israa_get_wording_draft(uuid) to authenticated;

-- Update just one language key. The rest of the JSON wording and all structural
-- question properties are carried over unchanged. The expected value prevents stale overwrites.
create or replace function public.feedback_israa_update_wording(
  p_question_id uuid,
  p_language text,
  p_text text,
  p_expected_text text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_wording jsonb;
  v_key text;
  v_next text;
begin
  if not private.feedback_is_israa_wording_editor() then
    raise exception 'feedback_forbidden' using errcode = '42501';
  end if;
  if p_language not in ('he', 'ar') or p_language is null then
    raise exception 'feedback_wording_invalid_language' using errcode = '22023';
  end if;
  if p_text is null or length(btrim(p_text)) > 2000 then
    raise exception 'feedback_wording_invalid_text' using errcode = '22023';
  end if;
  v_next := btrim(p_text);
  v_key := case when p_language = 'he' then 'default' else 'ar' end;
  if v_key = 'default' and v_next = '' then
    raise exception 'feedback_wording_empty_he' using errcode = '22023';
  end if;
  if p_expected_text is null then
    raise exception 'feedback_wording_expected_required' using errcode = '22023';
  end if;

  -- SHARE prevents a concurrent publish while this RPC changes a question.
  select v.status into v_status
  from public.feedback_template_questions q
  join public.feedback_template_versions v on v.id = q.version_id
  where q.id = p_question_id for share of v;
  if not found or v_status <> 'draft' then
    raise exception 'feedback_version_locked' using errcode = '42501';
  end if;
  select q.wording into v_wording
  from public.feedback_template_questions q where q.id = p_question_id for update;

  if coalesce(v_wording->>v_key, '') is distinct from p_expected_text then
    raise exception 'feedback_wording_conflict' using errcode = '40001';
  end if;

  v_wording := jsonb_set(coalesce(v_wording, '{}'::jsonb),
    array[v_key], to_jsonb(v_next), true);

  update public.feedback_template_questions q
  set wording = v_wording where q.id = p_question_id;
  return v_wording;
end;
$$;
revoke all on function public.feedback_israa_update_wording(uuid,text,text,text) from public, anon;
grant execute on function public.feedback_israa_update_wording(uuid,text,text,text) to authenticated;

notify pgrst, 'reload schema';

-- Simplified annual-review workflow:
-- employee section + manager section -> shared read-only conversation -> manager summary -> employee response.

alter table public.annual_reviews
  add column if not exists employee_section_submitted_at timestamptz,
  add column if not exists manager_section_submitted_at timestamptz,
  add column if not exists answers_revealed_at timestamptz,
  add column if not exists conversation_started_at timestamptz,
  add column if not exists conversation_completed_at timestamptz,
  add column if not exists manager_summary_submitted_at timestamptz,
  add column if not exists employee_signed_at timestamptz;

alter table public.employee_review_preparation
  add column if not exists answers jsonb not null default '{}'::jsonb;

create table if not exists public.manager_review_preparation (
  review_id uuid primary key references public.annual_reviews(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.manager_review_summary (
  review_id uuid primary key references public.annual_reviews(id) on delete cascade,
  overall_assessment text not null default '',
  management_conclusion text not null default '',
  expectations text not null default '',
  additional_notes text not null default '',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employee_review_response
  add column if not exists summary_alignment text not null default '',
  add column if not exists alignment_explanation text not null default '',
  add column if not exists signature_name text not null default '',
  add column if not exists acceptance_confirmed boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employee_review_response_summary_alignment_check'
      and conrelid = 'public.employee_review_response'::regclass
  ) then
    alter table public.employee_review_response
      add constraint employee_review_response_summary_alignment_check
      check (summary_alignment in ('', 'yes', 'partial', 'no'));
  end if;
end
$$;

alter table public.manager_review_preparation enable row level security;
alter table public.manager_review_summary enable row level security;

drop trigger if exists manager_preparation_guard on public.manager_review_preparation;
create trigger manager_preparation_guard
before insert or update on public.manager_review_preparation
for each row execute function public.guard_annual_review_child_update();

drop trigger if exists manager_summary_guard on public.manager_review_summary;
create trigger manager_summary_guard
before insert or update on public.manager_review_summary
for each row execute function public.guard_annual_review_child_update();

create or replace function public.annual_review_employee_can_prepare(p_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.annual_reviews r
    where r.id = p_review_id
      and auth.uid() is not null
      and auth.uid() = r.employee_id
      and r.status = 'employee_preparation'
      and r.employee_section_submitted_at is null
      and r.locked_at is null
  );
$$;

create or replace function public.annual_review_manager_can_prepare(p_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.annual_reviews r
    where r.id = p_review_id
      and auth.uid() is not null
      and auth.uid() = r.manager_id
      and r.status = 'employee_preparation'
      and r.manager_section_submitted_at is null
      and r.locked_at is null
  );
$$;

create or replace function public.annual_review_manager_can_evaluate(p_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select public.annual_review_manager_can_prepare(p_review_id);
$$;

create or replace function public.annual_review_manager_can_summarize(p_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.annual_reviews r
    where r.id = p_review_id
      and auth.uid() is not null
      and auth.uid() = r.manager_id
      and r.status = 'manager_preparation'
      and r.manager_summary_submitted_at is null
      and r.locked_at is null
  );
$$;

create or replace function public.annual_review_employee_can_respond(p_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.annual_reviews r
    where r.id = p_review_id
      and auth.uid() is not null
      and auth.uid() = r.employee_id
      and r.status = 'awaiting_employee_response'
      and r.manager_summary_submitted_at is not null
      and r.employee_signed_at is null
      and r.locked_at is null
  );
$$;

create or replace function public.guard_annual_review_evaluation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  r public.annual_reviews;
begin
  select * into r
  from public.annual_reviews
  where id = coalesce(new.review_id, old.review_id);

  if auth.uid() is null or auth.uid() <> r.manager_id then
    raise exception 'manager_evaluation_manager_only';
  end if;
  if r.status <> 'employee_preparation'
     or r.manager_section_submitted_at is not null
     or r.locked_at is not null then
    raise exception 'manager_evaluation_wrong_stage';
  end if;
  if (new.review_id, new.metric_key, new.metric_label, new.metric_group, new.sort_order)
     is distinct from
     (old.review_id, old.metric_key, old.metric_label, old.metric_group, old.sort_order) then
    raise exception 'annual_review_metric_definition_immutable';
  end if;

  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end
$$;

-- The shared conversation is deliberately read-only and stores no content.
drop policy if exists conversation_participant_insert on public.review_conversation_summary;
drop policy if exists conversation_participant_update on public.review_conversation_summary;
drop policy if exists goals_participant_insert on public.review_goals;
drop policy if exists goals_participant_update on public.review_goals;
drop policy if exists goals_participant_delete on public.review_goals;
drop policy if exists goals_participant_write on public.review_goals;

-- Replace overlapping policies with one clear rule per operation.
drop policy if exists preparation_employee_insert on public.employee_review_preparation;
drop policy if exists preparation_employee_update on public.employee_review_preparation;
drop policy if exists preparation_select on public.employee_review_preparation;

create policy employee_preparation_select
on public.employee_review_preparation
for select to authenticated
using (
  public.annual_review_is_employee(review_id)
  or (
    public.annual_review_is_manager(review_id)
    and exists (
      select 1 from public.annual_reviews r
      where r.id = review_id and r.answers_revealed_at is not null
    )
  )
);

create policy employee_preparation_insert
on public.employee_review_preparation
for insert to authenticated
with check (public.annual_review_employee_can_prepare(review_id));

create policy employee_preparation_update
on public.employee_review_preparation
for update to authenticated
using (public.annual_review_employee_can_prepare(review_id))
with check (public.annual_review_employee_can_prepare(review_id));

drop policy if exists manager_preparation_select on public.manager_review_preparation;
drop policy if exists manager_preparation_insert on public.manager_review_preparation;
drop policy if exists manager_preparation_update on public.manager_review_preparation;

create policy manager_preparation_select
on public.manager_review_preparation
for select to authenticated
using (
  public.annual_review_is_manager(review_id)
  or (
    public.annual_review_is_employee(review_id)
    and exists (
      select 1 from public.annual_reviews r
      where r.id = review_id and r.answers_revealed_at is not null
    )
  )
);

create policy manager_preparation_insert
on public.manager_review_preparation
for insert to authenticated
with check (public.annual_review_manager_can_prepare(review_id));

create policy manager_preparation_update
on public.manager_review_preparation
for update to authenticated
using (public.annual_review_manager_can_prepare(review_id))
with check (public.annual_review_manager_can_prepare(review_id));

drop policy if exists evaluations_participant_select on public.manager_review_evaluations;
drop policy if exists evaluations_manager_update on public.manager_review_evaluations;

create policy evaluations_participant_select
on public.manager_review_evaluations
for select to authenticated
using (
  public.annual_review_is_manager(review_id)
  or (
    public.annual_review_is_employee(review_id)
    and exists (
      select 1 from public.annual_reviews r
      where r.id = review_id and r.answers_revealed_at is not null
    )
  )
);

create policy evaluations_manager_update
on public.manager_review_evaluations
for update to authenticated
using (public.annual_review_manager_can_evaluate(review_id))
with check (public.annual_review_manager_can_evaluate(review_id));

drop policy if exists manager_summary_select on public.manager_review_summary;
drop policy if exists manager_summary_insert on public.manager_review_summary;
drop policy if exists manager_summary_update on public.manager_review_summary;

create policy manager_summary_select
on public.manager_review_summary
for select to authenticated
using (
  public.annual_review_is_manager(review_id)
  or (
    public.annual_review_is_employee(review_id)
    and exists (
      select 1 from public.annual_reviews r
      where r.id = review_id and r.manager_summary_submitted_at is not null
    )
  )
);

create policy manager_summary_insert
on public.manager_review_summary
for insert to authenticated
with check (public.annual_review_manager_can_summarize(review_id));

create policy manager_summary_update
on public.manager_review_summary
for update to authenticated
using (public.annual_review_manager_can_summarize(review_id))
with check (public.annual_review_manager_can_summarize(review_id));

drop policy if exists response_employee_insert on public.employee_review_response;
drop policy if exists response_employee_update on public.employee_review_response;
drop policy if exists response_employee_write on public.employee_review_response;
drop policy if exists response_participant_select on public.employee_review_response;

create policy response_participant_select
on public.employee_review_response
for select to authenticated
using (
  public.annual_review_is_employee(review_id)
  or (
    public.annual_review_is_manager(review_id)
    and exists (
      select 1 from public.annual_reviews r
      where r.id = review_id and r.employee_signed_at is not null
    )
  )
);

create policy response_employee_insert
on public.employee_review_response
for insert to authenticated
with check (public.annual_review_employee_can_respond(review_id));

create policy response_employee_update
on public.employee_review_response
for update to authenticated
using (public.annual_review_employee_can_respond(review_id))
with check (public.annual_review_employee_can_respond(review_id));

drop policy if exists audit_participant_select on public.review_audit_log;
create policy audit_participant_select
on public.review_audit_log
for select to authenticated
using (public.annual_review_can_read(review_id));

-- Role-specific metrics only; the parallel written questions cover the common dimensions.
create or replace function public.annual_review_metric_definitions(
  p_employee_key public.annual_review_employee_key
)
returns table(metric_label text, metric_group text, sort_order integer)
language sql
immutable
set search_path = pg_catalog
as $$
  select label, 'role'::text, 100 + ord::integer
  from unnest(
    case p_employee_key
      when 'tony_naim' then array[
        'ניהול הנהלת החשבונות עד מאזן',
        'דיווחים לרשויות ועמידה במועדים',
        'התאמות, בקרות וסגירת נתונים',
        'דיוק ואחריות בתהליכי שכר',
        'הפקת מידע ודוחות להנהלה',
        'עבודה מול תקציבים ובקרות פנימיות'
      ]
      when 'hila_rozen' then array[
        'אחריות מקצועית ארצית על מערך ההדרכה',
        'איכות ההכשרה והליווי של מדריכים',
        'אחידות מקצועית ופדגוגית בין התוכניות והאזורים',
        'מעקב אחר איכות ההדרכה ומתן משוב מקצועי',
        'פיתוח ושיפור כלי הדרכה ותכנים',
        'שיתוף פעולה עם מנהלי הפעילות, הצוותים והשטח'
      ]
      when 'gil_neeman' then array[
        'אחריות מקצה לקצה על ביצוע הפעילויות',
        'גיוס, שיבוץ, הכשרה וליווי של כוח אדם',
        'תכנון לוחות זמנים ותיאום מול בתי ספר',
        'ניהול תקציבים, אישורים ובקרת דיווחים',
        'מעקב מקצועי ופדגוגי אחר הפעילות',
        'ציוד, לוגיסטיקה ומוכנות לביצוע',
        'ניהול צוות, פתרון בעיות ודיווח שוטף'
      ]
      when 'eden_cohen' then array[
        'תכנון ותיאום הפעילויות',
        'ניהול טבלאות, סטטוסים ומעקב אחר משימות',
        'סנכרון מידע בין המטה, בתי הספר והמדריכים',
        'תיאום ציוד, מלאי ולוגיסטיקה',
        'טיפול בדוחות, מסמכים ודיווחי נוכחות',
        'תמיכה בקליטה ובהכשרת מדריכים',
        'תמיכה בהצעות מחיר, חיובים ואירועי סיום',
        'דיוק, בקרה ומעקב עד לסגירת משימות'
      ]
    end
  ) with ordinality as metric(label, ord);
$$;

-- Reset only truly empty, unfinished reviews to the new workflow.
with empty_reviews as (
  select r.id, r.status as old_status, r.manager_id
  from public.annual_reviews r
  where r.status <> 'completed_locked'
    and not exists (
      select 1 from public.manager_review_evaluations e
      where e.review_id = r.id
        and (e.rating is not null or e.not_applicable or btrim(e.comment) <> '')
    )
    and not exists (
      select 1 from public.employee_review_preparation p
      where p.review_id = r.id
        and (p.answers <> '{}'::jsonb or btrim(p.notes) <> '')
    )
    and not exists (
      select 1 from public.review_conversation_summary c
      where c.review_id = r.id
        and (
          btrim(c.achievements) <> '' or btrim(c.strengths) <> ''
          or btrim(c.improvements) <> '' or btrim(c.process_changes) <> ''
          or btrim(c.support_needed) <> '' or btrim(c.manager_summary) <> ''
          or c.employee_voice <> '{}'::jsonb
        )
    )
    and not exists (
      select 1 from public.review_goals g
      where g.review_id = r.id
        and (
          btrim(g.goal) <> '' or btrim(g.agreed_actions) <> ''
          or btrim(g.owner) <> '' or g.target_date is not null
        )
    )
    and not exists (
      select 1 from public.employee_review_response er
      where er.review_id = r.id
        and (
          btrim(er.response_to_summary) <> '' or btrim(er.agreed_points) <> ''
          or btrim(er.clarification_points) <> '' or btrim(er.final_comment) <> ''
          or er.summary_alignment <> '' or btrim(er.alignment_explanation) <> ''
          or btrim(er.signature_name) <> '' or er.acceptance_confirmed
        )
    )
), reset_reviews as (
  update public.annual_reviews r
  set status = 'not_opened',
      manager_shared_at = null,
      conversation_date = null,
      employee_approved_at = null,
      manager_approved_at = null,
      submitted_at = null,
      completed_at = null,
      locked_at = null,
      reopened_at = null,
      reopened_by = null,
      reopen_reason = null,
      employee_section_submitted_at = null,
      manager_section_submitted_at = null,
      answers_revealed_at = null,
      conversation_started_at = null,
      conversation_completed_at = null,
      manager_summary_submitted_at = null,
      employee_signed_at = null,
      version = r.version + 1,
      updated_at = now()
  from empty_reviews e
  where r.id = e.id
  returning r.id, e.old_status, e.manager_id
)
insert into public.review_audit_log(review_id, actor_id, action, from_status, to_status, details)
select id, manager_id, 'migrated_to_simplified_workflow', old_status, 'not_opened',
       jsonb_build_object('migration', 'simplify_annual_review_workflow')
from reset_reviews;

-- Empty legacy common metrics can be replaced with role-specific metrics safely.
delete from public.manager_review_evaluations e
using public.annual_reviews r
where e.review_id = r.id
  and e.metric_group = 'common'
  and r.status <> 'completed_locked'
  and not exists (
    select 1 from public.manager_review_evaluations x
    where x.review_id = r.id
      and (x.rating is not null or x.not_applicable or btrim(x.comment) <> '')
  );

insert into public.manager_review_evaluations(
  review_id, metric_key, metric_label, metric_group, sort_order
)
select
  r.id,
  md5('role_metric_v2|' || d.sort_order::text || '|' || d.metric_label),
  d.metric_label,
  d.metric_group,
  d.sort_order
from public.annual_reviews r
join public.annual_review_assignments a
  on a.employee_id = r.employee_id and a.manager_id = r.manager_id
cross join lateral public.annual_review_metric_definitions(a.employee_key) d
on conflict (review_id, metric_key) do nothing;

create or replace function public.open_review_for_employee(
  p_review_id uuid,
  p_expected_version bigint
)
returns public.annual_reviews
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  r public.annual_reviews;
  old_status public.annual_review_status;
begin
  select * into r
  from public.annual_reviews
  where id = p_review_id
  for update;

  if r.id is null or auth.uid() is null or auth.uid() <> r.manager_id then
    raise exception 'annual_review_manager_forbidden';
  end if;
  if r.status <> 'not_opened' then
    raise exception 'annual_review_invalid_state';
  end if;
  if r.version <> p_expected_version then
    raise exception 'annual_review_version_conflict';
  end if;

  old_status := r.status;
  update public.annual_reviews
  set status = 'employee_preparation',
      version = version + 1,
      updated_at = now()
  where id = p_review_id
  returning * into r;

  insert into public.review_audit_log(review_id, actor_id, action, from_status, to_status)
  values (r.id, auth.uid(), 'parallel_preparation_opened', old_status, r.status);

  return r;
end
$$;

create or replace function public.submit_employee_section(
  p_review_id uuid,
  p_expected_version bigint
)
returns public.annual_reviews
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  r public.annual_reviews;
  old_status public.annual_review_status;
  reveal_now boolean;
begin
  select * into r
  from public.annual_reviews
  where id = p_review_id
  for update;

  if r.id is null or auth.uid() is null or auth.uid() <> r.employee_id then
    raise exception 'annual_review_employee_forbidden';
  end if;
  if r.status <> 'employee_preparation' or r.employee_section_submitted_at is not null then
    raise exception 'annual_review_invalid_state';
  end if;
  if r.version <> p_expected_version then
    raise exception 'annual_review_version_conflict';
  end if;
  if not exists (
    select 1
    from public.employee_review_preparation p,
         lateral jsonb_each_text(p.answers) answer
    where p.review_id = p_review_id
      and btrim(answer.value) <> ''
  ) then
    raise exception 'annual_review_employee_section_empty';
  end if;

  old_status := r.status;
  reveal_now := r.manager_section_submitted_at is not null;

  update public.annual_reviews
  set employee_section_submitted_at = now(),
      status = case when reveal_now then 'ready_for_conversation' else status end,
      answers_revealed_at = case when reveal_now then now() else answers_revealed_at end,
      manager_shared_at = case when reveal_now then now() else manager_shared_at end,
      version = version + 1,
      updated_at = now()
  where id = p_review_id
  returning * into r;

  insert into public.review_audit_log(review_id, actor_id, action, from_status, to_status, details)
  values (
    r.id, auth.uid(), 'employee_section_submitted', old_status, r.status,
    jsonb_build_object('answers_revealed', reveal_now)
  );

  return r;
end
$$;

create or replace function public.submit_manager_section(
  p_review_id uuid,
  p_expected_version bigint
)
returns public.annual_reviews
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  r public.annual_reviews;
  old_status public.annual_review_status;
  reveal_now boolean;
begin
  select * into r
  from public.annual_reviews
  where id = p_review_id
  for update;

  if r.id is null or auth.uid() is null or auth.uid() <> r.manager_id then
    raise exception 'annual_review_manager_forbidden';
  end if;
  if r.status <> 'employee_preparation' or r.manager_section_submitted_at is not null then
    raise exception 'annual_review_invalid_state';
  end if;
  if r.version <> p_expected_version then
    raise exception 'annual_review_version_conflict';
  end if;
  if not exists (
    select 1
    from public.manager_review_preparation p,
         lateral jsonb_each(p.answers) answer
    where p.review_id = p_review_id
      and (
        case
          when jsonb_typeof(answer.value) = 'object'
            then btrim(coalesce(answer.value ->> 'text', ''))
          else btrim(trim(both '"' from answer.value::text))
        end
      ) <> ''
  ) then
    raise exception 'annual_review_manager_section_empty';
  end if;

  old_status := r.status;
  reveal_now := r.employee_section_submitted_at is not null;

  update public.annual_reviews
  set manager_section_submitted_at = now(),
      status = case when reveal_now then 'ready_for_conversation' else status end,
      answers_revealed_at = case when reveal_now then now() else answers_revealed_at end,
      manager_shared_at = case when reveal_now then now() else manager_shared_at end,
      version = version + 1,
      updated_at = now()
  where id = p_review_id
  returning * into r;

  insert into public.review_audit_log(review_id, actor_id, action, from_status, to_status, details)
  values (
    r.id, auth.uid(), 'manager_section_submitted', old_status, r.status,
    jsonb_build_object('answers_revealed', reveal_now)
  );

  return r;
end
$$;

create or replace function public.start_review_conversation(
  p_review_id uuid,
  p_expected_version bigint
)
returns public.annual_reviews
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  r public.annual_reviews;
begin
  update public.annual_reviews
  set status = 'conversation_in_progress',
      conversation_started_at = now(),
      conversation_date = coalesce(conversation_date, current_date),
      version = version + 1,
      updated_at = now()
  where id = p_review_id
    and auth.uid() is not null
    and manager_id = auth.uid()
    and status = 'ready_for_conversation'
    and answers_revealed_at is not null
    and version = p_expected_version
  returning * into r;

  if r.id is null then
    raise exception 'annual_review_start_conversation_forbidden_or_conflict';
  end if;

  insert into public.review_audit_log(review_id, actor_id, action, from_status, to_status)
  values (r.id, auth.uid(), 'conversation_started', 'ready_for_conversation', r.status);

  return r;
end
$$;

create or replace function public.finish_review_conversation(
  p_review_id uuid,
  p_expected_version bigint
)
returns public.annual_reviews
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  r public.annual_reviews;
begin
  update public.annual_reviews
  set status = 'manager_preparation',
      conversation_completed_at = now(),
      version = version + 1,
      updated_at = now()
  where id = p_review_id
    and auth.uid() is not null
    and manager_id = auth.uid()
    and status = 'conversation_in_progress'
    and version = p_expected_version
  returning * into r;

  if r.id is null then
    raise exception 'annual_review_finish_conversation_forbidden_or_conflict';
  end if;

  insert into public.review_audit_log(review_id, actor_id, action, from_status, to_status)
  values (r.id, auth.uid(), 'conversation_completed', 'conversation_in_progress', r.status);

  return r;
end
$$;

create or replace function public.submit_manager_summary(
  p_review_id uuid,
  p_expected_version bigint
)
returns public.annual_reviews
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  r public.annual_reviews;
begin
  select * into r
  from public.annual_reviews
  where id = p_review_id
  for update;

  if r.id is null or auth.uid() is null or auth.uid() <> r.manager_id then
    raise exception 'annual_review_manager_forbidden';
  end if;
  if r.status <> 'manager_preparation' or r.manager_summary_submitted_at is not null then
    raise exception 'annual_review_invalid_state';
  end if;
  if r.version <> p_expected_version then
    raise exception 'annual_review_version_conflict';
  end if;
  if not exists (
    select 1 from public.manager_review_summary s
    where s.review_id = p_review_id
      and (
        btrim(s.overall_assessment) <> ''
        or btrim(s.management_conclusion) <> ''
        or btrim(s.expectations) <> ''
        or btrim(s.additional_notes) <> ''
      )
  ) then
    raise exception 'annual_review_manager_summary_empty';
  end if;

  update public.annual_reviews
  set status = 'awaiting_employee_response',
      manager_summary_submitted_at = now(),
      manager_approved_at = now(),
      version = version + 1,
      updated_at = now()
  where id = p_review_id
  returning * into r;

  insert into public.review_audit_log(review_id, actor_id, action, from_status, to_status)
  values (r.id, auth.uid(), 'manager_summary_submitted', 'manager_preparation', r.status);

  return r;
end
$$;

create or replace function public.complete_review_as_employee(
  p_review_id uuid,
  p_expected_version bigint
)
returns public.annual_reviews
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  r public.annual_reviews;
begin
  select * into r
  from public.annual_reviews
  where id = p_review_id
  for update;

  if r.id is null or auth.uid() is null or auth.uid() <> r.employee_id then
    raise exception 'annual_review_employee_forbidden';
  end if;
  if r.status <> 'awaiting_employee_response' or r.employee_signed_at is not null then
    raise exception 'annual_review_invalid_state';
  end if;
  if r.version <> p_expected_version then
    raise exception 'annual_review_version_conflict';
  end if;
  if not exists (
    select 1
    from public.employee_review_response response
    where response.review_id = p_review_id
      and btrim(response.signature_name) <> ''
      and response.acceptance_confirmed = true
      and response.summary_alignment in ('yes', 'partial', 'no')
  ) then
    raise exception 'annual_review_employee_signature_required';
  end if;

  update public.annual_reviews
  set status = 'completed_locked',
      employee_approved_at = now(),
      employee_signed_at = now(),
      completed_at = now(),
      locked_at = now(),
      version = version + 1,
      updated_at = now()
  where id = p_review_id
  returning * into r;

  insert into public.review_audit_log(review_id, actor_id, action, from_status, to_status)
  values (r.id, auth.uid(), 'employee_signed_and_completed', 'awaiting_employee_response', r.status);

  return r;
end
$$;

-- Direct table access is intentionally narrow; state changes go through audited RPCs.
revoke all on table public.manager_review_preparation from anon;
revoke all on table public.manager_review_summary from anon;
revoke all on table public.employee_review_preparation from anon;
revoke all on table public.manager_review_evaluations from anon;
revoke all on table public.employee_review_response from anon;
revoke all on table public.review_conversation_summary from anon;
revoke all on table public.review_goals from anon;
revoke all on table public.annual_reviews from anon;
revoke all on table public.review_audit_log from anon;

revoke insert, update, delete on table public.annual_reviews from authenticated;
revoke insert, update, delete on table public.review_conversation_summary from authenticated;
revoke insert, update, delete on table public.review_goals from authenticated;
revoke delete on table public.employee_review_preparation from authenticated;
revoke delete on table public.manager_review_preparation from authenticated;
revoke insert, delete on table public.manager_review_evaluations from authenticated;
revoke delete on table public.manager_review_summary from authenticated;
revoke delete on table public.employee_review_response from authenticated;
revoke insert, update, delete on table public.review_audit_log from authenticated;

grant select on table public.annual_reviews to authenticated;
grant select, insert, update on table public.employee_review_preparation to authenticated;
grant select, insert, update on table public.manager_review_preparation to authenticated;
grant select, update on table public.manager_review_evaluations to authenticated;
grant select on table public.review_conversation_summary to authenticated;
grant select on table public.review_goals to authenticated;
grant select, insert, update on table public.manager_review_summary to authenticated;
grant select, insert, update on table public.employee_review_response to authenticated;
grant select on table public.review_audit_log to authenticated;

revoke execute on function public.open_review_for_employee(uuid, bigint) from public, anon;
revoke execute on function public.submit_employee_section(uuid, bigint) from public, anon;
revoke execute on function public.submit_manager_section(uuid, bigint) from public, anon;
revoke execute on function public.start_review_conversation(uuid, bigint) from public, anon;
revoke execute on function public.finish_review_conversation(uuid, bigint) from public, anon;
revoke execute on function public.submit_manager_summary(uuid, bigint) from public, anon;
revoke execute on function public.complete_review_as_employee(uuid, bigint) from public, anon;

grant execute on function public.open_review_for_employee(uuid, bigint) to authenticated;
grant execute on function public.submit_employee_section(uuid, bigint) to authenticated;
grant execute on function public.submit_manager_section(uuid, bigint) to authenticated;
grant execute on function public.start_review_conversation(uuid, bigint) to authenticated;
grant execute on function public.finish_review_conversation(uuid, bigint) to authenticated;
grant execute on function public.submit_manager_summary(uuid, bigint) to authenticated;
grant execute on function public.complete_review_as_employee(uuid, bigint) to authenticated;

-- Disable obsolete workflow operations that could bypass the simplified process.
revoke execute on function public.submit_employee_preparation(uuid, bigint) from authenticated, anon, public;
revoke execute on function public.share_manager_evaluation(uuid, bigint) from authenticated, anon, public;
revoke execute on function public.approve_review_as_employee(uuid, bigint) from authenticated, anon, public;
revoke execute on function public.approve_review_as_manager(uuid, bigint) from authenticated, anon, public;
revoke execute on function public.complete_and_lock_review(uuid, bigint) from authenticated, anon, public;
revoke execute on function public.reopen_annual_review(uuid, bigint, text) from authenticated, anon, public;
revoke execute on function public.transition_annual_review(uuid, bigint, text, public.annual_review_status, public.annual_review_status) from authenticated, anon, public;

revoke execute on function public.annual_review_employee_can_prepare(uuid) from public, anon;
revoke execute on function public.annual_review_manager_can_prepare(uuid) from public, anon;
revoke execute on function public.annual_review_manager_can_evaluate(uuid) from public, anon;
revoke execute on function public.annual_review_manager_can_summarize(uuid) from public, anon;
revoke execute on function public.annual_review_employee_can_respond(uuid) from public, anon;

grant execute on function public.annual_review_employee_can_prepare(uuid) to authenticated;
grant execute on function public.annual_review_manager_can_prepare(uuid) to authenticated;
grant execute on function public.annual_review_manager_can_evaluate(uuid) to authenticated;
grant execute on function public.annual_review_manager_can_summarize(uuid) to authenticated;
grant execute on function public.annual_review_employee_can_respond(uuid) to authenticated;

notify pgrst, 'reload schema';

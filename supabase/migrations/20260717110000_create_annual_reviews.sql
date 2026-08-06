-- Annual reviews inside Personal Reports. DO NOT apply to production until the
-- assignment Auth UUIDs have been independently verified.
create extension if not exists pgcrypto;

create type public.annual_review_employee_key as enum ('tony_naim','hila_rozen','gil_neeman','eden_cohen');
create type public.annual_review_status as enum (
  'not_opened','employee_preparation','submitted_to_manager','manager_preparation',
  'ready_for_conversation','conversation_in_progress','awaiting_employee_response','completed_locked'
);

create table public.annual_review_assignments (
  employee_key public.annual_review_employee_key primary key,
  employee_id uuid not null unique references auth.users(id),
  manager_id uuid not null references auth.users(id),
  employee_name text not null, employee_role text not null,
  created_at timestamptz not null default now(),
  unique (employee_id, manager_id),
  check (employee_id <> manager_id)
);

create table public.annual_reviews (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references auth.users(id), manager_id uuid not null references auth.users(id),
  review_year integer not null check (review_year between 2020 and 2100),
  status public.annual_review_status not null default 'not_opened',
  manager_shared_at timestamptz, conversation_date date,
  employee_approved_at timestamptz, manager_approved_at timestamptz,
  submitted_at timestamptz, completed_at timestamptz, locked_at timestamptz,
  reopened_at timestamptz, reopened_by uuid references auth.users(id), reopen_reason text,
  version bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (employee_id, review_year),
  foreign key (employee_id, manager_id) references public.annual_review_assignments(employee_id, manager_id),
  check (employee_id <> manager_id), check ((status = 'completed_locked') = (locked_at is not null))
);
create table public.employee_review_preparation (
  review_id uuid primary key references public.annual_reviews(id) on delete cascade,
  notes text not null default '', include_in_pdf boolean not null default false, version bigint not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.manager_review_evaluations (
  id uuid primary key default gen_random_uuid(), review_id uuid not null references public.annual_reviews(id) on delete cascade,
  metric_key text not null, metric_label text not null, metric_group text not null check (metric_group in ('common','role')),
  rating smallint check (rating between 1 and 5), not_applicable boolean not null default false, comment text not null default '',
  sort_order integer not null default 0, version bigint not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(review_id, metric_key), check (not (not_applicable and rating is not null))
);
create table public.review_conversation_summary (
  review_id uuid primary key references public.annual_reviews(id) on delete cascade,
  achievements text not null default '', strengths text not null default '', improvements text not null default '',
  process_changes text not null default '', support_needed text not null default '',
  manager_summary text not null default '', employee_voice jsonb not null default '{}'::jsonb,
  version bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.review_goals (
  id uuid primary key default gen_random_uuid(), review_id uuid not null references public.annual_reviews(id) on delete cascade,
  goal text not null default '', agreed_actions text not null default '', owner text not null default '', target_date date,
  sort_order integer not null default 0, version bigint not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.employee_review_response (
  review_id uuid primary key references public.annual_reviews(id) on delete cascade,
  response_to_summary text not null default '', agreed_points text not null default '', clarification_points text not null default '',
  final_comment text not null default '', version bigint not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.review_audit_log (
  id bigint generated always as identity primary key, review_id uuid not null references public.annual_reviews(id) on delete restrict,
  actor_id uuid not null, action text not null, from_status public.annual_review_status, to_status public.annual_review_status,
  details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

-- Operator-only provisioning. It is not executable through anon/authenticated Data API roles.
create or replace function public.provision_annual_review_assignments(
  p_manager_id uuid, p_tony_id uuid, p_hila_id uuid, p_gil_id uuid, p_eden_id uuid
) returns void language plpgsql security definer set search_path = pg_catalog as $$
declare ids uuid[] := array[p_manager_id,p_tony_id,p_hila_id,p_gil_id,p_eden_id];
begin
  if array_position(ids, null) is not null or (select count(distinct x) from unnest(ids) x) <> 5 then
    raise exception 'annual_review_assignment_ids_must_be_five_distinct_auth_uuids';
  end if;
  if (select count(*) from auth.users where id = any(ids)) <> 5 then raise exception 'annual_review_assignment_auth_uuid_not_found'; end if;
  insert into public.annual_review_assignments(employee_key,employee_id,manager_id,employee_name,employee_role) values
    ('tony_naim',p_tony_id,p_manager_id,'טוני נעים','הנהלת חשבונות וחשבות שכר'),
    ('hila_rozen',p_hila_id,p_manager_id,'הילה רוזן','אחראית הדרכה ארצית בכל תוכניות תעשיידע'),
    ('gil_neeman',p_gil_id,p_manager_id,'גיל נאמן','מנהל פעילויות ארצי'),
    ('eden_cohen',p_eden_id,p_manager_id,'עדן כהן','מתאמת פעילויות ואדמיניסטרציה ארצית')
  on conflict (employee_key) do update set employee_id=excluded.employee_id,manager_id=excluded.manager_id;
  insert into public.annual_reviews(employee_id,manager_id,review_year)
  select employee_id,manager_id,extract(year from current_date)::integer from public.annual_review_assignments
  on conflict (employee_id,review_year) do nothing;

  insert into public.manager_review_evaluations(review_id,metric_key,metric_label,metric_group,sort_order)
  select r.id, md5(metric.label), metric.label, metric.metric_group, metric.ord
  from public.annual_reviews r
  join public.annual_review_assignments a on a.employee_id=r.employee_id and a.manager_id=r.manager_id
  cross join lateral (
    select label,'common'::text metric_group,ord::integer
    from unnest(array[
      'אחריות ובעלות על המשימות','תכנון, סדרי עדיפויות ועמידה בלוחות זמנים','דיוק, איכות ובקרה עצמית',
      'תיעוד, עדכון והעברת מידע','תקשורת מקצועית ושירותיות','שיתוף פעולה, שקיפות ועבודה מול ממשקים',
      'יוזמה, פתרון בעיות ושיפור תהליכים','למידה, גמישות וקבלת משוב',
      'תרומה לרציפות הפעילות החינוכית ולמטרה המשותפת של תעשיידע'
    ]) with ordinality c(label,ord)
    union all
    select label,'role',100+ord::integer from unnest(case a.employee_key
      when 'tony_naim' then array['ניהול הנהלת החשבונות עד מאזן','דיווחים לרשויות ועמידה במועדים','התאמות, בקרות וסגירת נתונים','דיוק ואחריות בתהליכי שכר','הפקת מידע ודוחות להנהלה','עבודה מול תקציבים ובקרות פנימיות']
      when 'hila_rozen' then array['אחריות מקצועית ארצית על מערך ההדרכה','איכות ההכשרה והליווי של מדריכים','אחידות מקצועית ופדגוגית בין התוכניות והאזורים','מעקב אחר איכות ההדרכה ומתן משוב מקצועי','פיתוח ושיפור כלי הדרכה ותכנים','שיתוף פעולה עם מנהלי הפעילות, הצוותים והשטח']
      when 'gil_neeman' then array['אחריות מקצה לקצה על ביצוע הפעילויות','גיוס, שיבוץ, הכשרה וליווי של כוח אדם','תכנון לוחות זמנים ותיאום מול בתי ספר','ניהול תקציבים, אישורים ובקרת דיווחים','מעקב מקצועי ופדגוגי אחר הפעילות','ציוד, לוגיסטיקה ומוכנות לביצוע','ניהול צוות, פתרון בעיות ודיווח שוטף']
      when 'eden_cohen' then array['תכנון ותיאום הפעילויות','ניהול טבלאות, סטטוסים ומעקב אחר משימות','סנכרון מידע בין המטה, בתי הספר והמדריכים','תיאום ציוד, מלאי ולוגיסטיקה','טיפול בדוחות, מסמכים ודיווחי נוכחות','תמיכה בקליטה ובהכשרת מדריכים','תמיכה בהצעות מחיר, חיובים ואירועי סיום','דיוק, בקרה ומעקב עד לסגירת משימות']
    end) with ordinality x(label,ord)
  ) metric
  on conflict(review_id,metric_key) do nothing;
end $$;
revoke all on function public.provision_annual_review_assignments(uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;

create or replace function public.annual_review_can_read(p_review_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.annual_reviews r where r.id=p_review_id and auth.uid() in (r.employee_id,r.manager_id));
$$;
create or replace function public.annual_review_is_employee(p_review_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.annual_reviews r where r.id=p_review_id and auth.uid()=r.employee_id);
$$;
create or replace function public.annual_review_is_manager(p_review_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.annual_reviews r where r.id=p_review_id and auth.uid()=r.manager_id);
$$;
create or replace function public.annual_review_is_editable(p_review_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.annual_reviews r where r.id=p_review_id and r.locked_at is null);
$$;
revoke all on function public.annual_review_can_read(uuid), public.annual_review_is_employee(uuid), public.annual_review_is_manager(uuid), public.annual_review_is_editable(uuid) from public,anon;
grant execute on function public.annual_review_can_read(uuid), public.annual_review_is_employee(uuid), public.annual_review_is_manager(uuid), public.annual_review_is_editable(uuid) to authenticated;

alter table public.annual_review_assignments enable row level security; alter table public.annual_reviews enable row level security;
alter table public.employee_review_preparation enable row level security; alter table public.manager_review_evaluations enable row level security;
alter table public.review_conversation_summary enable row level security; alter table public.review_goals enable row level security;
alter table public.employee_review_response enable row level security; alter table public.review_audit_log enable row level security;
create policy assignments_participant_select on public.annual_review_assignments for select to authenticated using (auth.uid() in (employee_id,manager_id));
create policy reviews_participant_select on public.annual_reviews for select to authenticated using (auth.uid() in (employee_id,manager_id));
create policy preparation_employee_select on public.employee_review_preparation for select to authenticated using (public.annual_review_is_employee(review_id));
create policy preparation_employee_insert on public.employee_review_preparation for insert to authenticated with check (public.annual_review_is_employee(review_id) and public.annual_review_is_editable(review_id));
create policy preparation_employee_update on public.employee_review_preparation for update to authenticated using (public.annual_review_is_employee(review_id) and public.annual_review_is_editable(review_id));
create policy evaluations_participant_select on public.manager_review_evaluations for select to authenticated using (public.annual_review_is_manager(review_id) or (public.annual_review_is_employee(review_id) and exists(select 1 from public.annual_reviews r where r.id=review_id and r.manager_shared_at is not null)));
create policy evaluations_manager_update on public.manager_review_evaluations for update to authenticated using (public.annual_review_is_manager(review_id) and public.annual_review_is_editable(review_id));
create policy conversation_participant_select on public.review_conversation_summary for select to authenticated using (public.annual_review_can_read(review_id));
create policy conversation_participant_insert on public.review_conversation_summary for insert to authenticated with check (public.annual_review_can_read(review_id) and public.annual_review_is_editable(review_id));
create policy conversation_participant_update on public.review_conversation_summary for update to authenticated using (public.annual_review_can_read(review_id) and public.annual_review_is_editable(review_id));
create policy goals_participant_select on public.review_goals for select to authenticated using (public.annual_review_can_read(review_id));
create policy goals_participant_write on public.review_goals for all to authenticated using (public.annual_review_can_read(review_id) and public.annual_review_is_editable(review_id)) with check (public.annual_review_can_read(review_id) and public.annual_review_is_editable(review_id));
create policy response_participant_select on public.employee_review_response for select to authenticated using (public.annual_review_can_read(review_id));
create policy response_employee_write on public.employee_review_response for all to authenticated using (public.annual_review_is_employee(review_id) and public.annual_review_is_editable(review_id)) with check (public.annual_review_is_employee(review_id) and public.annual_review_is_editable(review_id));
create policy audit_participant_select on public.review_audit_log for select to authenticated using (public.annual_review_can_read(review_id));

create or replace function public.guard_annual_review_child_update() returns trigger language plpgsql set search_path=pg_catalog as $$
declare rid uuid := coalesce(new.review_id,old.review_id);
begin
  if not public.annual_review_is_editable(rid) then raise exception 'annual_review_locked'; end if;
  if tg_op='UPDATE' then new.updated_at=now(); new.version=old.version+1; end if; return new;
end $$;
create trigger preparation_guard before insert or update on public.employee_review_preparation for each row execute function public.guard_annual_review_child_update();
create trigger goals_guard before insert or update on public.review_goals for each row execute function public.guard_annual_review_child_update();
create trigger response_guard before insert or update on public.employee_review_response for each row execute function public.guard_annual_review_child_update();

create or replace function public.guard_annual_review_evaluation() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if not public.annual_review_is_editable(coalesce(new.review_id,old.review_id)) then raise exception 'annual_review_locked'; end if;
  if tg_op='UPDATE' then
    if (new.review_id,new.metric_key,new.metric_label,new.metric_group,new.sort_order) is distinct from (old.review_id,old.metric_key,old.metric_label,old.metric_group,old.sort_order) then raise exception 'annual_review_metric_definition_immutable'; end if;
    new.updated_at=now(); new.version=old.version+1;
  end if; return new;
end $$;
create trigger evaluations_guard before update on public.manager_review_evaluations for each row execute function public.guard_annual_review_evaluation();

create or replace function public.guard_review_conversation_summary() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if not public.annual_review_is_editable(coalesce(new.review_id,old.review_id)) then raise exception 'annual_review_locked'; end if;
  if tg_op='INSERT' then
    if public.annual_review_is_employee(new.review_id) and new.manager_summary <> '' then raise exception 'manager_summary_manager_only'; end if;
    if public.annual_review_is_manager(new.review_id) and new.employee_voice <> '{}'::jsonb then raise exception 'employee_voice_employee_only'; end if;
  else
    if new.review_id <> old.review_id then raise exception 'review_id_immutable'; end if;
    if new.manager_summary is distinct from old.manager_summary and not public.annual_review_is_manager(new.review_id) then raise exception 'manager_summary_manager_only'; end if;
    if new.employee_voice is distinct from old.employee_voice and not public.annual_review_is_employee(new.review_id) then raise exception 'employee_voice_employee_only'; end if;
    new.updated_at=now(); new.version=old.version+1;
  end if; return new;
end $$;
create trigger conversation_guard before insert or update on public.review_conversation_summary for each row execute function public.guard_review_conversation_summary();

-- The only lifecycle writer. Each wrapper passes its fixed actor, source state and
-- destination state, so callers cannot supply arbitrary columns or timestamps.
create or replace function public.transition_annual_review(
  p_review_id uuid,p_expected_version bigint,p_actor text,p_from public.annual_review_status,p_to public.annual_review_status
) returns public.annual_reviews language plpgsql security definer set search_path=pg_catalog as $$
declare r public.annual_reviews;
begin
  select * into r from public.annual_reviews where id=p_review_id for update;
  if r.id is null or auth.uid() is null then raise exception 'annual_review_not_found_or_unauthenticated'; end if;
  if (p_actor='employee' and auth.uid()<>r.employee_id) or (p_actor='manager' and auth.uid()<>r.manager_id) then raise exception 'annual_review_actor_forbidden'; end if;
  if r.status<>p_from then raise exception 'annual_review_invalid_state'; end if;
  if r.version<>p_expected_version then raise exception 'annual_review_version_conflict'; end if;
  update public.annual_reviews set status=p_to, version=version+1, updated_at=now(),
    submitted_at=case when p_to='submitted_to_manager' then now() else submitted_at end,
    manager_shared_at=case when p_to='ready_for_conversation' then now() else manager_shared_at end
  where id=p_review_id returning * into r;
  insert into public.review_audit_log(review_id,actor_id,action,from_status,to_status) values(r.id,auth.uid(),'status_changed',p_from,p_to);
  return r;
end $$;
revoke all on function public.transition_annual_review(uuid,bigint,text,public.annual_review_status,public.annual_review_status) from public,anon,authenticated;

create or replace function public.open_review_for_employee(p_review_id uuid,p_expected_version bigint) returns public.annual_reviews language sql security definer set search_path=pg_catalog as $$ select public.transition_annual_review(p_review_id,p_expected_version,'manager','not_opened','employee_preparation') $$;
create or replace function public.submit_employee_preparation(p_review_id uuid,p_expected_version bigint) returns public.annual_reviews language sql security definer set search_path=pg_catalog as $$ select public.transition_annual_review(p_review_id,p_expected_version,'employee','employee_preparation','submitted_to_manager') $$;
create or replace function public.share_manager_evaluation(p_review_id uuid,p_expected_version bigint) returns public.annual_reviews language plpgsql security definer set search_path=pg_catalog as $$
declare r public.annual_reviews; begin
  select * into r from public.annual_reviews where id=p_review_id;
  if r.status not in ('submitted_to_manager','manager_preparation') then raise exception 'annual_review_invalid_state'; end if;
  return public.transition_annual_review(p_review_id,p_expected_version,'manager',r.status,'ready_for_conversation'); end $$;
create or replace function public.start_review_conversation(p_review_id uuid,p_expected_version bigint) returns public.annual_reviews language sql security definer set search_path=pg_catalog as $$ select public.transition_annual_review(p_review_id,p_expected_version,'manager','ready_for_conversation','conversation_in_progress') $$;

create or replace function public.approve_review_as_employee(p_review_id uuid,p_expected_version bigint) returns public.annual_reviews language plpgsql security definer set search_path=pg_catalog as $$
declare r public.annual_reviews; begin
  update public.annual_reviews set employee_approved_at=now(),status='awaiting_employee_response',version=version+1,updated_at=now()
  where id=p_review_id and employee_id=auth.uid() and status in ('conversation_in_progress','awaiting_employee_response') and version=p_expected_version and employee_approved_at is null returning * into r;
  if r.id is null then raise exception 'annual_review_employee_approval_forbidden_or_conflict'; end if;
  insert into public.review_audit_log(review_id,actor_id,action,from_status,to_status) values(r.id,auth.uid(),'employee_approved','conversation_in_progress',r.status); return r; end $$;
create or replace function public.approve_review_as_manager(p_review_id uuid,p_expected_version bigint) returns public.annual_reviews language plpgsql security definer set search_path=pg_catalog as $$
declare r public.annual_reviews; begin
  update public.annual_reviews set manager_approved_at=now(),version=version+1,updated_at=now()
  where id=p_review_id and manager_id=auth.uid() and status in ('conversation_in_progress','awaiting_employee_response') and version=p_expected_version and manager_approved_at is null returning * into r;
  if r.id is null then raise exception 'annual_review_manager_approval_forbidden_or_conflict'; end if;
  insert into public.review_audit_log(review_id,actor_id,action,from_status,to_status) values(r.id,auth.uid(),'manager_approved',r.status,r.status); return r; end $$;
create or replace function public.complete_and_lock_review(p_review_id uuid,p_expected_version bigint) returns public.annual_reviews language plpgsql security definer set search_path=pg_catalog as $$
declare r public.annual_reviews; begin
  update public.annual_reviews set status='completed_locked',completed_at=now(),locked_at=now(),version=version+1,updated_at=now()
  where id=p_review_id and manager_id=auth.uid() and status='awaiting_employee_response' and version=p_expected_version and employee_approved_at is not null and manager_approved_at is not null returning * into r;
  if r.id is null then raise exception 'annual_review_completion_forbidden_or_conflict'; end if;
  insert into public.review_audit_log(review_id,actor_id,action,from_status,to_status) values(r.id,auth.uid(),'locked','awaiting_employee_response','completed_locked'); return r; end $$;
create or replace function public.reopen_annual_review(p_review_id uuid,p_expected_version bigint,p_reason text) returns public.annual_reviews language plpgsql security definer set search_path=pg_catalog as $$
declare r public.annual_reviews; begin
  if nullif(btrim(p_reason),'') is null then raise exception 'annual_review_reopen_reason_required'; end if;
  update public.annual_reviews set status='conversation_in_progress',locked_at=null,completed_at=null,reopened_at=now(),reopened_by=auth.uid(),reopen_reason=btrim(p_reason),version=version+1,updated_at=now()
  where id=p_review_id and manager_id=auth.uid() and status='completed_locked' and version=p_expected_version returning * into r;
  if r.id is null then raise exception 'annual_review_reopen_forbidden_or_conflict'; end if;
  insert into public.review_audit_log(review_id,actor_id,action,from_status,to_status,details) values(r.id,auth.uid(),'reopened','completed_locked','conversation_in_progress',jsonb_build_object('reason',btrim(p_reason))); return r; end $$;

revoke all on function public.open_review_for_employee(uuid,bigint),public.submit_employee_preparation(uuid,bigint),public.share_manager_evaluation(uuid,bigint),public.start_review_conversation(uuid,bigint),public.approve_review_as_employee(uuid,bigint),public.approve_review_as_manager(uuid,bigint),public.complete_and_lock_review(uuid,bigint),public.reopen_annual_review(uuid,bigint,text) from public,anon;
grant execute on function public.open_review_for_employee(uuid,bigint),public.submit_employee_preparation(uuid,bigint),public.share_manager_evaluation(uuid,bigint),public.start_review_conversation(uuid,bigint),public.approve_review_as_employee(uuid,bigint),public.approve_review_as_manager(uuid,bigint),public.complete_and_lock_review(uuid,bigint),public.reopen_annual_review(uuid,bigint,text) to authenticated;

revoke all on public.annual_review_assignments,public.annual_reviews,public.employee_review_preparation,public.manager_review_evaluations,public.review_conversation_summary,public.review_goals,public.employee_review_response,public.review_audit_log from anon,authenticated;
grant select on public.annual_review_assignments,public.annual_reviews,public.manager_review_evaluations,public.review_audit_log to authenticated;
grant select,insert,update on public.employee_review_preparation,public.review_conversation_summary,public.employee_review_response to authenticated;
grant select,insert,update,delete on public.review_goals to authenticated;
grant update (rating,not_applicable,comment) on public.manager_review_evaluations to authenticated;

-- Trigger functions are internal implementation details, never browser RPCs.
revoke all on function public.guard_annual_review_child_update(),public.guard_annual_review_evaluation(),public.guard_review_conversation_summary() from public,anon,authenticated;

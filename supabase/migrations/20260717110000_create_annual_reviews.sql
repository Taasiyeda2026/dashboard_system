-- Annual reviews inside Personal Reports. Schema only: DO NOT apply to production
-- until the five Supabase Auth UUIDs have been independently verified.
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
  employee_name text not null,
  employee_role text not null,
  created_at timestamptz not null default now(),
  check (employee_id <> manager_id)
);

create table public.annual_reviews (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references auth.users(id),
  manager_id uuid not null references auth.users(id),
  review_year integer not null check (review_year between 2020 and 2100),
  status public.annual_review_status not null default 'not_opened',
  manager_shared_at timestamptz,
  conversation_date date,
  employee_approved_at timestamptz,
  manager_approved_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  locked_at timestamptz,
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id),
  reopen_reason text,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, review_year),
  foreign key (employee_id, manager_id)
    references public.annual_review_assignments(employee_id, manager_id),
  check (employee_id <> manager_id),
  check ((status = 'completed_locked') = (locked_at is not null))
);

create table public.employee_review_preparation (
  review_id uuid primary key references public.annual_reviews(id) on delete cascade,
  notes text not null default '',
  include_in_pdf boolean not null default false,
  version bigint not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.manager_review_evaluations (
  id uuid primary key default gen_random_uuid(), review_id uuid not null references public.annual_reviews(id) on delete cascade,
  metric_key text not null, metric_label text not null, metric_group text not null check (metric_group in ('common','role')),
  rating smallint check (rating between 1 and 5), not_applicable boolean not null default false,
  comment text not null default '', sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(review_id, metric_key), check (not (not_applicable and rating is not null))
);
create table public.review_conversation_summary (
  review_id uuid primary key references public.annual_reviews(id) on delete cascade,
  achievements text not null default '', strengths text not null default '', improvements text not null default '',
  process_changes text not null default '', support_needed text not null default '', manager_summary text not null default '',
  employee_voice jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
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

-- Server-side provisioning accepts UUIDs only. It never resolves authorization by name or role.
-- It is deliberately unavailable to browser roles. After explicit approval, an operator must
-- verify these UUIDs in auth.users and invoke it once from a trusted SQL session.
create or replace function public.provision_annual_review_assignments(
  p_manager_id uuid, p_tony_id uuid, p_hila_id uuid, p_gil_id uuid, p_eden_id uuid
) returns void language plpgsql security definer set search_path = public, auth as $$
declare ids uuid[] := array[p_manager_id,p_tony_id,p_hila_id,p_gil_id,p_eden_id];
begin
  if array_position(ids, null) is not null or (select count(distinct x) from unnest(ids) x) <> 5 then
    raise exception 'annual_review_assignment_ids_must_be_five_distinct_auth_uuids';
  end if;
  if (select count(*) from auth.users where id = any(ids)) <> 5 then
    raise exception 'annual_review_assignment_auth_uuid_not_found';
  end if;
  insert into public.annual_review_assignments(employee_key,employee_id,manager_id,employee_name,employee_role) values
    ('tony_naim',p_tony_id,p_manager_id,'טוני נעים','הנהלת חשבונות וחשבות שכר'),
    ('hila_rozen',p_hila_id,p_manager_id,'הילה רוזן','אחראית הדרכה ארצית בכל תוכניות תעשיידע'),
    ('gil_neeman',p_gil_id,p_manager_id,'גיל נאמן','מנהל פעילויות ארצי'),
    ('eden_cohen',p_eden_id,p_manager_id,'עדן כהן','מתאמת פעילויות ואדמיניסטרציה ארצית')
  on conflict (employee_key) do update set employee_id=excluded.employee_id,manager_id=excluded.manager_id;

  insert into public.annual_reviews(employee_id,manager_id,review_year)
  select employee_id,manager_id,extract(year from current_date)::integer
  from public.annual_review_assignments
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
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.annual_reviews r where r.id=p_review_id and auth.uid() in (r.employee_id,r.manager_id));
$$;
create or replace function public.annual_review_is_employee(p_review_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.annual_reviews r where r.id=p_review_id and auth.uid()=r.employee_id);
$$;
create or replace function public.annual_review_is_manager(p_review_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.annual_reviews r where r.id=p_review_id and auth.uid()=r.manager_id);
$$;
create or replace function public.annual_review_is_editable(p_review_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.annual_reviews r where r.id=p_review_id and r.locked_at is null);
$$;
revoke all on function public.annual_review_can_read(uuid), public.annual_review_is_employee(uuid), public.annual_review_is_manager(uuid), public.annual_review_is_editable(uuid) from public;
grant execute on function public.annual_review_can_read(uuid), public.annual_review_is_employee(uuid), public.annual_review_is_manager(uuid), public.annual_review_is_editable(uuid) to authenticated;

alter table public.annual_review_assignments enable row level security;
alter table public.annual_reviews enable row level security;
alter table public.employee_review_preparation enable row level security;
alter table public.manager_review_evaluations enable row level security;
alter table public.review_conversation_summary enable row level security;
alter table public.review_goals enable row level security;
alter table public.employee_review_response enable row level security;
alter table public.review_audit_log enable row level security;

create policy assignments_participant_select on public.annual_review_assignments for select to authenticated
 using (auth.uid() in (employee_id,manager_id));
create policy reviews_participant_select on public.annual_reviews for select to authenticated
 using (auth.uid() in (employee_id,manager_id));
create policy reviews_manager_insert on public.annual_reviews for insert to authenticated
 with check (auth.uid()=manager_id and exists(select 1 from public.annual_review_assignments a where a.employee_id=annual_reviews.employee_id and a.manager_id=auth.uid()));
create policy reviews_participant_update on public.annual_reviews for update to authenticated
 using (auth.uid() in (employee_id,manager_id) and locked_at is null)
 with check (auth.uid() in (employee_id,manager_id));

create policy preparation_employee_select on public.employee_review_preparation for select to authenticated
 using (public.annual_review_is_employee(review_id));
create policy preparation_employee_insert on public.employee_review_preparation for insert to authenticated
 with check (public.annual_review_is_employee(review_id) and public.annual_review_is_editable(review_id));
create policy preparation_employee_update on public.employee_review_preparation for update to authenticated
 using (public.annual_review_is_employee(review_id) and public.annual_review_is_editable(review_id))
 with check (public.annual_review_is_employee(review_id));

create policy evaluations_manager_select on public.manager_review_evaluations for select to authenticated
 using (public.annual_review_is_manager(review_id) or (public.annual_review_is_employee(review_id) and exists(select 1 from public.annual_reviews r where r.id=review_id and r.manager_shared_at is not null)));
create policy evaluations_manager_write on public.manager_review_evaluations for all to authenticated
 using (public.annual_review_is_manager(review_id) and public.annual_review_is_editable(review_id))
 with check (public.annual_review_is_manager(review_id) and public.annual_review_is_editable(review_id));

create policy conversation_participant_select on public.review_conversation_summary for select to authenticated using (public.annual_review_can_read(review_id));
create policy conversation_participant_write on public.review_conversation_summary for all to authenticated
 using (public.annual_review_can_read(review_id) and public.annual_review_is_editable(review_id))
 with check (public.annual_review_can_read(review_id) and public.annual_review_is_editable(review_id));
create policy goals_participant_select on public.review_goals for select to authenticated using (public.annual_review_can_read(review_id));
create policy goals_participant_write on public.review_goals for all to authenticated
 using (public.annual_review_can_read(review_id) and public.annual_review_is_editable(review_id))
 with check (public.annual_review_can_read(review_id) and public.annual_review_is_editable(review_id));
create policy response_participant_select on public.employee_review_response for select to authenticated using (public.annual_review_can_read(review_id));
create policy response_employee_write on public.employee_review_response for all to authenticated
 using (public.annual_review_is_employee(review_id) and public.annual_review_is_editable(review_id))
 with check (public.annual_review_is_employee(review_id) and public.annual_review_is_editable(review_id));
create policy audit_participant_select on public.review_audit_log for select to authenticated using (public.annual_review_can_read(review_id));

-- No direct audit writes. Status/lock changes are recorded by a trigger.
create or replace function public.audit_annual_review_update() returns trigger language plpgsql security definer set search_path=public as $$
begin
  new.updated_at=now(); new.version=old.version+1;
  if (new.employee_id,new.manager_id,new.review_year) is distinct from (old.employee_id,old.manager_id,old.review_year) then
    raise exception 'annual_review_identity_immutable';
  end if;
  if old.locked_at is not null and not (
    auth.uid()=old.manager_id and new.locked_at is null and new.status='conversation_in_progress'
    and new.reopened_at is not null and nullif(btrim(new.reopen_reason),'') is not null
  ) then raise exception 'annual_review_locked'; end if;
  if auth.uid()=old.employee_id and new.status is distinct from old.status and not (
    (old.status='employee_preparation' and new.status='submitted_to_manager') or
    (old.status='awaiting_employee_response' and new.status='completed_locked' and new.manager_approved_at is not null)
  ) then raise exception 'annual_review_employee_transition_forbidden'; end if;
  if new.status='completed_locked' and (new.employee_approved_at is null or new.manager_approved_at is null) then
    raise exception 'annual_review_both_approvals_required';
  end if;
  if new.status is distinct from old.status or new.locked_at is distinct from old.locked_at or new.reopened_at is distinct from old.reopened_at then
    insert into public.review_audit_log(review_id,actor_id,action,from_status,to_status,details)
    values(new.id,auth.uid(),case when new.reopened_at is distinct from old.reopened_at then 'reopened' when new.locked_at is distinct from old.locked_at then 'locked' else 'status_changed' end,old.status,new.status,
      jsonb_build_object('reopen_reason',new.reopen_reason));
  end if;
  return new;
end $$;
create trigger annual_reviews_audit_before_update before update on public.annual_reviews for each row execute function public.audit_annual_review_update();

-- Generic child lock and optimistic-version guard. Autosave must update WHERE version=<loaded>.
create or replace function public.guard_annual_review_child_update() returns trigger language plpgsql set search_path=public as $$
declare rid uuid := coalesce(new.review_id,old.review_id);
begin
  if not public.annual_review_is_editable(rid) then raise exception 'annual_review_locked'; end if;
  if tg_op='UPDATE' then new.updated_at=now(); new.version=old.version+1; end if;
  return new;
end $$;
create trigger preparation_guard before insert or update on public.employee_review_preparation for each row execute function public.guard_annual_review_child_update();
create trigger conversation_guard before insert or update on public.review_conversation_summary for each row execute function public.guard_annual_review_child_update();
create trigger goals_guard before insert or update on public.review_goals for each row execute function public.guard_annual_review_child_update();
create trigger response_guard before insert or update on public.employee_review_response for each row execute function public.guard_annual_review_child_update();

create or replace function public.guard_annual_review_evaluation() returns trigger language plpgsql set search_path=public as $$
begin
  if not public.annual_review_is_editable(coalesce(new.review_id,old.review_id)) then raise exception 'annual_review_locked'; end if;
  if tg_op='UPDATE' then new.updated_at=now(); end if;
  return new;
end $$;
create trigger evaluations_guard before insert or update on public.manager_review_evaluations for each row execute function public.guard_annual_review_evaluation();

create or replace function public.reopen_annual_review(p_review_id uuid,p_reason text) returns public.annual_reviews
language plpgsql security definer set search_path=public as $$
declare result public.annual_reviews;
begin
  if nullif(btrim(p_reason),'') is null then raise exception 'annual_review_reopen_reason_required'; end if;
  update public.annual_reviews set status='conversation_in_progress',locked_at=null,completed_at=null,
    reopened_at=now(),reopened_by=auth.uid(),reopen_reason=btrim(p_reason)
  where id=p_review_id and manager_id=auth.uid() and locked_at is not null returning * into result;
  if result.id is null then raise exception 'annual_review_reopen_forbidden'; end if;
  return result;
end $$;
revoke all on function public.reopen_annual_review(uuid,text) from public,anon;
grant execute on function public.reopen_annual_review(uuid,text) to authenticated;

revoke all on public.annual_review_assignments,public.annual_reviews,public.employee_review_preparation,public.manager_review_evaluations,public.review_conversation_summary,public.review_goals,public.employee_review_response,public.review_audit_log from anon;
grant select on public.annual_review_assignments to authenticated;
grant select,insert,update on public.annual_reviews to authenticated;
grant select,insert,update on public.employee_review_preparation,public.review_conversation_summary,public.employee_review_response to authenticated;
grant select,insert,update,delete on public.manager_review_evaluations,public.review_goals to authenticated;
grant select on public.review_audit_log to authenticated;

-- Flag actionable educational-staff midpoint reports for follow-up.
-- Admin-only read/update. Public questionnaire submitter cannot read incident records.
create table if not exists public.feedback_staff_mid_issues (
  response_id uuid primary key references public.feedback_responses(id) on delete restrict,
  campaign_id uuid not null references public.feedback_campaigns(id) on delete restrict,
  activity_row_id text,
  academic_year text not null,
  activity_start_date date,
  program_key text not null,
  school_name text not null default '',
  contact_name text not null default '',
  activity_manager text not null default '',
  severity text not null check (severity in ('minor','significant','urgent')),
  areas text[] not null default '{}',
  details text not null default '',
  contact_requested boolean,
  status text not null default 'open' check(status in ('open','in_progress','resolved')),
  assigned_to text not null default '',
  resolution_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index if not exists feedback_staff_mid_issues_year_status_idx
  on public.feedback_staff_mid_issues(academic_year,status,created_at desc);
alter table public.feedback_staff_mid_issues enable row level security;
revoke all on public.feedback_staff_mid_issues from public,anon;
grant select,update on public.feedback_staff_mid_issues to authenticated;
drop policy if exists feedback_staff_mid_admin_select on public.feedback_staff_mid_issues;
create policy feedback_staff_mid_admin_select on public.feedback_staff_mid_issues
 for select to authenticated using(private.feedback_is_admin());
drop policy if exists feedback_staff_mid_admin_update on public.feedback_staff_mid_issues;
create policy feedback_staff_mid_admin_update on public.feedback_staff_mid_issues
 for update to authenticated using(private.feedback_is_admin())
 with check(private.feedback_is_admin());

create or replace function private.feedback_staff_mid_issue_audit()
returns trigger language plpgsql security definer set search_path to ''
as $audit$
begin
  new.updated_at:=now();
  new.updated_by:=auth.uid();
  return new;
end;
$audit$;
revoke all on function private.feedback_staff_mid_issue_audit() from public,anon,authenticated;
drop trigger if exists feedback_staff_mid_issue_audit on public.feedback_staff_mid_issues;
create trigger feedback_staff_mid_issue_audit before update on public.feedback_staff_mid_issues
for each row execute function private.feedback_staff_mid_issue_audit();

create or replace function private.feedback_staff_mid_capture_answer()
returns trigger language plpgsql security definer set search_path to ''
as $capture$
declare
  q_key text;
  c public.feedback_campaigns%rowtype;
  severity_value text;
  v_manager text;
begin
  select q.question_key into q_key
  from public.feedback_questions q where q.id=new.question_id;
  if q_key not in ('staff_20261029_M12','staff_20261029_M13','staff_20261029_M14','staff_20261029_M15') then
    return new;
  end if;
  select c0.* into c
  from public.feedback_responses r
  join public.feedback_campaigns c0 on c0.id=r.campaign_id
  where r.id=new.response_id;
  if not found or c.audience<>'educational_staff' or c.stage<>'mid' then return new; end if;

  if q_key='staff_20261029_M12' then
    severity_value:=new.value_options[1];
    if severity_value not in ('minor','significant','urgent') then return new; end if;
    select coalesce(a.activity_manager,'') into v_manager
      from public.activities a where a.row_id=c.activity_row_id;
    insert into public.feedback_staff_mid_issues(
      response_id,campaign_id,activity_row_id,academic_year,activity_start_date,
      program_key,school_name,contact_name,activity_manager,severity,assigned_to)
    values(new.response_id,c.id,c.activity_row_id,c.academic_year,c.activity_start_date,
      c.program_key,c.school_name,c.contact_name,coalesce(v_manager,''),severity_value,coalesce(v_manager,''))
    on conflict(response_id) do nothing;
  elsif q_key='staff_20261029_M13' then
    update public.feedback_staff_mid_issues set areas=coalesce(new.value_options,'{}'::text[])
      where response_id=new.response_id;
  elsif q_key='staff_20261029_M14' then
    update public.feedback_staff_mid_issues set details=coalesce(new.value_text,'')
      where response_id=new.response_id;
  elsif q_key='staff_20261029_M15' then
    update public.feedback_staff_mid_issues set contact_requested=new.value_bool
      where response_id=new.response_id;
  end if;
  return new;
end;
$capture$;
revoke all on function private.feedback_staff_mid_capture_answer() from public,anon,authenticated;
drop trigger if exists feedback_staff_mid_capture_answer on public.feedback_answers;
create trigger feedback_staff_mid_capture_answer after insert on public.feedback_answers
for each row execute function private.feedback_staff_mid_capture_answer();

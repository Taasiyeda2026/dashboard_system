
-- Activity-manager expiry extension, and an idempotent weekly manager digest.
-- Maintains universal read access; only write access is scoped to assigned activities.
create or replace function public.feedback_manager_extend_staff_expiry(
  p_campaign_id uuid, p_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path to ''
as $fn$
declare v public.feedback_campaigns%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'feedback_forbidden' using errcode='42501';
  end if;
  select * into v from public.feedback_campaigns where id=p_campaign_id for update;
  if not found then raise exception 'feedback_campaign_not_found'; end if;
  if v.audience <> 'educational_staff' or v.activity_row_id is null
    or v.status <> 'active' or v.expires_at is null or v.expires_at > now()
  then raise exception 'feedback_expiry_not_eligible'; end if;
  if exists (select 1 from public.feedback_responses r where r.campaign_id=v.id)
    or exists (select 1 from public.feedback_recipients rc where rc.campaign_id=v.id
      and (rc.status='completed' or rc.completed_at is not null))
  then raise exception 'feedback_already_completed'; end if;
  if p_expires_at is null or p_expires_at<=now() or p_expires_at<=v.opens_at
  then raise exception 'feedback_invalid_window'; end if;
  if not private.feedback_can_share_staff_activity(v.activity_row_id)
    or not exists (select 1 from public.activities a where a.row_id=v.activity_row_id
      and a.start_date is not null and a.instructor_assignment_locked is true
      and (a.emp_id is not null or nullif(btrim(a.emp_id_2),'') is not null))
  then raise exception 'feedback_forbidden' using errcode='42501'; end if;
  update public.feedback_campaigns set expires_at=p_expires_at,updated_at=now() where id=v.id;
  return jsonb_build_object('updated',true,'campaign_id',v.id,'expires_at',p_expires_at);
end
$fn$;
revoke all on function public.feedback_manager_extend_staff_expiry(uuid,timestamptz) from public,anon;
grant execute on function public.feedback_manager_extend_staff_expiry(uuid,timestamptz) to authenticated;

create table if not exists private.feedback_expiry_weekly_outbox (
  id uuid primary key default gen_random_uuid(),
  manager_user_id text not null,
  week_start date not null,
  status text not null default 'claimed' check(status in ('claimed','unknown','accepted','failed','skipped')),
  claim_token uuid not null default gen_random_uuid(),
  graph_started_at timestamptz,
  accepted_at timestamptz,
  http_status integer,
  graph_request_id text,
  error_code text,
  item_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(manager_user_id,week_start)
);
alter table private.feedback_expiry_weekly_outbox enable row level security;
revoke all on table private.feedback_expiry_weekly_outbox from public,anon,authenticated;
grant select,insert,update on table private.feedback_expiry_weekly_outbox to service_role;

create or replace function private.feedback_expired_for_manager(
  p_manager_user_id text, p_now timestamptz default now()
) returns table (
 campaign_id uuid, audience text, stage text, program_title text,
 subject_name text, school_name text, expires_at timestamptz
) language sql stable security definer set search_path to ''
as $fn$
 select distinct
   c.id, c.audience, c.stage, coalesce(p.title,c.program_key),
   case when c.audience='instructor' then coalesce(nullif(c.instructor_name,''),'מדריך')
     else coalesce(nullif(c.contact_name,''),'צוות חינוכי') end,
   coalesce(nullif(c.school_name,''),nullif(a.school,''),'—'),c.expires_at
 from public.users u
 join public.activities a
   on lower(regexp_replace(btrim(a.activity_manager),'[[:space:]]+',' ','g')) =
      lower(regexp_replace(btrim(coalesce(nullif(u.full_name,''),nullif(u.name,''),u.username,'')),'[[:space:]]+',' ','g'))
 join public.feedback_campaigns c
   on c.academic_year=a.activity_season
   and (
     (c.audience='educational_staff' and c.activity_row_id=a.row_id)
     or (c.audience='instructor' and
       (a.emp_id::text=c.instructor_emp_id or a.emp_id_2=c.instructor_emp_id))
   )
 join public.feedback_programs p on p.key=c.program_key
 left join lateral (
   select mapping.program_key from private.feedback_activity_program(to_jsonb(a)) mapping limit 1
 ) mapped on true
 where u.user_id=p_manager_user_id and u.role='activities_manager' and u.is_active=true
   and a.start_date is not null and a.instructor_assignment_locked is true
   and (a.emp_id is not null or nullif(btrim(a.emp_id_2),'') is not null)
   and (c.audience='educational_staff' or mapped.program_key=c.program_key)
   and c.status='active' and c.expires_at is not null and c.expires_at<=p_now
   and not exists(select 1 from public.feedback_responses r where r.campaign_id=c.id)
   and not exists(select 1 from public.feedback_recipients rc
       where rc.campaign_id=c.id and (rc.status='completed' or rc.completed_at is not null))
 order by c.expires_at,c.id;
$fn$;
revoke all on function private.feedback_expired_for_manager(text,timestamptz) from public,anon,authenticated;

create or replace function public.feedback_expiry_weekly_claim(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path to ''
as $fn$
declare v_row private.feedback_expiry_weekly_outbox%rowtype;
declare v_week date := date_trunc('week',p_now at time zone 'Asia/Jerusalem')::date;
begin
 with candidates as (
  select u.user_id from public.users u
  where u.role='activities_manager' and u.is_active is true
   and nullif(btrim(u.email),'') is not null
   and exists(select 1 from private.feedback_expired_for_manager(u.user_id,p_now) limit 1)
   and not exists(select 1 from private.feedback_expiry_weekly_outbox o
     where o.manager_user_id=u.user_id and o.week_start=v_week)
  order by u.user_id limit 1
 )
 insert into private.feedback_expiry_weekly_outbox(manager_user_id,week_start)
 select user_id,v_week from candidates
 on conflict (manager_user_id,week_start) do nothing
 returning * into v_row;
 if not found then return jsonb_build_object('ready',false); end if;
 return jsonb_build_object('ready',true,'id',v_row.id,'claim_token',v_row.claim_token);
end
$fn$;

create or replace function public.feedback_expiry_weekly_begin(
 p_id uuid,p_claim uuid,p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path to ''
as $fn$
declare v_row private.feedback_expiry_weekly_outbox%rowtype;
declare v_manager_email text;
declare v_admin_emails text[];
declare v_items jsonb;
begin
 select * into v_row from private.feedback_expiry_weekly_outbox
   where id=p_id and claim_token=p_claim for update;
 if not found or v_row.status<>'claimed' then return jsonb_build_object('ready',false); end if;
 select u.email into v_manager_email from public.users u
  where u.user_id=v_row.manager_user_id and u.role='activities_manager' and u.is_active is true;
 select array_agg(distinct btrim(u.email)) into v_admin_emails from public.users u
  where u.role='admin' and u.is_active is true and nullif(btrim(u.email),'') is not null;
 select coalesce(jsonb_agg(jsonb_build_object(
   'audience',e.audience,'stage',e.stage,'program',e.program_title,
   'subject_name',e.subject_name,'school',e.school_name,'expired_at',e.expires_at)
   order by e.expires_at,e.campaign_id),'[]'::jsonb) into v_items
 from private.feedback_expired_for_manager(v_row.manager_user_id,p_now) e;
 if v_manager_email is null or coalesce(cardinality(v_admin_emails),0)=0 or jsonb_array_length(v_items)=0 then
   update private.feedback_expiry_weekly_outbox set status='skipped',updated_at=now(),
     error_code='no_eligible_items_or_recipient' where id=p_id;
   return jsonb_build_object('ready',false);
 end if;
 -- Commit "possibly sent" BEFORE calling Graph: an ambiguous HTTP response must never retry.
 update private.feedback_expiry_weekly_outbox set status='unknown',graph_started_at=now(),
  updated_at=now(),item_count=jsonb_array_length(v_items) where id=p_id;
 return jsonb_build_object('ready',true,'to_email',v_manager_email,
  'cc_emails',to_jsonb(v_admin_emails),'items',v_items,'count',jsonb_array_length(v_items));
end
$fn$;

create or replace function public.feedback_expiry_weekly_finish(
 p_id uuid,p_claim uuid,p_result text,p_http integer default null,
 p_graph_request_id text default null,p_error text default null
) returns boolean language plpgsql security definer set search_path to ''
as $fn$
begin
 if p_result not in ('accepted','failed','unknown') then
   raise exception 'invalid_result';
 end if;
 update private.feedback_expiry_weekly_outbox set status=p_result,http_status=p_http,
   graph_request_id=p_graph_request_id,error_code=left(p_error,100),
   accepted_at=case when p_result='accepted' then now() else null end,updated_at=now()
 where id=p_id and claim_token=p_claim and status='unknown';
 return found;
end
$fn$;
revoke all on function public.feedback_expiry_weekly_claim(timestamptz) from public,anon,authenticated;
revoke all on function public.feedback_expiry_weekly_begin(uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.feedback_expiry_weekly_finish(uuid,uuid,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.feedback_expiry_weekly_claim(timestamptz) to service_role;
grant execute on function public.feedback_expiry_weekly_begin(uuid,uuid,timestamptz) to service_role;
grant execute on function public.feedback_expiry_weekly_finish(uuid,uuid,text,integer,text,text) to service_role;
notify pgrst,'reload schema';

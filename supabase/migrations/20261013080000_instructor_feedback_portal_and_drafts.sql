-- Instructor-only portal. Every read is resolved from auth.uid(), never a
-- client-supplied employee ID. An individual token is required for draft edits.
-- This migration sends NO email and schedules NO jobs.
create or replace function public.feedback_instructor_portal_items(
  p_academic_year text default 'school_2027'
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_emp text; v_items jsonb;
begin
  select u.emp_id into v_emp
  from public.users u
  where u.auth_user_id=auth.uid()
    and u.role='instructor' and u.is_active is true
    and nullif(btrim(u.emp_id),'') is not null
  limit 1;
  if v_emp is null then
    raise exception 'feedback_forbidden' using errcode='42501';
  end if;
  if p_academic_year <> 'school_2027' then
    return jsonb_build_object('student','[]'::jsonb,'personal','[]'::jsonb);
  end if;
  return jsonb_build_object(
    'student',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,'stage',c.stage,'program_key',c.program_key,
        'course',coalesce(c.activity_name,a.activity_name,''),
        'school',coalesce(c.school_name,a.school,''),
        'authority',coalesce(c.authority_name,a.authority,''),
        'grade',coalesce(c.grade,a.grade,''),
        'class_group',coalesce(c.class_group,a.class_group,''),
        'token',c.public_token,'opens_at',c.opens_at
      ) order by c.opens_at desc,c.id)
      from public.feedback_campaigns c
      join public.activities a on a.row_id=c.activity_row_id
      where c.audience='student' and c.stage in ('pre','final','post')
        and c.academic_year='school_2027'
        and a.activity_season='school_2027'
        and (a.emp_id=v_emp or a.emp_id_2=v_emp)
        and c.status='active'
        and c.opens_at<=now()
        and (c.expires_at is null or c.expires_at>now())
        and c.public_token is not null
    ),'[]'::jsonb),
    'personal',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,'stage',c.stage,'program_key',c.program_key,
        'program_title',coalesce(fp.title,c.program_key),
        'token',rc.token,'opens_at',c.opens_at,
        'status',case when rc.status='completed' or rc.locked then 'completed'
          when exists(select 1 from public.feedback_instructor_drafts d where d.recipient_id=rc.id)
            then 'draft' else 'pending' end
      ) order by c.opens_at desc,c.id)
      from public.feedback_campaigns c
      join public.feedback_recipients rc on rc.campaign_id=c.id
        and rc.instructor_emp_id=v_emp and rc.recipient_type='instructor'
      left join public.feedback_programs fp on fp.key=c.program_key
      where c.audience='instructor' and c.stage in ('pre','final','final_b')
        and c.academic_year='school_2027'
        and c.instructor_emp_id=v_emp
        and c.opens_at<=now()
        and (c.expires_at is null or c.expires_at>now())
        and c.status='active' and rc.token is not null
    ),'[]'::jsonb)
  );
end $$;

create table if not exists public.feedback_instructor_drafts (
  recipient_id uuid primary key references public.feedback_recipients(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  review jsonb,
  updated_at timestamptz not null default now(),
  constraint feedback_instructor_draft_answers_object check(jsonb_typeof(answers)='object'),
  constraint feedback_instructor_draft_limit check(pg_column_size(answers)<=65536 and coalesce(pg_column_size(review),0)<=16384)
);
alter table public.feedback_instructor_drafts enable row level security;
revoke all on public.feedback_instructor_drafts from public,anon,authenticated;
grant select,insert,update,delete on public.feedback_instructor_drafts to service_role;

create or replace function public.feedback_public_instructor_draft(
 p_token text,p_write boolean default false,p_answers jsonb default null,p_review jsonb default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_target record; v_campaign public.feedback_campaigns; v_recipient public.feedback_recipients;
 v_state text; v_ans jsonb; v_review jsonb;
begin
  select * into v_target from private.feedback_token_target(p_token,p_write) limit 1;
  if v_target.recipient_id is null then return '{"ok":false,"state":"invalid"}'::jsonb; end if;
  select * into v_campaign from public.feedback_campaigns where id=v_target.campaign_id;
  select * into v_recipient from public.feedback_recipients where id=v_target.recipient_id;
  if v_campaign.audience<>'instructor' or v_recipient.recipient_type<>'instructor' or v_campaign.stage not in ('pre','final','final_b') then
    return '{"ok":false,"state":"invalid"}'::jsonb;
  end if;
  v_state:=private.feedback_public_state(v_campaign.id,v_target.recipient_id);
  if v_state<>'ok' then return jsonb_build_object('ok',false,'state',v_state); end if;
  if p_write then
    if p_answers is null or jsonb_typeof(p_answers)<>'object' or pg_column_size(p_answers)>65536
      or coalesce(pg_column_size(p_review),0)>16384 then
      return '{"ok":false,"state":"invalid_payload"}'::jsonb;
    end if;
    if exists(
      select 1 from jsonb_object_keys(p_answers) k
      where not exists(select 1 from public.feedback_template_questions q
        where q.version_id=v_campaign.template_version_id and q.id::text=k)
    ) then return '{"ok":false,"state":"invalid_answers"}'::jsonb; end if;
    insert into public.feedback_instructor_drafts(recipient_id,answers,review,updated_at)
      values(v_target.recipient_id,p_answers,p_review,now())
      on conflict(recipient_id) do update set answers=excluded.answers,review=excluded.review,updated_at=now();
  end if;
  select d.answers,d.review into v_ans,v_review from public.feedback_instructor_drafts d
    where d.recipient_id=v_target.recipient_id;
  return jsonb_build_object('ok',true,'state','ok','answers',coalesce(v_ans,'{}'::jsonb),
    'review',v_review);
end $$;

create or replace function private.feedback_instructor_draft_cleanup()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='completed' or new.locked is true then
    delete from public.feedback_instructor_drafts where recipient_id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists feedback_instructor_draft_cleanup_on_submit on public.feedback_recipients;
create trigger feedback_instructor_draft_cleanup_on_submit
  after update of status,locked on public.feedback_recipients
  for each row execute function private.feedback_instructor_draft_cleanup();

revoke all on function public.feedback_instructor_portal_items(text) from public,anon,authenticated;
grant execute on function public.feedback_instructor_portal_items(text) to authenticated;
revoke all on function public.feedback_public_instructor_draft(text,boolean,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.feedback_public_instructor_draft(text,boolean,jsonb,jsonb) to anon,authenticated;
revoke all on function private.feedback_instructor_draft_cleanup() from public,anon,authenticated;

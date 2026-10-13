
-- Service-role-only transactional preparation, claim, send guard and outcome logging.
-- A separate Edge Function performs Microsoft Graph sendMail.

create or replace function public.feedback_auto_prepare(
 p_mode text default 'daily',p_now timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare ctl public.feedback_auto_control;
 c record; v_template uuid; v_campaign uuid; v_recipient uuid;
 v_send timestamptz; v_status text; v_error text; v_count int:=0;
 v_existing_campaign record; v_email text;
begin
 if auth.role() <> 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
 select * into ctl from public.feedback_auto_control where singleton;
 if ctl.enabled is not true or ctl.activated_at is null then return '{"disabled":true}'::jsonb; end if;
 if p_mode not in ('daily','manual') then raise exception 'invalid_mode'; end if;
 if p_mode='daily' and (
     extract(hour from p_now at time zone 'Asia/Jerusalem')<>5 or
     extract(minute from p_now at time zone 'Asia/Jerusalem')<>30
 ) then return '{"outside_window":true}'::jsonb; end if;
 perform pg_advisory_xact_lock(2027,915);
 for c in
   select * from public.feedback_auto_candidates(p_now) a
   where a.eligible_at<=p_now
     and ((p_mode='manual' and a.audience='instructor' and a.stage='pre')
       or (p_mode='daily' and not(a.audience='instructor' and a.stage='pre')))
   order by a.audience,a.stage,a.delivery_key
 loop
   v_status:='pending';v_error:=null;v_campaign:=null;v_recipient:=null;
   v_send:=case when p_mode='daily'
     then (((p_now at time zone 'Asia/Jerusalem')::date + time '09:15') at time zone 'Asia/Jerusalem')
     else c.eligible_at end;
   select t.current_version_id into v_template
      from public.feedback_templates t
     where t.program_key=c.program_key and t.audience=c.audience and t.stage=c.stage;
   if v_template is null then v_status:='needs_attention';v_error:='template_unpublished'; end if;
   if c.recipient_email is null or c.recipient_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$'
   then v_status:='needs_attention';v_error:='missing_instructor_email'; end if;
   if c.audience='student' and (
     c.cc_email is null or c.cc_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$'
   ) then v_status:='needs_attention';v_error:='missing_assigned_manager_email'; end if;
   if c.audience='student' and c.age_band is null
   then v_status:='needs_attention';v_error:='unresolved_grade_age_band'; end if;
   select fc.* into v_existing_campaign
     from public.feedback_campaigns fc
     where fc.audience=c.audience and fc.stage=c.stage
       and fc.academic_year=c.academic_year
       and ((c.audience='student' and fc.activity_row_id=c.activity_row_id)
         or (c.audience='instructor' and fc.instructor_emp_id=c.instructor_emp_id
           and fc.program_key=c.program_key))
     order by fc.created_at limit 1;
   if found then
     -- Do not re-mail manually published student links from before scheduler activation.
     if c.audience='student' and v_existing_campaign.created_at<ctl.activated_at then continue; end if;
     if v_existing_campaign.status<>'active' or v_existing_campaign.program_key<>c.program_key
       then v_status:='needs_attention';v_error:='existing_campaign_conflict'; end if;
     if c.audience='instructor' and exists(
       select 1 from public.feedback_recipients r
       where r.campaign_id=v_existing_campaign.id
         and (r.last_shared_at is not null or r.completed_at is not null)
     ) then continue; end if;
     v_campaign:=v_existing_campaign.id;
   end if;
   if v_status='pending' then
     if v_campaign is null then
       insert into public.feedback_campaigns(
         activity_row_id,program_key,template_version_id,audience,stage,age_band,academic_year,
         activity_name,school_name,authority_name,grade,class_group,
         instructor_emp_id,instructor_name,contact_name,
         activity_start_date,activity_end_date,public_token,opens_at
       ) values (
         c.activity_row_id,c.program_key,v_template,c.audience,c.stage,c.age_band,c.academic_year,
         coalesce(c.activity_name,''),coalesce(c.school_name,''),coalesce(c.authority_name,''),
         coalesce(c.grade,''),coalesce(c.class_group,''),c.instructor_emp_id,
         coalesce(c.recipient_name,''),'',c.activity_start_date,c.activity_end_date,
         case when c.audience='student' then private.feedback_new_token() else null end,
         v_send
       ) on conflict do nothing returning id into v_campaign;
       if v_campaign is null then
         select fc.id into v_campaign from public.feedback_campaigns fc
         where fc.audience=c.audience and fc.stage=c.stage
         and ((c.audience='student' and fc.activity_row_id=c.activity_row_id)
          or (c.audience='instructor' and fc.instructor_emp_id=c.instructor_emp_id
            and fc.program_key=c.program_key and fc.academic_year=c.academic_year))
         order by fc.created_at limit 1;
       end if;
     end if;
     if v_campaign is null then
       v_status:='needs_attention';v_error:='campaign_could_not_be_created';
     elsif c.audience='instructor' then
       select r.id into v_recipient from public.feedback_recipients r
        where r.campaign_id=v_campaign limit 1;
       if v_recipient is null then
         insert into public.feedback_recipients(
          campaign_id,recipient_type,instructor_emp_id,display_name,phone,email,token
         ) values(
          v_campaign,'instructor',c.instructor_emp_id,coalesce(c.recipient_name,''),
          coalesce((select i.mobile from public.contacts_instructors i
            where i.emp_id::text=c.instructor_emp_id),''),c.recipient_email,private.feedback_new_token()
         ) on conflict(campaign_id) do nothing returning id into v_recipient;
         if v_recipient is null then
           select r.id into v_recipient from public.feedback_recipients r where r.campaign_id=v_campaign limit 1;
         end if;
       end if;
       if v_recipient is null then
         v_status:='needs_attention';v_error:='recipient_could_not_be_created';
       end if;
     end if;
   end if;
   insert into public.feedback_auto_delivery(
     delivery_key,audience,stage,academic_year,activity_row_id,program_key,
     instructor_emp_id,campaign_id,recipient_id,recipient_email,cc_email,
     eligible_at,send_after,status,error_code
   ) values(
     c.delivery_key,c.audience,c.stage,c.academic_year,c.activity_row_id,c.program_key,
     c.instructor_emp_id,v_campaign,v_recipient,c.recipient_email,c.cc_email,
     c.eligible_at,v_send,v_status,v_error
   ) on conflict(delivery_key) do update set
     campaign_id=excluded.campaign_id,recipient_id=excluded.recipient_id,
     recipient_email=excluded.recipient_email,cc_email=excluded.cc_email,
     eligible_at=excluded.eligible_at,send_after=excluded.send_after,
     status=excluded.status,error_code=excluded.error_code,updated_at=now()
   where public.feedback_auto_delivery.status in ('pending','needs_attention','invalidated')
     and public.feedback_auto_delivery.graph_started_at is null;
   v_count:=v_count+1;
 end loop;
 return jsonb_build_object('prepared_or_checked',v_count,'mode',p_mode);
end $$;
revoke all on function public.feedback_auto_prepare(text,timestamptz) from public,anon,authenticated;
grant execute on function public.feedback_auto_prepare(text,timestamptz) to service_role;

create or replace function public.feedback_auto_claim(p_mode text default 'daily',p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path=''
as $$
declare d record; v_claim uuid;
begin
 if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
 if (select enabled is true from public.feedback_auto_control where singleton) is not true
   then return null; end if;
 if p_mode not in ('daily','manual') then raise exception 'invalid_mode'; end if;
 if p_mode='daily' and (
    (p_now at time zone 'Asia/Jerusalem')::time < time '09:15'
    or (p_now at time zone 'Asia/Jerusalem')::time >= time '09:45'
  ) then return null; end if;
 select * into d from public.feedback_auto_delivery a
   where a.status='pending' and a.send_after<=p_now
     and ((p_mode='daily' and not (a.audience='instructor' and a.stage='pre'))
       or (p_mode='manual' and a.audience='instructor' and a.stage='pre'))
     and a.graph_started_at is null
   order by a.send_after,a.delivery_key
   limit 1 for update skip locked;
 if not found then return null; end if;
 v_claim:=gen_random_uuid();
 update public.feedback_auto_delivery set status='claimed',claim_token=v_claim,
    claimed_at=now(),attempts=attempts+1,updated_at=now()
 where id=d.id;
 return (select jsonb_build_object(
   'id',d.id,'claim_token',v_claim,'delivery_key',d.delivery_key,
   'audience',d.audience,'stage',d.stage,'program_title',p.title,
   'recipient_name',i.full_name,'recipient_email',d.recipient_email,'cc_email',d.cc_email,
   'school_name',c.school_name,'authority_name',c.authority_name,
   'grade',c.grade,'class_group',c.class_group,
   'token',case when d.audience='student' then c.public_token else r.token end,
   'campaign_id',c.id
 ) from public.feedback_campaigns c
 join public.feedback_programs p on p.key=d.program_key
 join public.contacts_instructors i on i.emp_id::text=d.instructor_emp_id
 left join public.feedback_recipients r on r.id=d.recipient_id
 where c.id=d.campaign_id);
end $$;
revoke all on function public.feedback_auto_claim(text,timestamptz) from public,anon,authenticated;
grant execute on function public.feedback_auto_claim(text,timestamptz) to service_role;

create or replace function public.feedback_auto_begin(p_id uuid,p_claim uuid,p_now timestamptz default now())
returns boolean language plpgsql security definer set search_path=''
as $$
declare d record; c record; v_id uuid;
begin
 if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
 select * into d from public.feedback_auto_delivery a where a.id=p_id
 and a.claim_token=p_claim and a.status='claimed' for update;
 if not found then return false; end if;
 select * into c from public.feedback_auto_candidates(p_now) x
   where x.delivery_key=d.delivery_key and x.audience=d.audience
     and x.stage=d.stage and x.program_key=d.program_key
     and x.instructor_emp_id=d.instructor_emp_id and x.eligible_at<=p_now
   limit 1;
 if not found or coalesce(c.recipient_email,'')<>coalesce(d.recipient_email,'')
   or coalesce(c.cc_email,'')<>coalesce(d.cc_email,'')
   or (d.audience='student' and (
     c.cc_email is null or c.age_band is null or c.activity_row_id<>d.activity_row_id))
   or d.send_after>p_now
   or not exists(
     select 1 from public.feedback_campaigns fc
     where fc.id=d.campaign_id and fc.status='active' and fc.opens_at<=p_now
       and (fc.expires_at is null or fc.expires_at>p_now)
   )
 then
   update public.feedback_auto_delivery set status='invalidated',
     error_code='eligibility_changed_before_send',updated_at=now()
     where id=d.id;
   return false;
 end if;
 update public.feedback_auto_delivery set status='sending',
    graph_started_at=now(),updated_at=now()
 where id=d.id returning id into v_id;
 return v_id is not null;
end $$;
revoke all on function public.feedback_auto_begin(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.feedback_auto_begin(uuid,uuid,timestamptz) to service_role;

create or replace function public.feedback_auto_finish(
 p_id uuid,p_claim uuid,p_status text,p_http integer,p_graph_request_id text,p_error text
) returns boolean language plpgsql security definer set search_path=''
as $$
declare v_recipient uuid;v_id uuid;
begin
 if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
 if p_status not in ('accepted','failed','unknown') then raise exception 'invalid_status'; end if;
 update public.feedback_auto_delivery d set status=p_status,graph_status=p_http,
    graph_request_id=left(p_graph_request_id,256),
    error_code=left(p_error,120),accepted_at=case when p_status='accepted' then now() else null end,
    updated_at=now()
 where d.id=p_id and d.claim_token=p_claim and d.status='sending'
 returning d.id,d.recipient_id into v_id,v_recipient;
 if v_id is null then return false; end if;
 if p_status='accepted' and v_recipient is not null then
    update public.feedback_recipients set last_shared_at=now(),last_shared_channel='email'
      where id=v_recipient;
 end if;
 return true;
end $$;
revoke all on function public.feedback_auto_finish(uuid,uuid,text,integer,text,text)
 from public,anon,authenticated;
grant execute on function public.feedback_auto_finish(uuid,uuid,text,integer,text,text) to service_role;

create or replace function public.feedback_auto_delivery_status()
returns table(audience text,stage text,status text,total bigint)
language sql stable security definer set search_path=''
as $fn$
 select d.audience,d.stage,d.status,count(*)::bigint
 from public.feedback_auto_delivery d
 where private.feedback_can_view()
 group by d.audience,d.stage,d.status order by d.audience,d.stage,d.status;
$fn$;
revoke all on function public.feedback_auto_delivery_status() from public,anon;
grant execute on function public.feedback_auto_delivery_status() to authenticated,service_role;

notify pgrst,'reload schema';

-- Add manager name to the private mail payload to personalize the greeting.
-- No campaign windows, recipients, or delivery state are changed by this migration.
create or replace function public.feedback_expiry_weekly_begin(
 p_id uuid,p_claim uuid,p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path to ''
as $fn$
declare v_row private.feedback_expiry_weekly_outbox%rowtype;
declare v_manager_email text;
declare v_manager_name text;
declare v_admin_emails text[];
declare v_items jsonb;
begin
 select * into v_row from private.feedback_expiry_weekly_outbox
   where id=p_id and claim_token=p_claim for update;
 if not found or v_row.status<>'claimed' then return jsonb_build_object('ready',false); end if;

 select u.email,coalesce(nullif(btrim(u.full_name),''),nullif(btrim(u.name),''),nullif(btrim(u.username),''))
   into v_manager_email,v_manager_name
 from public.users u
 where u.user_id=v_row.manager_user_id and u.role='activities_manager' and u.is_active is true;

 select array_agg(distinct btrim(u.email)) into v_admin_emails from public.users u
 where u.role='admin' and u.is_active is true and nullif(btrim(u.email),'') is not null;

 select coalesce(jsonb_agg(jsonb_build_object(
   'audience',e.audience,'stage',e.stage,'program',e.program_title,
   'subject_name',e.subject_name,'school',e.school_name,'expired_at',e.expires_at)
   order by e.expires_at,e.campaign_id),'[]'::jsonb) into v_items
 from private.feedback_expired_for_manager(v_row.manager_user_id,p_now) e;

 if v_manager_email is null or v_manager_name is null
   or coalesce(cardinality(v_admin_emails),0)=0 or jsonb_array_length(v_items)=0 then
   update private.feedback_expiry_weekly_outbox set status='skipped',updated_at=now(),
     error_code='no_eligible_items_or_recipient' where id=p_id;
   return jsonb_build_object('ready',false);
 end if;

 -- Record "possibly sent" before any external request so ambiguous deliveries are never resent.
 update private.feedback_expiry_weekly_outbox set status='unknown',graph_started_at=now(),
   updated_at=now(),item_count=jsonb_array_length(v_items) where id=p_id;

 return jsonb_build_object(
   'ready',true,'to_name',v_manager_name,'to_email',v_manager_email,
   'cc_emails',to_jsonb(v_admin_emails),'items',v_items,
   'count',jsonb_array_length(v_items)
 );
end
$fn$;
revoke all on function public.feedback_expiry_weekly_begin(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.feedback_expiry_weekly_begin(uuid,uuid,timestamptz) to service_role;
notify pgrst,'reload schema';

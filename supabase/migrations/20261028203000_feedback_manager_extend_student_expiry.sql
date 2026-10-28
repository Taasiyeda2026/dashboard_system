-- Activity managers may extend expired anonymous student campaigns for their own activities.
-- Keep previously submitted anonymous student responses and the existing public token.
-- Managers can view all results, but changes are scoped to their assigned activities.
create or replace function public.feedback_manager_extend_student_expiry(
  p_campaign_id uuid,
  p_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_campaign public.feedback_campaigns%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'feedback_forbidden' using errcode = '42501';
  end if;

  select * into v_campaign
    from public.feedback_campaigns
   where id = p_campaign_id
   for update;
  if not found then
    raise exception 'feedback_campaign_not_found';
  end if;

  if v_campaign.audience <> 'student'
     or v_campaign.activity_row_id is null
     or v_campaign.status <> 'active'
     or v_campaign.expires_at is null
     or v_campaign.expires_at > now() then
    raise exception 'feedback_expiry_not_eligible';
  end if;

  if p_expires_at is null
     or p_expires_at <= now()
     or p_expires_at <= v_campaign.opens_at then
    raise exception 'feedback_invalid_window';
  end if;

  if not private.feedback_can_share_staff_activity(v_campaign.activity_row_id)
     or not exists (
       select 1 from public.activities a
       where a.row_id = v_campaign.activity_row_id
         and a.start_date is not null
         and a.instructor_assignment_locked is true
         and (a.emp_id is not null or nullif(btrim(a.emp_id_2), '') is not null)
         and a.activity_season = v_campaign.academic_year
     ) then
    raise exception 'feedback_forbidden' using errcode = '42501';
  end if;

  update public.feedback_campaigns
     set expires_at = p_expires_at,
         updated_at = now()
   where id = v_campaign.id;

  return jsonb_build_object(
    'updated',true,
    'campaign_id',v_campaign.id,
    'expires_at',p_expires_at
  );
end
$fn$;

revoke all on function public.feedback_manager_extend_student_expiry(uuid,timestamptz) from public,anon;
grant execute on function public.feedback_manager_extend_student_expiry(uuid,timestamptz) to authenticated;
notify pgrst, 'reload schema';

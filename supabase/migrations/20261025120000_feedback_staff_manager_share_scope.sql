-- Scoped educational-staff feedback sharing for activity managers.
-- Keep template editing, student/instructor campaigns, closing and expiry admin-only.
-- An activity manager can act only for activities assigned by name in activities.
-- This reuses existing campaign/recipient creation and token rotation rules.
-- The automated staff email service is unchanged and no email is sent here.

create or replace function private.feedback_can_share_staff_activity(p_activity_row_id text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.activities a
    join public.users u on u.auth_user_id = (select auth.uid())
    where a.row_id = p_activity_row_id
      and u.is_active is true
      and u.role = 'activities_manager'
      and nullif(btrim(coalesce(a.activity_manager, '')), '') is not null
      and coalesce(nullif(btrim(u.full_name), ''), nullif(btrim(u.name), ''), nullif(btrim(u.username), '')) is not null
      and lower(regexp_replace(btrim(a.activity_manager), '[[:space:]]+', ' ', 'g'))
        = lower(regexp_replace(btrim(coalesce(
            nullif(btrim(u.full_name), ''),
            nullif(btrim(u.name), ''),
            nullif(btrim(u.username), '')
          )), '[[:space:]]+', ' ', 'g'))
  );
$$;
revoke all on function private.feedback_can_share_staff_activity(text) from public, anon;
grant execute on function private.feedback_can_share_staff_activity(text) to authenticated;

create or replace function private.feedback_can_share_staff_campaign(p_campaign_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.feedback_campaigns c
    where c.id = p_campaign_id
      and c.audience = 'educational_staff'
      and private.feedback_can_share_staff_activity(c.activity_row_id)
  );
$$;
revoke all on function private.feedback_can_share_staff_campaign(uuid) from public, anon;
grant execute on function private.feedback_can_share_staff_campaign(uuid) to authenticated;

-- Patch only the authorization predicate of the two existing SECURITY DEFINER
-- functions; preserve their mature validations and exact campaign lifecycle.
-- Fail closed if a future schema version changes either original guard.
do $staff_share_guards$
declare
  old_guard text := 'if not private.feedback_is_admin() then raise exception ''feedback_forbidden'' using errcode = ''42501''; end if;';
  definition text;
  fn regprocedure;
begin
  fn := to_regprocedure('public.feedback_admin_open_campaign(text,text,text,timestamptz,timestamptz,text)');
  if fn is null then raise exception 'feedback_staff_share_missing_open_rpc'; end if;
  definition := pg_get_functiondef(fn);
  if position(old_guard in definition) = 0 then
    raise exception 'feedback_staff_share_open_guard_changed';
  end if;
  execute replace(
    definition, old_guard,
    'if not private.feedback_is_admin() and not (p_audience = ''educational_staff'' and private.feedback_can_share_staff_activity(p_activity_row_id)) then raise exception ''feedback_forbidden'' using errcode = ''42501''; end if;'
  );

  fn := to_regprocedure('public.feedback_admin_update_campaign(uuid,text,timestamptz,timestamptz,text)');
  if fn is null then raise exception 'feedback_staff_share_missing_update_rpc'; end if;
  definition := pg_get_functiondef(fn);
  if position(old_guard in definition) = 0 then
    raise exception 'feedback_staff_share_update_guard_changed';
  end if;
  execute replace(
    definition, old_guard,
    'if not private.feedback_is_admin() and not (p_action = ''mark_shared'' and p_channel in (''whatsapp'', ''email'', ''copy'') and private.feedback_can_share_staff_campaign(p_campaign_id)) then raise exception ''feedback_forbidden'' using errcode = ''42501''; end if;'
  );
end
$staff_share_guards$;

-- The change must never turn template authoring or other feedback writes into
-- manager features. Only the staff branch of the two RPCs above is extended.
notify pgrst, 'reload schema';

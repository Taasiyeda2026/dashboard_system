-- Student feedback share links are visible only to admins or the activity's assigned manager.
-- Existing educational-staff/instructor behavior and campaign editing privileges are unchanged.
-- public.feedback_admin_groups is SECURITY DEFINER and serves read-only results viewers;
-- redact the bearer public_token for student campaigns that a viewer cannot share.

do $student_share_scope$
declare
  definition text;
  original_expr constant text :=
    'jsonb_agg(private.feedback_campaign_json(c.id) order by c.audience, c.stage)';
  restricted_expr constant text := $replacement$
jsonb_agg(
        case
          when c.audience = 'student'
            and not (
              private.feedback_is_admin()
              or private.feedback_can_share_staff_activity(s.row_id)
            )
          then private.feedback_campaign_json(c.id) - 'public_token'
          else private.feedback_campaign_json(c.id)
        end
        order by c.audience, c.stage
      )$replacement$;
begin
  definition := pg_get_functiondef('public.feedback_admin_groups(text,text)'::regprocedure);
  if position(original_expr in definition) = 0 then
    raise exception 'feedback_student_share_groups_guard_changed';
  end if;
  execute replace(definition, original_expr, restricted_expr);
end;
$student_share_scope$;

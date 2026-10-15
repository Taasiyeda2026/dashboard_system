-- Reconcile the retained trusted stored-planning transition check with
-- the approved v38 automatic limit (<=30 km). Manual 30..45 km transitions
-- remain EXCEPTION ONLY under separate manager-approval RPCs; >45 forbidden.
-- This is a precise, one-occurrence replacement of the pre-existing 20km
-- v37 legacy guard. Do not widen route/time verification.
do $policy$
declare
  fn regprocedure := 'public.scheduling_v37_workspace_validation(uuid,jsonb)'::regprocedure;
  src text;
  old_guard text := 't.distance_km > 20';
  new_guard text := 't.distance_km > 30';
begin
  src := pg_get_functiondef(fn);
  if (length(src)-length(replace(src,old_guard,'')))/length(old_guard) <> 1
  then raise exception 'stored_planning_transfer_guard_source_changed'; end if;
  execute replace(src, old_guard, new_guard);
end
$policy$;

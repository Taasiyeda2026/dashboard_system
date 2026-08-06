-- A proposal transferred into Israa's tracking table always starts as "נשלחה".
-- The proposal's own approval status must not automatically approve the tracking row.
-- Existing manually maintained tracking statuses are preserved on refresh.

do $migration$
declare
  v_definition text;
  v_original text;
begin
  select pg_get_functiondef('public.create_israa_tracking_from_proposal(uuid)'::regprocedure)
  into v_definition;

  v_original := v_definition;

  v_definition := replace(
    v_definition,
$old_status$
  v_tracking_status := case
    when lower(btrim(coalesce(v_proposal.status, ''))) in ('approved', 'מאושר', 'מאושר וחתום') then 'אושרה'
    else 'נשלחה'
  end;
$old_status$,
$new_status$
  v_tracking_status := 'נשלחה';
$new_status$
  );

  v_definition := replace(
    v_definition,
$old_upsert$
    status = case
      when nullif(btrim(coalesce(current_row.status, '')), '') is null then excluded.status
      when current_row.status = 'נשלחה' and excluded.status = 'אושרה' then 'אושרה'
      else current_row.status
    end,
$old_upsert$,
$new_upsert$
    status = case
      when nullif(btrim(coalesce(current_row.status, '')), '') is null then excluded.status
      else current_row.status
    end,
$new_upsert$
  );

  if v_definition = v_original then
    raise exception 'create_israa_tracking_from_proposal definition did not match expected status logic';
  end if;

  if position('then ''אושרה''' in v_definition) > 0
     or position('excluded.status = ''אושרה''' in v_definition) > 0 then
    raise exception 'approved status logic still exists in create_israa_tracking_from_proposal';
  end if;

  execute v_definition;
end
$migration$;

comment on function public.create_israa_tracking_from_proposal(uuid) is
  'Creates or refreshes one Israa tracking row for a domain E proposal. A newly transferred proposal always starts with status נשלחה; later manual tracking statuses are preserved.';

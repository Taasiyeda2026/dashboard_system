-- Preserve instructor-entered kilometers on same-location between legs.
-- Default to 0 only when kilometers are missing/non-numeric.
-- Staged — do not apply to production without explicit approval.
-- No rate, payroll formula, or historical data changes.

do $patch$
declare
  def text;
  patched text;
  old_snip text := $old$        if coalesce(v_same_location,false) then
          v_item:=jsonb_set(v_item,'{kilometers}','0'::jsonb,true);
        end if;$old$;
  new_snip text := $new$        if coalesce(v_same_location,false)
           and jsonb_typeof(v_item->'kilometers') is distinct from 'number' then
          v_item:=jsonb_set(v_item,'{kilometers}','0'::jsonb,true);
        end if;$new$;
begin
  select pg_get_functiondef('public.av2_save_daily_travel(date,jsonb,boolean)'::regprocedure)
    into def;
  if def is null then
    raise exception 'av2_save_daily_travel_missing';
  end if;
  if strpos(def, new_snip) > 0 then
    raise notice 'av2_save_daily_travel already preserves same-location kilometers';
    return;
  end if;
  if strpos(def, old_snip) = 0 then
    raise exception 'av2_save_daily_travel_unexpected_body';
  end if;
  patched := replace(def, old_snip, new_snip);
  execute patched;
end;
$patch$;

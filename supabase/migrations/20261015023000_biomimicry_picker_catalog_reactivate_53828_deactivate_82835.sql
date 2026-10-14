-- Fix activity PICKER catalog only. Do not rewrite or reschedule any existing
-- activity: legacy 82835 is ambiguous (42 primary / 1 secondary / 6 no grade).
-- Canonical: primary Biomimicry = 6089, secondary Biomimicry = 53828.
create table if not exists private.biomimicry_activity_choice_audit (
  adjustment_key text primary key,
  recorded_at timestamptz not null default now(),
  old_catalog_rows jsonb not null,
  new_catalog_rows jsonb not null
);
revoke all on private.biomimicry_activity_choice_audit from public, anon, authenticated;

do $fix$
declare
  n integer;
begin
  if exists (select 1 from private.biomimicry_activity_choice_audit
             where adjustment_key='biomimicry-catalog-6089-53828-20261015') then
    raise exception 'Already updated biomimicry picker catalog';
  end if;
  perform 1 from public.lists where list_id in (28,29,378) for update;
  select count(*) into n from public.lists
  where (list_id=28 and category='activity_names' and activity_no='6089' and active=true and is_active=true)
     or (list_id=29 and category='activity_names' and activity_no='53828' and active=false and is_active=false)
     or (list_id=378 and category='activity_names' and activity_no='82835' and active=true and is_active=true);
  if n<>3 then
    raise exception 'Catalog state differs from verified 6089 / 53828 / 82835 state (% valid rows)', n;
  end if;
  insert into private.biomimicry_activity_choice_audit (adjustment_key,old_catalog_rows,new_catalog_rows)
  select 'biomimicry-catalog-6089-53828-20261015',
         jsonb_agg(to_jsonb(l) order by l.list_id),
         '[]'::jsonb
  from public.lists l where l.list_id in (28,29,378);
  update public.lists set active=true,is_active=true where list_id=29 and activity_no='53828';
  update public.lists set active=false,is_active=false where list_id=378 and activity_no='82835';
  update private.biomimicry_activity_choice_audit a
    set new_catalog_rows = (select jsonb_agg(to_jsonb(l) order by l.list_id)
                            from public.lists l where l.list_id in (28,29,378))
  where a.adjustment_key='biomimicry-catalog-6089-53828-20261015';
  if exists (select 1 from public.lists l where (l.list_id=28 and (l.active is not true or l.is_active is not true))
      or (l.list_id=29 and (l.active is not true or l.is_active is not true))
      or (l.list_id=378 and (l.active is not false or l.is_active is not false))) then
    raise exception 'Unexpected final picker state';
  end if;
end
$fix$;

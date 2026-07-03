alter table public.lists
  add column if not exists is_active boolean not null default true;

-- Backfill the new boolean flag from legacy text columns when they exist.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lists'
      and column_name = 'active'
  ) then
    update public.lists
    set is_active = false
    where lower(trim(coalesce(active::text, ''))) in ('false', '0', 'no', 'n', 'inactive', 'לא', 'לא פעיל', 'כבוי');
  end if;
end $$;

create index if not exists lists_category_is_active_idx
  on public.lists(category, is_active);

-- Independent 2027 workshop inventory opening balances.
-- Opening stock for 2027 is fixed seed data and must not be derived from 2026 closing balances.

create table if not exists public.workshop_inventory_opening_balances (
  id uuid primary key default gen_random_uuid(),
  inventory_year integer not null,
  activity_season text not null,
  stock_group_key text not null,
  workshop_numbers text not null,
  workshop_name text not null,
  holder_name text not null,
  holder_type text not null,
  opening_quantity integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workshop_inventory_opening_balances_year_check
    check (inventory_year >= 2026),
  constraint workshop_inventory_opening_balances_qty_check
    check (opening_quantity >= 0),
  constraint workshop_inventory_opening_balances_holder_type_check
    check (holder_type in ('stock_location', 'instructor')),
  constraint workshop_inventory_opening_balances_unique_holder
    unique (inventory_year, stock_group_key, holder_name)
);

create index if not exists workshop_inventory_opening_balances_year_idx
  on public.workshop_inventory_opening_balances (inventory_year);

create index if not exists workshop_inventory_opening_balances_year_group_idx
  on public.workshop_inventory_opening_balances (inventory_year, stock_group_key);

alter table public.workshop_inventory_opening_balances enable row level security;

drop policy if exists workshop_inventory_opening_balances_select_authenticated
  on public.workshop_inventory_opening_balances;
create policy workshop_inventory_opening_balances_select_authenticated
on public.workshop_inventory_opening_balances
for select
to authenticated
using (true);

drop policy if exists workshop_inventory_opening_balances_insert_ops
  on public.workshop_inventory_opening_balances;
create policy workshop_inventory_opening_balances_insert_ops
on public.workshop_inventory_opening_balances
for insert
to authenticated
with check ((select public.app_is_admin_or_operation_manager()));

drop policy if exists workshop_inventory_opening_balances_update_ops
  on public.workshop_inventory_opening_balances;
create policy workshop_inventory_opening_balances_update_ops
on public.workshop_inventory_opening_balances
for update
to authenticated
using ((select public.app_is_admin_or_operation_manager()))
with check ((select public.app_is_admin_or_operation_manager()));

drop policy if exists workshop_inventory_opening_balances_delete_ops
  on public.workshop_inventory_opening_balances;
create policy workshop_inventory_opening_balances_delete_ops
on public.workshop_inventory_opening_balances
for delete
to authenticated
using ((select public.app_is_admin_or_operation_manager()));

revoke all on public.workshop_inventory_opening_balances from public;
revoke all on public.workshop_inventory_opening_balances from anon;
grant select on public.workshop_inventory_opening_balances to authenticated;
grant insert, update, delete on public.workshop_inventory_opening_balances to authenticated;

-- Seed only positive opening quantities for inventory_year = 2027.
insert into public.workshop_inventory_opening_balances (
  inventory_year,
  activity_season,
  stock_group_key,
  workshop_numbers,
  workshop_name,
  holder_name,
  holder_type,
  opening_quantity
)
values
  (2027, 'school_2027', 'activity_1', '001', 'אסטרונאוט על חוטים', 'מלאי עידן', 'stock_location', 20),
  (2027, 'school_2027', 'activity_1', '001', 'אסטרונאוט על חוטים', 'מלאי הילה', 'stock_location', 50),
  (2027, 'school_2027', 'activity_1', '001', 'אסטרונאוט על חוטים', 'מלאי גיל', 'stock_location', 50),
  (2027, 'school_2027', 'activity_1', '001', 'אסטרונאוט על חוטים', 'אילנה טיטייבסקי', 'instructor', 25),
  (2027, 'school_2027', 'activity_1', '001', 'אסטרונאוט על חוטים', 'אלכס זפקה', 'instructor', 30),
  (2027, 'school_2027', 'activity_1', '001', 'אסטרונאוט על חוטים', 'אפרת אוחיון', 'instructor', 30),
  (2027, 'school_2027', 'activity_1', '001', 'אסטרונאוט על חוטים', 'הנאא אבו אמזה', 'instructor', 15),
  (2027, 'school_2027', 'activity_1', '001', 'אסטרונאוט על חוטים', 'כרמית סמנדרוב', 'instructor', 80),
  (2027, 'school_2027', 'activity_2', '002', 'מעבורת חלל', 'מלאי הילה', 'stock_location', 30),
  (2027, 'school_2027', 'activity_6', '006', 'קלידוסקופ', 'מלאי הילה', 'stock_location', 60),
  (2027, 'school_2027', 'activity_6', '006', 'קלידוסקופ', 'מלאי גיל', 'stock_location', 80),
  (2027, 'school_2027', 'activity_8', '008', 'נשכן מפרקים', 'אייל יוחאי', 'instructor', 10),
  (2027, 'school_2027', 'activity_8', '008', 'נשכן מפרקים', 'אילנה טיטייבסקי', 'instructor', 23),
  (2027, 'school_2027', 'activity_8', '008', 'נשכן מפרקים', 'איתמר יוחאי', 'instructor', 33),
  (2027, 'school_2027', 'activity_8', '008', 'נשכן מפרקים', 'הנאא אבו אמזה', 'instructor', 48),
  (2027, 'school_2027', 'activity_9', '009', 'פרוגי המקפצת', 'אילנה טיטייבסקי', 'instructor', 4),
  (2027, 'school_2027', 'activity_9', '009', 'פרוגי המקפצת', 'איתמר יוחאי', 'instructor', 17),
  (2027, 'school_2027', 'activity_9', '009', 'פרוגי המקפצת', 'הנאא אבו אמזה', 'instructor', 60),
  (2027, 'school_2027', 'activity_10', '010', 'מכונית מגנטית', 'מלאי הילה', 'stock_location', 125),
  (2027, 'school_2027', 'activity_10', '010', 'מכונית מגנטית', 'אילנה טיטייבסקי', 'instructor', 8),
  (2027, 'school_2027', 'activity_10', '010', 'מכונית מגנטית', 'אלכס זפקה', 'instructor', 60),
  (2027, 'school_2027', 'activity_11', '011', 'ציפור שיווי משקל', 'מלאי הילה', 'stock_location', 113),
  (2027, 'school_2027', 'activity_11', '011', 'ציפור שיווי משקל', 'מלאי גיל', 'stock_location', 14),
  (2027, 'school_2027', 'activity_11', '011', 'ציפור שיווי משקל', 'אלכס זפקה', 'instructor', 16),
  (2027, 'school_2027', 'activity_11', '011', 'ציפור שיווי משקל', 'הנאא אבו אמזה', 'instructor', 60),
  (2027, 'school_2027', 'activity_13', '013', 'חללית בראשית', 'מלאי עידן', 'stock_location', 15),
  (2027, 'school_2027', 'activity_13', '013', 'חללית בראשית', 'אלדר מיכאל טייב', 'instructor', 14),
  (2027, 'school_2027', 'activity_16', '016', 'כדור מולקולה', 'מלאי הילה', 'stock_location', 49),
  (2027, 'school_2027', 'activity_16', '016', 'כדור מולקולה', 'מלאי גיל', 'stock_location', 28),
  (2027, 'school_2027', 'activity_16', '016', 'כדור מולקולה', 'אייל יוחאי', 'instructor', 6),
  (2027, 'school_2027', 'activity_16', '016', 'כדור מולקולה', 'אלדר מיכאל טייב', 'instructor', 20),
  (2027, 'school_2027', 'activity_16', '016', 'כדור מולקולה', 'הנאא אבו אמזה', 'instructor', 11),
  (2027, 'school_2027', 'activity_20', '020', 'גשר לאונרדו', 'מלאי הילה', 'stock_location', 6),
  (2027, 'school_2027', 'activity_20', '020', 'גשר לאונרדו', 'מלאי גיל', 'stock_location', 30),
  (2027, 'school_2027', 'activity_20', '020', 'גשר לאונרדו', 'הנאא אבו אמזה', 'instructor', 25),
  (2027, 'school_2027', 'kofet_kesem', '029, 024', 'קופת קסם (ד׳-ו׳)', 'מלאי הילה', 'stock_location', 24),
  (2027, 'school_2027', 'kofet_kesem', '029, 024', 'קופת קסם (ד׳-ו׳)', 'אייל יוחאי', 'instructor', 4),
  (2027, 'school_2027', 'kofet_kesem', '029, 024', 'קופת קסם (ד׳-ו׳)', 'אילנה טיטייבסקי', 'instructor', 12),
  (2027, 'school_2027', 'kofet_kesem', '029, 024', 'קופת קסם (ד׳-ו׳)', 'אלדר מיכאל טייב', 'instructor', 15),
  (2027, 'school_2027', 'kofet_kesem', '029, 024', 'קופת קסם (ד׳-ו׳)', 'אלכס זפקה', 'instructor', 51),
  (2027, 'school_2027', 'kofet_kesem', '029, 024', 'קופת קסם (ד׳-ו׳)', 'הנאא אבו אמזה', 'instructor', 25),
  (2027, 'school_2027', 'activity_26', '026', 'יוסי התוכי', 'מלאי עידן', 'stock_location', 200),
  (2027, 'school_2027', 'gitara', '038, 030', 'הגיטרה הראשונה שלי', 'מלאי הילה', 'stock_location', 159),
  (2027, 'school_2027', 'gitara', '038, 030', 'הגיטרה הראשונה שלי', 'מלאי גיל', 'stock_location', 19),
  (2027, 'school_2027', 'gitara', '038, 030', 'הגיטרה הראשונה שלי', 'אייל יוחאי', 'instructor', 17),
  (2027, 'school_2027', 'gitara', '038, 030', 'הגיטרה הראשונה שלי', 'אלכס זפקה', 'instructor', 19),
  (2027, 'school_2027', 'shaon_robot', '032, 031', 'שעון רובוט - הזמן שלנו', 'מלאי הילה', 'stock_location', 31),
  (2027, 'school_2027', 'shaon_robot', '032, 031', 'שעון רובוט - הזמן שלנו', 'מלאי גיל', 'stock_location', 22),
  (2027, 'school_2027', 'shaon_robot', '032, 031', 'שעון רובוט - הזמן שלנו', 'אילנה טיטייבסקי', 'instructor', 10),
  (2027, 'school_2027', 'shaon_robot', '032, 031', 'שעון רובוט - הזמן שלנו', 'איתמר יוחאי', 'instructor', 11),
  (2027, 'school_2027', 'shaon_robot', '032, 031', 'שעון רובוט - הזמן שלנו', 'אלדר מיכאל טייב', 'instructor', 28),
  (2027, 'school_2027', 'shaon_robot', '032, 031', 'שעון רובוט - הזמן שלנו', 'אלכס זפקה', 'instructor', 17),
  (2027, 'school_2027', 'activity_34', '034', 'מערכת השמש', 'מלאי עידן', 'stock_location', 30),
  (2027, 'school_2027', 'activity_34', '034', 'מערכת השמש', 'אלכס זפקה', 'instructor', 32),
  (2027, 'school_2027', 'activity_34', '034', 'מערכת השמש', 'הנאא אבו אמזה', 'instructor', 30),
  (2027, 'school_2027', 'activity_35', '035', 'טיל ואסטרונאוט אוויר', 'מלאי עידן', 'stock_location', 200),
  (2027, 'school_2027', 'activity_35', '035', 'טיל ואסטרונאוט אוויר', 'מלאי הילה', 'stock_location', 40),
  (2027, 'school_2027', 'activity_40', '040', 'מסלול מכונית מגנטית', 'מלאי הילה', 'stock_location', 20),
  (2027, 'school_2027', 'activity_40', '040', 'מסלול מכונית מגנטית', 'אייל יוחאי', 'instructor', 23),
  (2027, 'school_2027', 'activity_40', '040', 'מסלול מכונית מגנטית', 'איתמר יוחאי', 'instructor', 13),
  (2027, 'school_2027', 'activity_15', '015', 'טלסקופ קפלר', 'מלאי גיל', 'stock_location', 25),
  (2027, 'school_2027', 'activity_15', '015', 'טלסקופ קפלר', 'אלכס זפקה', 'instructor', 29),
  (2027, 'school_2027', 'activity_23', '023', 'ספינר', 'מלאי גיל', 'stock_location', 80),
  (2027, 'school_2027', 'activity_21', '021', 'קטפולטה', 'מלאי גיל', 'stock_location', 80),
  (2027, 'school_2027', 'activity_12', '012', 'גלגל הקסם', 'מלאי גיל', 'stock_location', 10)
on conflict (inventory_year, stock_group_key, holder_name) do update
set
  activity_season = excluded.activity_season,
  workshop_numbers = excluded.workshop_numbers,
  workshop_name = excluded.workshop_name,
  holder_type = excluded.holder_type,
  opening_quantity = excluded.opening_quantity,
  updated_at = now();

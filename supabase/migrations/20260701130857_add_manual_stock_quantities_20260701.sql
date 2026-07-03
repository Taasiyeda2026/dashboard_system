insert into workshop_stock_distributions (id, stock_group_key, instructor_name, quantity_received, period_start, period_end, notes, created_at, updated_at)
values
  (gen_random_uuid(), 'activity_010', 'central_stock', 155, date '2026-06-15', date '2026-09-01', 'manual stock addition 2026-07-01', now(), now()),
  (gen_random_uuid(), 'activity_009', 'central_stock', 100, date '2026-06-15', date '2026-09-01', 'manual stock addition 2026-07-01', now(), now()),
  (gen_random_uuid(), 'kofet_kesem', 'central_stock', 75, date '2026-06-15', date '2026-09-01', 'manual stock addition 2026-07-01', now(), now()),
  (gen_random_uuid(), 'activity_008', 'central_stock', 100, date '2026-06-15', date '2026-09-01', 'manual stock addition 2026-07-01', now(), now())
on conflict (stock_group_key, instructor_name, period_start)
do update set quantity_received = coalesce(workshop_stock_distributions.quantity_received, 0) + excluded.quantity_received, updated_at = now();

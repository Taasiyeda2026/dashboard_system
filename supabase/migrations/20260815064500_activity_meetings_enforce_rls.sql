-- Production already has RLS enabled on activity_meetings. Keep that security
-- requirement explicit in tracked migrations so fresh environments cannot rely
-- on out-of-band database state before the direct-editor write policies apply.

alter table public.activity_meetings enable row level security;

-- Evaluate the scheduling capability once per statement instead of once per travel-cache row.
-- Authorization semantics are unchanged: authenticated users still need view_operations_scheduling.

alter policy scheduling_travel_cache_authorized_read
  on public.scheduling_travel_cache
  using ((select public.app_has_permission('view_operations_scheduling')));

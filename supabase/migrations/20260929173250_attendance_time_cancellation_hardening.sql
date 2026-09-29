-- Harden attendance travel-cancellation trigger functions and index scheduled training linkage.

revoke execute on function public.av2_mark_source_travel_pending_trigger() from public, anon, authenticated;
revoke execute on function public.av2_sync_generated_cancellation_date() from public, anon, authenticated;

create index if not exists attendance_records_training_schedule_id_idx
  on public.attendance_records(training_schedule_id)
  where training_schedule_id is not null;

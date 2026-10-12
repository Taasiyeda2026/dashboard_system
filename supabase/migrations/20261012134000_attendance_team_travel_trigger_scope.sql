-- Preserve the original non-team travel update behavior: team-only travel edits
-- revalidate online travel, without recomputing unrelated activity addresses.
DROP TRIGGER IF EXISTS av2_sync_operation_destination_address ON public.attendance_records;
CREATE TRIGGER av2_sync_operation_destination_address
  BEFORE INSERT OR UPDATE OF activity_type, activity_name_snapshot, operation_meeting_mode, destination_address_snapshot
  ON public.attendance_records
  FOR EACH ROW
  EXECUTE FUNCTION public.av2_sync_operation_destination_address();

DROP TRIGGER IF EXISTS av2_sync_team_operation_travel ON public.attendance_records;
CREATE TRIGGER av2_sync_team_operation_travel
  BEFORE UPDATE OF roundtrip_km, public_transport, public_transport_cost
  ON public.attendance_records
  FOR EACH ROW
  WHEN (new.activity_type = 'תפעול' AND btrim(coalesce(new.activity_name_snapshot, '')) = 'צוות')
  EXECUTE FUNCTION public.av2_sync_operation_destination_address();

-- Enable instructor team meetings (Zoom or a physical address) without changing own-record RLS.
ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS operation_meeting_mode text;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.attendance_records'::regclass
      AND conname = 'attendance_team_meeting_mode_check'
  ) THEN
    ALTER TABLE public.attendance_records
      ADD CONSTRAINT attendance_team_meeting_mode_check
      CHECK (operation_meeting_mode IS NULL OR
        (activity_type = 'תפעול' AND btrim(coalesce(activity_name_snapshot, '')) = 'צוות'
          AND operation_meeting_mode IN ('online', 'physical')));
  END IF;
END $$;

INSERT INTO public.attendance_operation_options (label, active, sort_order, is_other, address)
SELECT 'צוות', true, 30, false, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.attendance_operation_options WHERE btrim(label) = 'צוות'
);

CREATE OR REPLACE FUNCTION public.av2_sync_operation_destination_address()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  operation_address text;
  scheduled_training public.instructor_training_schedule%rowtype;
  normalized_type text;
  normalized_name text;
begin
  if new.generation_kind is not null then return new; end if;

  normalized_type := regexp_replace(lower(btrim(coalesce(new.activity_type, ''))), '\s+', '', 'g');
  normalized_name := regexp_replace(lower(btrim(coalesce(new.activity_name_snapshot, ''))), '\s+', '', 'g');
  if normalized_type <> 'תפעול' then new.operation_meeting_mode := null; end if;

  if normalized_type = 'הכשרה' and new.training_schedule_id is not null then
    select * into scheduled_training
    from public.instructor_training_schedule t
    where t.id = new.training_schedule_id
      and t.is_active = true
      and t.training_date = new.report_date
      and (t.emp_id = new.emp_id or t.participant_scope = 'open');
    if not found then
      raise exception 'attendance_training_schedule_invalid' using errcode = '42501';
    end if;
    new.training_mode := case when scheduled_training.is_online then 'online' else 'physical' end;
    new.authority_id := null;
    new.authority_name_snapshot := case
      when scheduled_training.is_online then null
      else nullif(btrim(scheduled_training.location_name), '')
    end;
    new.school_id := null;
    new.school_name_snapshot := null;
    new.semel_mosad := null;
    if scheduled_training.is_online then
      new.roundtrip_km := 0;
      new.public_transport := false;
      new.public_transport_cost := 0;
    end if;
    new.destination_address_snapshot := case
      when scheduled_training.is_online then null
      else nullif(btrim(scheduled_training.location_address), '')
    end;
  elsif normalized_type = 'הכשרה' and new.training_mode = 'online' then
    new.roundtrip_km := 0;
    new.public_transport := false;
    new.public_transport_cost := 0;
    new.authority_id := null;
    new.authority_name_snapshot := null;
    new.school_id := null;
    new.school_name_snapshot := null;
    new.semel_mosad := null;
    new.destination_address_snapshot := null;
  elsif normalized_type = 'תפעול' then
    if normalized_name = 'צוות' then
      if new.operation_meeting_mode is null or new.operation_meeting_mode not in ('online', 'physical') then
        raise exception 'attendance_team_meeting_mode_required' using errcode = '23514';
      end if;
      if new.operation_meeting_mode = 'online' then
        new.destination_address_snapshot := null;
        new.roundtrip_km := 0;
        new.public_transport := false;
        new.public_transport_cost := 0;
      else
        new.destination_address_snapshot := nullif(btrim(new.destination_address_snapshot), '');
        if new.destination_address_snapshot is null then
          raise exception 'attendance_team_physical_location_required' using errcode = '23514';
        end if;
      end if;
    else
      new.operation_meeting_mode := null;
      select nullif(btrim(o.address), '') into operation_address
      from public.attendance_operation_options o
      where lower(btrim(o.label)) = lower(btrim(coalesce(new.activity_name_snapshot, '')))
      limit 1;
      new.destination_address_snapshot := operation_address;
    end if;
  elsif normalized_type = 'הכשרה'
    and normalized_name = regexp_replace(lower('הכשרת בסיס'), '\s+', '', 'g') then
    new.destination_address_snapshot := '6RVR+XM, יקום';
  else
    new.destination_address_snapshot := null;
  end if;
  return new;
end $function$;

DROP TRIGGER IF EXISTS av2_sync_operation_destination_address ON public.attendance_records;
CREATE TRIGGER av2_sync_operation_destination_address
BEFORE INSERT OR UPDATE OF activity_type, activity_name_snapshot, operation_meeting_mode, destination_address_snapshot
ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.av2_sync_operation_destination_address();

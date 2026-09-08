-- Fix Attendance V2 travel fingerprint hashing in Supabase where pgcrypto is installed
-- in the extensions schema. Keep the SECURITY DEFINER function's search path explicit.
alter function public.av2_attendance_travel_context(uuid, uuid)
  set search_path = public, extensions;

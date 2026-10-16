-- Separate approved GPS points from original school and instructor address fields.
CREATE TABLE IF NOT EXISTS public.scheduling_route_approved_points (
 entity_key text PRIMARY KEY,
 latitude double precision NOT NULL CHECK (latitude >= 29 AND latitude <= 34),
 longitude double precision NOT NULL CHECK (longitude >= 34 AND longitude <= 36),
 approval_source text NOT NULL DEFAULT 'user_confirmed',
 location_accuracy text NOT NULL CHECK (location_accuracy IN ('school_area','settlement_center','maps_plus_code')),
 note text,
 confirmed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.scheduling_route_approved_points ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scheduling_route_approved_points FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.scheduling_route_approved_points TO service_role;
-- Approved by the operator on 2026-10-16, without modifying school or instructor source address fields.
INSERT INTO public.scheduling_route_approved_points(entity_key, latitude, longitude, location_accuracy, note) VALUES
('school_id:3537',31.696181,34.706579,'settlement_center','T T Shapir: operator-approved town-center routing anchor'),
('school_id:2212',32.6841,35.0352,'school_area','Ofek: Halab street area'),
('school_id:2346',32.6795,35.0391,'school_area','Al Ain: Yad Labanim area'),
('school_id:2366',32.6820,35.0325,'school_area','Al Masar: Al Madrasa area'),
('school_id:3502',31.7006875,34.7126875,'maps_plus_code','Shapir school PP27+73 map pin supplied by operator'),
('school_id:74',31.6984375,34.7085625,'maps_plus_code','Or Etzion MPX5+9C map pin supplied by operator'),
('instructor:1540',32.6935625,35.0469375,'settlement_center','Approved Daliyat Al-Karmel center point M2VW+CQ instead of instructor home address')
ON CONFLICT (entity_key) DO UPDATE SET
latitude=excluded.latitude,longitude=excluded.longitude,
location_accuracy=excluded.location_accuracy,note=excluded.note,confirmed_at=now();

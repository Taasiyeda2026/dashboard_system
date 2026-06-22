-- Restored from supabase/migrations/20260607_personal_reports_employee_travel_rates.sql (stable commit 2c772f83).
-- Personal reports: private per-employee km rates and server-side travel amount computation.
-- Rates live in schema private and are not exposed to clients, APIs, or PDFs.

CREATE SCHEMA IF NOT EXISTS private;

-- Remove incomplete public draft if present.
DROP TRIGGER IF EXISTS declared_travel_entries_compute_amount ON public.declared_travel_entries;
DROP FUNCTION IF EXISTS public.compute_declared_travel_entry_amount();
DROP TABLE IF EXISTS public.employee_travel_rates;

CREATE TABLE IF NOT EXISTS private.employee_travel_rates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rate_per_km   numeric(10,4) NOT NULL CHECK (rate_per_km > 0),
  valid_from    date NOT NULL DEFAULT '2026-01-01',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, valid_from)
);

CREATE TABLE IF NOT EXISTS private.declared_travel_rate_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL,
  rate_per_km   numeric(10,4) NOT NULL,
  valid_from    date NOT NULL,
  action        text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  changed_by    uuid,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION private.get_employee_km_rate(
  p_employee_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, public
AS $$
  SELECT rate_per_km
  FROM private.employee_travel_rates
  WHERE employee_id = p_employee_id
    AND valid_from <= p_as_of
  ORDER BY valid_from DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.personal_report_is_editable(p_report_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.personal_reports pr
    WHERE pr.id = p_report_id
      AND pr.employee_id = auth.uid()
      AND pr.status IN ('draft', 'needs_correction')
  );
$$;

CREATE OR REPLACE FUNCTION private.personal_reports_can_manage_travel_rates()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION private.compute_declared_travel_entry_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_rate numeric;
BEGIN
  v_rate := private.get_employee_km_rate(NEW.employee_id, NEW.travel_date);
  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'missing_travel_rate';
  END IF;

  NEW.amount := ROUND((NEW.roundtrip_km * v_rate)::numeric, 2);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS declared_travel_entries_compute_amount ON public.declared_travel_entries;

CREATE TRIGGER declared_travel_entries_compute_amount
  BEFORE INSERT OR UPDATE OF roundtrip_km, employee_id, travel_date ON public.declared_travel_entries
  FOR EACH ROW
  EXECUTE FUNCTION private.compute_declared_travel_entry_amount();

CREATE OR REPLACE FUNCTION public.upsert_declared_travel_entry(
  p_id uuid DEFAULT NULL,
  p_report_id uuid DEFAULT NULL,
  p_employee_id uuid DEFAULT NULL,
  p_travel_date date DEFAULT NULL,
  p_origin text DEFAULT '',
  p_destination text DEFAULT '',
  p_description text DEFAULT '',
  p_roundtrip_km numeric DEFAULT 0
)
RETURNS public.declared_travel_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_row public.declared_travel_entries;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_employee_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT private.personal_report_is_editable(p_report_id) THEN
    RAISE EXCEPTION 'report_not_editable';
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.declared_travel_entries
    SET
      report_id = p_report_id,
      employee_id = p_employee_id,
      travel_date = p_travel_date,
      origin = COALESCE(p_origin, ''),
      destination = COALESCE(p_destination, ''),
      description = COALESCE(p_description, ''),
      roundtrip_km = COALESCE(p_roundtrip_km, 0),
      updated_at = now()
    WHERE id = p_id
      AND employee_id = p_employee_id
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found';
    END IF;
  ELSE
    INSERT INTO public.declared_travel_entries (
      report_id,
      employee_id,
      travel_date,
      origin,
      destination,
      description,
      roundtrip_km
    ) VALUES (
      p_report_id,
      p_employee_id,
      p_travel_date,
      COALESCE(p_origin, ''),
      COALESCE(p_destination, ''),
      COALESCE(p_description, ''),
      COALESCE(p_roundtrip_km, 0)
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_employee_travel_rate(
  p_employee_id uuid,
  p_rate_per_km numeric,
  p_valid_from date DEFAULT '2026-01-01'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_action text;
BEGIN
  IF NOT private.personal_reports_can_manage_travel_rates() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.employee_travel_rates
    WHERE employee_id = p_employee_id
      AND valid_from = p_valid_from
  ) THEN
    v_action := 'update';
    UPDATE private.employee_travel_rates
    SET rate_per_km = p_rate_per_km,
        updated_at = now()
    WHERE employee_id = p_employee_id
      AND valid_from = p_valid_from;
  ELSE
    v_action := 'insert';
    INSERT INTO private.employee_travel_rates (employee_id, rate_per_km, valid_from)
    VALUES (p_employee_id, p_rate_per_km, p_valid_from);
  END IF;

  INSERT INTO private.declared_travel_rate_audit (
    employee_id,
    rate_per_km,
    valid_from,
    action,
    changed_by
  ) VALUES (
    p_employee_id,
    p_rate_per_km,
    p_valid_from,
    v_action,
    auth.uid()
  );
END;
$$;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA private FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.upsert_declared_travel_entry(
  uuid, uuid, uuid, date, text, text, text, numeric
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_declared_travel_entry(
  uuid, uuid, uuid, date, text, text, text, numeric
) TO authenticated;

REVOKE ALL ON FUNCTION public.manage_employee_travel_rate(uuid, numeric, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_employee_travel_rate(uuid, numeric, date) TO authenticated;

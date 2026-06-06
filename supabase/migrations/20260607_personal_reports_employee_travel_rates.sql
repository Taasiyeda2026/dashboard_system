-- Private per-employee km reimbursement rates.
-- Amount on declared_travel_entries is computed server-side; rates are not exposed to clients.

CREATE TABLE IF NOT EXISTS public.employee_travel_rates (
  employee_id   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  rate_per_km   numeric(10,4) NOT NULL CHECK (rate_per_km > 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employee_travel_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "etr_admin_all" ON public.employee_travel_rates
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

REVOKE ALL ON TABLE public.employee_travel_rates FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.compute_declared_travel_entry_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate numeric(10,4);
BEGIN
  SELECT rate_per_km INTO v_rate
  FROM public.employee_travel_rates
  WHERE employee_id = NEW.employee_id;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'missing travel rate for employee %', NEW.employee_id;
  END IF;

  NEW.amount := ROUND((NEW.roundtrip_km * v_rate)::numeric, 2);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS declared_travel_entries_compute_amount ON public.declared_travel_entries;

CREATE TRIGGER declared_travel_entries_compute_amount
  BEFORE INSERT OR UPDATE OF roundtrip_km, employee_id ON public.declared_travel_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.compute_declared_travel_entry_amount();

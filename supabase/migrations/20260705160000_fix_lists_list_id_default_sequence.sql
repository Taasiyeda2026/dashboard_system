-- Fix: public.lists.list_id identity sequence is behind the actual max value.
-- The trigger sync_dynamic_dropdown_lists() INSERTs into lists relying on
-- the GENERATED ALWAYS AS IDENTITY sequence to produce the next list_id.
-- When rows were inserted manually with explicit list_id values, the sequence
-- was not advanced, so subsequent auto-generated values collide with existing
-- rows, causing: "duplicate key value violates unique constraint".
--
-- Fix: restart the identity sequence from MAX(list_id) + 1.

DO $$
DECLARE
  v_next bigint;
BEGIN
  SELECT COALESCE(MAX(list_id), 0) + 1
  INTO v_next
  FROM public.lists;

  EXECUTE format(
    'ALTER TABLE public.lists ALTER COLUMN list_id RESTART WITH %s',
    v_next
  );
END $$;

-- Verify (run separately to confirm):
-- SELECT last_value FROM pg_sequences WHERE sequencename LIKE '%lists%';

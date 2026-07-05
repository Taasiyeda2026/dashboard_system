-- Fix: public.lists.list_id lacks a DEFAULT / sequence.
-- The trigger sync_dynamic_dropdown_lists() INSERTs into lists without
-- supplying list_id, which causes every activity-status update to fail.
-- This migration adds a safe sequence and sets it as the column default.

DO $$
DECLARE
  v_next bigint;
BEGIN
  SELECT COALESCE(MAX(list_id), 0) + 1
  INTO v_next
  FROM public.lists;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'lists_list_id_seq'
  ) THEN
    CREATE SEQUENCE public.lists_list_id_seq;
  END IF;

  PERFORM setval('public.lists_list_id_seq', v_next, false);

  ALTER TABLE public.lists
    ALTER COLUMN list_id SET DEFAULT nextval('public.lists_list_id_seq'::regclass);

  ALTER SEQUENCE public.lists_list_id_seq
    OWNED BY public.lists.list_id;
END $$;

-- Verify (run separately to confirm):
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'lists'
--   AND column_name = 'list_id';

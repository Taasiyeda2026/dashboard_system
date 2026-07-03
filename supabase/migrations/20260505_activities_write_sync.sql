-- ============================================================
-- Migration: Activities write-sync tables + UNIQUE constraints
-- Supabase project: szinlhjuwyiyszdpsdop
--
-- Tables created (if not exist):
--   activity_meetings        — meeting dates per long-program row
--   edit_requests            — edit-request workflow records
--   operations_private_notes — private notes per activity row
--
-- UNIQUE constraints added safely:
--   data_long(RowID)                      — only if table exists
--   data_short(RowID)                     — only if table exists
--   activity_meetings(source_row_id, meeting_no)
--   edit_requests(request_id)
--   operations_private_notes(source_sheet, source_row_id)
--
-- Safe for Supabase Preview:
--   If legacy tables data_long / data_short do not exist, their UNIQUE blocks are skipped.
--
-- All blocks are idempotent — safe to re-run.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. activity_meetings
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_meetings (
  id              bigserial PRIMARY KEY,
  source_row_id   text NOT NULL,
  meeting_no      text NOT NULL,
  meeting_date    text,
  notes           text,
  active          text DEFAULT 'yes',
  created_at      timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'activity_meetings'
      AND i.indisunique
      AND array_length(i.indkey, 1) = 2
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = t.oid
          AND a.attnum = ANY(i.indkey)
          AND a.attname = 'source_row_id'
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = t.oid
          AND a.attnum = ANY(i.indkey)
          AND a.attname = 'meeting_no'
      )
  ) THEN
    ALTER TABLE public.activity_meetings
      ADD CONSTRAINT activity_meetings_source_row_id_meeting_no_key
        UNIQUE (source_row_id, meeting_no);

    RAISE NOTICE 'Created UNIQUE(source_row_id, meeting_no) on activity_meetings';
  ELSE
    RAISE NOTICE 'UNIQUE(source_row_id, meeting_no) on activity_meetings already exists — skipped';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 2. edit_requests
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.edit_requests (
  id                    bigserial PRIMARY KEY,
  request_id            text NOT NULL,
  source_sheet          text,
  source_row_id         text,
  activity_name         text,
  school                text,
  authority             text,
  requested_by_user_id  text,
  requested_by_name     text,
  requested_at          text,
  status                text DEFAULT 'pending',
  changed_fields        text,
  original_values       text,
  requested_values      text,
  reviewer_user_id      text,
  reviewed_by           text,
  reviewed_at           text,
  review_note           text,
  reviewer_notes        text,
  active                text DEFAULT 'yes',
  created_at            timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
    WHERE n.nspname = 'public'
      AND t.relname = 'edit_requests'
      AND i.indisunique
      AND array_length(i.indkey, 1) = 1
      AND a.attname = 'request_id'
  ) THEN
    ALTER TABLE public.edit_requests
      ADD CONSTRAINT edit_requests_request_id_key UNIQUE (request_id);

    RAISE NOTICE 'Created UNIQUE(request_id) on edit_requests';
  ELSE
    RAISE NOTICE 'UNIQUE(request_id) on edit_requests already exists — skipped';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 3. operations_private_notes
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operations_private_notes (
  id              bigserial PRIMARY KEY,
  source_sheet    text NOT NULL,
  source_row_id   text NOT NULL,
  note_text       text,
  updated_at      text,
  updated_by      text,
  active          text DEFAULT 'yes',
  created_at      timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'operations_private_notes'
      AND i.indisunique
      AND array_length(i.indkey, 1) = 2
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = t.oid
          AND a.attnum = ANY(i.indkey)
          AND a.attname = 'source_sheet'
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = t.oid
          AND a.attnum = ANY(i.indkey)
          AND a.attname = 'source_row_id'
      )
  ) THEN
    ALTER TABLE public.operations_private_notes
      ADD CONSTRAINT operations_private_notes_source_sheet_source_row_id_key
        UNIQUE (source_sheet, source_row_id);

    RAISE NOTICE 'Created UNIQUE(source_sheet, source_row_id) on operations_private_notes';
  ELSE
    RAISE NOTICE 'UNIQUE(source_sheet, source_row_id) on operations_private_notes already exists — skipped';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 4. UNIQUE(RowID) on data_long
-- Legacy table. Skip safely if the table does not exist.
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.data_long') IS NULL THEN
    RAISE NOTICE 'Table public.data_long does not exist — skipped UNIQUE(RowID)';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
    WHERE n.nspname = 'public'
      AND t.relname = 'data_long'
      AND i.indisunique
      AND array_length(i.indkey, 1) = 1
      AND a.attname = 'RowID'
  ) THEN
    EXECUTE 'ALTER TABLE public.data_long ADD CONSTRAINT data_long_rowid_key UNIQUE ("RowID")';

    RAISE NOTICE 'Created UNIQUE(RowID) on data_long';
  ELSE
    RAISE NOTICE 'UNIQUE(RowID) on data_long already exists — skipped';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 5. UNIQUE(RowID) on data_short
-- Legacy table. Skip safely if the table does not exist.
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.data_short') IS NULL THEN
    RAISE NOTICE 'Table public.data_short does not exist — skipped UNIQUE(RowID)';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
    WHERE n.nspname = 'public'
      AND t.relname = 'data_short'
      AND i.indisunique
      AND array_length(i.indkey, 1) = 1
      AND a.attname = 'RowID'
  ) THEN
    EXECUTE 'ALTER TABLE public.data_short ADD CONSTRAINT data_short_rowid_key UNIQUE ("RowID")';

    RAISE NOTICE 'Created UNIQUE(RowID) on data_short';
  ELSE
    RAISE NOTICE 'UNIQUE(RowID) on data_short already exists — skipped';
  END IF;
END $$;

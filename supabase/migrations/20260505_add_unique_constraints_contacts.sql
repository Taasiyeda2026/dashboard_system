-- Migration: Add UNIQUE constraints required for contacts upsert
-- Supabase project: szinlhjuwyiyszdpsdop
--
-- The app uses upsert with onConflict on these columns:
--   contacts_instructors  → emp_id
--   contacts_schools      → (authority, school, contact_name)
--
-- Without these constraints every save inserts a new row instead of updating.
--
-- ────────────────────────────────────────────────────────────────────────────
-- BEFORE RUNNING: check for existing duplicates (queries below).
-- If duplicates are found, resolve them first or the ALTER TABLE will fail.
-- ────────────────────────────────────────────────────────────────────────────

-- Step 0 — preflight: detect duplicates (run these SELECTs first, read-only)

-- 0a. Duplicates in contacts_instructors on emp_id
SELECT emp_id, COUNT(*) AS cnt
FROM   public.contacts_instructors
GROUP  BY emp_id
HAVING COUNT(*) > 1
ORDER  BY cnt DESC;

-- 0b. Duplicates in contacts_schools on (authority, school, contact_name)
SELECT authority, school, contact_name, COUNT(*) AS cnt
FROM   public.contacts_schools
GROUP  BY authority, school, contact_name
HAVING COUNT(*) > 1
ORDER  BY cnt DESC;

-- If either query returns rows, de-duplicate before proceeding.
-- Suggested cleanup (keep the row with the highest id / latest ctid):
--
--   DELETE FROM public.contacts_instructors
--   WHERE  id NOT IN (
--     SELECT MAX(id) FROM public.contacts_instructors GROUP BY emp_id
--   );
--
--   DELETE FROM public.contacts_schools
--   WHERE  id NOT IN (
--     SELECT MAX(id) FROM public.contacts_schools
--     GROUP  BY authority, school, contact_name
--   );
--
-- Adjust the id column name to match the actual PK column if it differs.

-- ────────────────────────────────────────────────────────────────────────────
-- Step 1 — contacts_instructors: UNIQUE on emp_id
-- ────────────────────────────────────────────────────────────────────────────
-- Idempotency: skips if ANY unique constraint/index already covers emp_id alone,
-- regardless of the constraint name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   pg_index     i
    JOIN   pg_class     t ON t.oid = i.indrelid
    JOIN   pg_namespace n ON n.oid = t.relnamespace
    JOIN   pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
    WHERE  n.nspname   = 'public'
      AND  t.relname   = 'contacts_instructors'
      AND  i.indisunique
      AND  a.attname   = 'emp_id'
      AND  array_length(i.indkey, 1) = 1   -- exactly one column in the index
  ) THEN
    RAISE NOTICE 'UNIQUE index on contacts_instructors(emp_id) already exists — skipped';
  ELSE
    ALTER TABLE public.contacts_instructors
      ADD CONSTRAINT contacts_instructors_emp_id_key UNIQUE (emp_id);
    RAISE NOTICE 'Created UNIQUE(emp_id) on contacts_instructors';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Step 2 — contacts_schools: UNIQUE on (authority, school, contact_name)
-- ────────────────────────────────────────────────────────────────────────────
-- Idempotency: skips if ANY unique index already covers exactly these three
-- columns (in any order), regardless of the constraint/index name.
DO $$
DECLARE
  v_col_ids   int2[];
  v_auth_id   int2;
  v_school_id int2;
  v_cname_id  int2;
BEGIN
  SELECT a.attnum INTO v_auth_id
  FROM   pg_attribute a
  JOIN   pg_class     t ON t.oid = a.attrelid
  JOIN   pg_namespace n ON n.oid = t.relnamespace
  WHERE  n.nspname = 'public' AND t.relname = 'contacts_schools'
    AND  a.attname = 'authority';

  SELECT a.attnum INTO v_school_id
  FROM   pg_attribute a
  JOIN   pg_class     t ON t.oid = a.attrelid
  JOIN   pg_namespace n ON n.oid = t.relnamespace
  WHERE  n.nspname = 'public' AND t.relname = 'contacts_schools'
    AND  a.attname = 'school';

  SELECT a.attnum INTO v_cname_id
  FROM   pg_attribute a
  JOIN   pg_class     t ON t.oid = a.attrelid
  JOIN   pg_namespace n ON n.oid = t.relnamespace
  WHERE  n.nspname = 'public' AND t.relname = 'contacts_schools'
    AND  a.attname = 'contact_name';

  IF v_auth_id IS NULL OR v_school_id IS NULL OR v_cname_id IS NULL THEN
    RAISE EXCEPTION 'contacts_schools is missing one of: authority, school, contact_name';
  END IF;

  v_col_ids := ARRAY[v_auth_id, v_school_id, v_cname_id];

  IF EXISTS (
    SELECT 1
    FROM   pg_index     i
    JOIN   pg_class     t ON t.oid = i.indrelid
    JOIN   pg_namespace n ON n.oid = t.relnamespace
    WHERE  n.nspname   = 'public'
      AND  t.relname   = 'contacts_schools'
      AND  i.indisunique
      AND  array_length(i.indkey, 1) = 3
      AND  (i.indkey::int2[] @> v_col_ids AND v_col_ids @> i.indkey::int2[])
  ) THEN
    RAISE NOTICE 'UNIQUE index on contacts_schools(authority,school,contact_name) already exists — skipped';
  ELSE
    ALTER TABLE public.contacts_schools
      ADD CONSTRAINT contacts_schools_authority_school_contact_name_key
        UNIQUE (authority, school, contact_name);
    RAISE NOTICE 'Created UNIQUE(authority,school,contact_name) on contacts_schools';
  END IF;
END $$;

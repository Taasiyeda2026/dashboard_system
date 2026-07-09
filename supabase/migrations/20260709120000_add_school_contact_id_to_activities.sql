-- Migration: add school_contact_id FK + ensure contact text columns exist in activities
-- Purpose: Allow 2027 activities to save a proper contact reference (FK to contacts_schools)
--          instead of free-text only. Contact text columns are kept for denormalized display.
-- Safe: all columns added with IF NOT EXISTS; FK is nullable (no save blocking).

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS school_contact_id bigint
    REFERENCES public.contacts_schools(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_name  text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_email text;

COMMENT ON COLUMN public.activities.school_contact_id IS
  '2027: FK to contacts_schools — selected contact for this activity (nullable)';
COMMENT ON COLUMN public.activities.contact_name IS
  'Denormalized contact name — set when school_contact_id is selected, or free-text fallback';
COMMENT ON COLUMN public.activities.contact_phone IS
  'Denormalized contact phone — set when school_contact_id is selected, or free-text fallback';
COMMENT ON COLUMN public.activities.contact_email IS
  'Denormalized contact email — set when school_contact_id is selected, or free-text fallback';

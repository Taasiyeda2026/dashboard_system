-- Photo approval uploads: one file per instructor + school
-- IMPORTANT: Also create Storage bucket 'photo-approvals' manually in Supabase dashboard
-- (private, max 10MB, allowed: pdf/jpg/jpeg/png)

CREATE TABLE IF NOT EXISTS photo_approval_uploads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_emp_id    text NOT NULL,
  instructor_name      text NOT NULL DEFAULT '',
  school_id            text NOT NULL DEFAULT '',
  authority            text NOT NULL DEFAULT '',
  school               text NOT NULL,
  file_path            text NOT NULL,
  mime_type            text NOT NULL DEFAULT '',
  file_size            bigint NOT NULL DEFAULT 0,
  uploaded_by_user_id  text NOT NULL DEFAULT '',
  uploaded_at          timestamptz NOT NULL DEFAULT now(),
  status               text NOT NULL DEFAULT 'uploaded'
);

CREATE INDEX IF NOT EXISTS idx_photo_approval_uploads_instr_school
  ON photo_approval_uploads (instructor_emp_id, school_id, school);

ALTER TABLE photo_approval_uploads ENABLE ROW LEVEL SECURITY;

-- Instructors read their own; managers/admins read all (enforced at app level too)
DROP POLICY IF EXISTS "photo_approval_uploads_select" ON photo_approval_uploads;
CREATE POLICY "photo_approval_uploads_select" ON photo_approval_uploads
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "photo_approval_uploads_insert" ON photo_approval_uploads;
CREATE POLICY "photo_approval_uploads_insert" ON photo_approval_uploads
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "photo_approval_uploads_update" ON photo_approval_uploads;
CREATE POLICY "photo_approval_uploads_update" ON photo_approval_uploads
  FOR UPDATE USING (true);

DROP POLICY IF EXISTS "photo_approval_uploads_delete" ON photo_approval_uploads;
CREATE POLICY "photo_approval_uploads_delete" ON photo_approval_uploads
  FOR DELETE USING (true);

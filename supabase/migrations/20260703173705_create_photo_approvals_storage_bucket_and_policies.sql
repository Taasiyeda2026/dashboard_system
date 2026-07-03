-- Create and secure Storage bucket for photo approval uploads.
-- This complements public.photo_approval_uploads, which stores metadata only.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'photo-approvals',
  'photo-approvals',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[];

DROP POLICY IF EXISTS "photo_approvals_storage_select_own_or_manager" ON storage.objects;
CREATE POLICY "photo_approvals_storage_select_own_or_manager" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'photo-approvals'
    AND (
      split_part(name, '/', 1) = (
        SELECT users.emp_id
        FROM public.users
        WHERE users.auth_user_id = auth.uid()
        LIMIT 1
      )
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.is_active = true
          AND u.role = ANY (ARRAY['admin','operation_manager','domain_manager','activities_manager','instructor_manager'])
      )
    )
  );

DROP POLICY IF EXISTS "photo_approvals_storage_insert_own_or_manager" ON storage.objects;
CREATE POLICY "photo_approvals_storage_insert_own_or_manager" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'photo-approvals'
    AND (
      split_part(name, '/', 1) = (
        SELECT users.emp_id
        FROM public.users
        WHERE users.auth_user_id = auth.uid()
        LIMIT 1
      )
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.is_active = true
          AND u.role = ANY (ARRAY['admin','operation_manager','domain_manager','activities_manager','instructor_manager'])
      )
    )
  );

DROP POLICY IF EXISTS "photo_approvals_storage_update_own_or_manager" ON storage.objects;
CREATE POLICY "photo_approvals_storage_update_own_or_manager" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'photo-approvals'
    AND (
      split_part(name, '/', 1) = (
        SELECT users.emp_id
        FROM public.users
        WHERE users.auth_user_id = auth.uid()
        LIMIT 1
      )
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.is_active = true
          AND u.role = ANY (ARRAY['admin','operation_manager','domain_manager','activities_manager','instructor_manager'])
      )
    )
  )
  WITH CHECK (
    bucket_id = 'photo-approvals'
    AND (
      split_part(name, '/', 1) = (
        SELECT users.emp_id
        FROM public.users
        WHERE users.auth_user_id = auth.uid()
        LIMIT 1
      )
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.is_active = true
          AND u.role = ANY (ARRAY['admin','operation_manager','domain_manager','activities_manager','instructor_manager'])
      )
    )
  );

DROP POLICY IF EXISTS "photo_approvals_storage_delete_own_or_manager" ON storage.objects;
CREATE POLICY "photo_approvals_storage_delete_own_or_manager" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'photo-approvals'
    AND (
      split_part(name, '/', 1) = (
        SELECT users.emp_id
        FROM public.users
        WHERE users.auth_user_id = auth.uid()
        LIMIT 1
      )
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.is_active = true
          AND u.role = ANY (ARRAY['admin','operation_manager','domain_manager','activities_manager','instructor_manager'])
      )
    )
  );

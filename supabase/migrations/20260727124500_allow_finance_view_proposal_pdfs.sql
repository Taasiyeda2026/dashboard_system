-- Allow finance and explicitly authorized proposal viewers to open existing
-- proposal PDF documents, without granting upload, generation, update or delete.

CREATE OR REPLACE FUNCTION public.app_can_view_proposals_agreements()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.app_current_role() IN (
      'domain_manager',
      'operation_manager',
      'admin',
      'business_development_manager',
      'finance'
    )
    OR EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.auth_user_id = (SELECT auth.uid())
        AND u.is_active = true
        AND (
          COALESCE(u.view_proposals_agreements, false)
          OR COALESCE(u.manage_proposals_agreements, false)
        )
    ),
    false
  )
$$;

REVOKE ALL ON FUNCTION public.app_can_view_proposals_agreements() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_can_view_proposals_agreements() TO authenticated;

-- Existing final proposal PDFs: read-only access for proposal viewers.
DROP POLICY IF EXISTS proposal_final_pdfs_storage_select ON storage.objects;
CREATE POLICY proposal_final_pdfs_storage_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'proposal-final-pdfs'
  AND public.app_can_view_proposals_agreements()
);

-- Linked documents (including a separately generated GEFEN approval): read-only.
DROP POLICY IF EXISTS "Authenticated users can view linked proposal documents"
ON public.proposal_linked_documents;
CREATE POLICY "Authenticated users can view linked proposal documents"
ON public.proposal_linked_documents
FOR SELECT
TO authenticated
USING (public.app_can_view_proposals_agreements());

-- Deliberately leave INSERT/UPDATE/DELETE and PDF upload policies unchanged.
-- Finance remains unable to generate, replace, approve, edit or delete proposals.

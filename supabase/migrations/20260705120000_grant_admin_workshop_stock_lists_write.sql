-- Allow admin users to insert/update workshop_stock rows in public.lists.
-- Required for in-app workshop inventory editing (operations-management screen).

DROP POLICY IF EXISTS "lists_update_workshop_stock_admin" ON public.lists;
CREATE POLICY "lists_update_workshop_stock_admin"
ON public.lists
FOR UPDATE
TO authenticated
USING (
  category = 'workshop_stock'
  AND EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.role = 'admin'
  )
)
WITH CHECK (
  category = 'workshop_stock'
  AND EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.role = 'admin'
  )
);

DROP POLICY IF EXISTS "lists_insert_workshop_stock_admin" ON public.lists;
CREATE POLICY "lists_insert_workshop_stock_admin"
ON public.lists
FOR INSERT
TO authenticated
WITH CHECK (
  category = 'workshop_stock'
  AND EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.role = 'admin'
  )
);

GRANT UPDATE, INSERT ON public.lists TO authenticated;

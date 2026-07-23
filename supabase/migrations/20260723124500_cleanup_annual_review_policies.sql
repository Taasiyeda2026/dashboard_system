-- Remove the obsolete employee-preparation SELECT policy left by the legacy workflow.
-- The simplified workflow uses employee_preparation_select, which keeps the
-- employee draft private until both sides submit their sections.
drop policy if exists preparation_employee_select
on public.employee_review_preparation;

notify pgrst, 'reload schema';

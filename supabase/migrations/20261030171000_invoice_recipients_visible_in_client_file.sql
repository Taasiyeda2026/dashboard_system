-- Invoice-recipient designation is part of the client file as well as finance.
-- Do not broaden invoice administration writes or expose the mapping to anonymous users.
drop policy if exists finance_invoice_recipients_read_client_file on public.finance_school_invoice_recipients;
create policy finance_invoice_recipients_read_client_file
  on public.finance_school_invoice_recipients
  for select to authenticated
  using (
    auth.uid() is not null
    and public.app_has_permission('view_proposals_agreements')
  );

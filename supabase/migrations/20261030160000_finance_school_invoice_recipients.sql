-- Billing recipients are defined by responsibility for receiving an invoice,
-- not by their employment title. A principal may also be the invoice recipient.
-- Keep existing school-contact roles and emails unchanged.
create table if not exists public.finance_school_invoice_recipients (
  school_id bigint primary key references public.schools(id) on delete cascade,
  source_semel bigint not null,
  recipient_name text not null,
  recipient_email text not null check (recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  recipient_mobile text,
  contact_id bigint references public.contacts_schools(id) on delete set null,
  source text not null default 'administrator_spreadsheet',
  updated_at timestamptz not null default now()
);
alter table public.finance_school_invoice_recipients enable row level security;
revoke all on public.finance_school_invoice_recipients from anon, authenticated;
grant select on public.finance_school_invoice_recipients to authenticated;
grant select, insert, update, delete on public.finance_school_invoice_recipients to service_role;
drop policy if exists finance_invoice_recipients_read_finance on public.finance_school_invoice_recipients;
create policy finance_invoice_recipients_read_finance on public.finance_school_invoice_recipients
  for select to authenticated
  using (
    auth.uid() is not null
    and (
      public.app_current_role() = 'admin'
      or public.app_has_permission('manage_finance_transactions')
      or public.app_has_permission('view_finance_collection')
    )
  );
comment on table public.finance_school_invoice_recipients is
  'One explicit billing-email recipient per school, separate from contact job titles; finance-only access.';

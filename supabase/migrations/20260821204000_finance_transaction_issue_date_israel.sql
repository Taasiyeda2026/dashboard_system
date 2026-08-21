-- Keep transaction-account issue date aligned with the finance business timezone.
alter table public.finance_transaction_accounts
  alter column issue_date set default ((now() at time zone 'Asia/Jerusalem')::date);

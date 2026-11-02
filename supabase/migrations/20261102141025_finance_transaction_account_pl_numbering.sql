lock table public.finance_transaction_accounts in access exclusive mode;
do $$
begin
  if exists (select 1 from public.finance_transaction_accounts where transaction_account_number::text = 'Pl26000170' or (transaction_account_number::text ~ '^Pl[0-9]+$' and substring(transaction_account_number::text from 3)::bigint >= 26000170)) then
    raise exception 'Requested account number is already used or precedes an existing account';
  end if;
end $$;
alter table public.finance_transaction_accounts alter column transaction_account_number drop default;
alter table public.finance_transaction_accounts alter column transaction_account_number type text using transaction_account_number::text;
alter sequence public.finance_transaction_account_number_seq restart with 26000170;
alter table public.finance_transaction_accounts alter column transaction_account_number set default ('Pl'::text || nextval('public.finance_transaction_account_number_seq'::regclass)::text);
insert into public.finance_audit_events(event_type,details) values ('account_numbering_updated',jsonb_build_object('next_number','Pl26000170','prefix','Pl'));

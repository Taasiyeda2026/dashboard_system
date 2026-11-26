begin;

create table finance_private.transaction_drafts (
  id uuid primary key,
  owner_id uuid not null,
  payload jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table finance_private.transaction_drafts enable row level security;
revoke all on finance_private.transaction_drafts from public,anon,authenticated,service_role;
create index transaction_drafts_owner_recent on finance_private.transaction_drafts(owner_id,updated_at desc);

create function public.finance_transaction_drafts() returns setof finance_private.transaction_drafts
language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce(public.finance_transaction_can_issue(),false) or auth.uid() is null then
    raise exception 'finance_transactions_permission_denied' using errcode='42501';
  end if;
  return query select d.* from finance_private.transaction_drafts d
    where d.owner_id=auth.uid() or public.app_current_role()='admin'
    order by d.updated_at desc;
end $$;

create function public.finance_save_transaction_draft(p_id uuid,p_version integer,p_payload jsonb)
returns finance_private.transaction_drafts
language plpgsql security definer set search_path='' as $$
declare draft finance_private.transaction_drafts;
begin
  if not coalesce(public.finance_transaction_can_issue(),false) or auth.uid() is null then
    raise exception 'finance_transactions_permission_denied' using errcode='42501';
  end if;
  if p_id is null or jsonb_typeof(p_payload) is distinct from 'object'
    or jsonb_typeof(p_payload->'manualSelectedActivityIds') is distinct from 'array'
    or jsonb_array_length(p_payload->'manualSelectedActivityIds') not between 1 and 100
    or octet_length(p_payload::text)>262144 then raise exception 'invalid_transaction_draft'; end if;
  if p_version=0 then
    insert into finance_private.transaction_drafts(id,owner_id,payload) values(p_id,auth.uid(),p_payload)
      on conflict(id) do nothing returning * into draft;
    if not found then
      select * into draft from finance_private.transaction_drafts
        where id=p_id and owner_id=auth.uid() and version=1 and payload=p_payload;
    end if;
  else
    update finance_private.transaction_drafts set payload=p_payload,version=version+1,updated_at=now()
      where id=p_id and (owner_id=auth.uid() or public.app_current_role()='admin') and version=p_version
      returning * into draft;
    if not found then
      select * into draft from finance_private.transaction_drafts
        where id=p_id and (owner_id=auth.uid() or public.app_current_role()='admin')
          and version=p_version+1 and payload=p_payload;
    end if;
  end if;
  if draft.id is null then raise exception 'stale_transaction_draft'; end if;
  return draft;
end $$;

create function public.finance_delete_transaction_draft(p_id uuid,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or public.app_current_role() is distinct from 'admin' then
    raise exception 'finance_transactions_permission_denied' using errcode='42501';
  end if;
  delete from finance_private.transaction_drafts where id=p_id and version=p_version;
  if not found then
    if exists(select 1 from finance_private.transaction_drafts where id=p_id) then
      raise exception 'stale_transaction_draft';
    end if;
    return;
  end if;
  insert into public.finance_audit_events(event_type,actor_id,details)
    values('transaction_draft_deleted',auth.uid(),jsonb_build_object('draft_id',p_id,'version',p_version));
end $$;

revoke all on function public.finance_transaction_drafts(),public.finance_save_transaction_draft(uuid,integer,jsonb),public.finance_delete_transaction_draft(uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.finance_transaction_drafts(),public.finance_save_transaction_draft(uuid,integer,jsonb),public.finance_delete_transaction_draft(uuid,integer)
  to authenticated;

commit;

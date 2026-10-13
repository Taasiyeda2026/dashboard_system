-- Display-only anonymous student response totals and personal feedback expiry.
-- Never expose response bodies/answers to instructors. Preserve existing RLS.
create or replace function private.feedback_instructor_default_expiry()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.audience='instructor' and new.stage in ('pre','final','final_b')
   and new.expires_at is null then
   new.expires_at:=new.opens_at + interval '14 days';
 end if;
 return new;
end $$;
drop trigger if exists feedback_instructor_default_expiry on public.feedback_campaigns;
create trigger feedback_instructor_default_expiry before insert on public.feedback_campaigns
 for each row execute function private.feedback_instructor_default_expiry();

update public.feedback_campaigns
set expires_at=opens_at+interval '14 days'
where audience='instructor' and stage in ('pre','final','final_b')
  and expires_at is null
  and status='active';

do $outer$
declare definition text;
begin
 select pg_get_functiondef(p.oid) into definition
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='feedback_instructor_portal_items';
 if definition is null then raise exception 'missing_instructor_portal_rpc'; end if;
 if position('''response_count''' in definition) = 0 then
   if position('''token'', c.public_token,' in definition) = 0
   then raise exception 'student_token_anchor_missing'; end if;
   definition:=replace(definition,
      '''token'', c.public_token,',
      '''token'', c.public_token,
        ''response_count'', (select count(*) from public.feedback_responses fr where fr.campaign_id=c.id),');
 end if;
 execute definition;
end $outer$;

revoke all on function public.feedback_instructor_portal_items(text) from public,anon;
grant execute on function public.feedback_instructor_portal_items(text) to authenticated;
notify pgrst,'reload schema';

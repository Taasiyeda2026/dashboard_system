create or replace function public.av2_request_base_training_route_build()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'av2_trigger_secret';

  if v_secret is null or btrim(v_secret) = '' then
    raise exception 'av2_trigger_secret_missing';
  end if;

  select net.http_post(
    url := 'https://szinlhjuwyiyszdpsdop.supabase.co/functions/v1/attendance-base-training-routes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_k0IbDJlgPA9KTVuDWrCyFw_Zsa5kZIM',
      'x-av2-trigger-secret', v_secret
    ),
    body := jsonb_build_object('mode', 'build_all')
  ) into v_request_id;

  return v_request_id;
end $$;

revoke all on function public.av2_request_base_training_route_build() from public, anon, authenticated;
grant execute on function public.av2_request_base_training_route_build() to service_role;

comment on function public.av2_request_base_training_route_build() is
  'Trusted one-shot request to precompute Greenwork/Yakum round-trip routes for all active instructors with a home address.';

create or replace function public.remove_israa_activity_draft(
  p_tracking_id uuid,
  p_proposal_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_drafts jsonb;
begin
  if not public.app_can_manage_israa() then
    raise exception 'israa_management_forbidden' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.activities
    where israa_tracking_id = p_tracking_id
      and israa_source_item_id = p_proposal_item_id
  ) then
    raise exception 'israa_activity_already_shared' using errcode = '23514';
  end if;

  update public.israa_program_tracking
  set selected_activity_drafts = coalesce((
        select jsonb_agg(value)
        from jsonb_array_elements(coalesce(selected_activity_drafts, '[]'::jsonb)) value
        where value->>'proposal_item_id' <> p_proposal_item_id::text
      ), '[]'::jsonb),
      updated_at = now()
  where id = p_tracking_id
  returning selected_activity_drafts into v_drafts;

  if not found then
    raise exception 'israa_tracking_not_found';
  end if;

  return jsonb_build_object('drafts', v_drafts);
end;
$$;

revoke all on function public.remove_israa_activity_draft(uuid,uuid) from public, anon;
grant execute on function public.remove_israa_activity_draft(uuid,uuid) to authenticated, service_role;

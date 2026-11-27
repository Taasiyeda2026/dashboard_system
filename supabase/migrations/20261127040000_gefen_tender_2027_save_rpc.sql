-- Server-side save contract for Gefen tender 2027:
-- optimistic revision, admin-only, approved-answer protection, append-only knowledge.

create or replace function public.gefen_tender_2027_reconcile_final_answers(
  p_final jsonb,
  p_current jsonb
) returns jsonb
language plpgsql
volatile
as $$
declare
  result jsonb := '{}'::jsonb;
  key text;
  entry jsonb;
  current_text text;
  entry_text text;
  token text;
begin
  if p_final is null or jsonb_typeof(p_final) <> 'object' then
    return '{}'::jsonb;
  end if;
  for key, entry in select * from jsonb_each(p_final)
  loop
    if jsonb_typeof(entry) = 'string' then
      entry_text := entry #>> '{}';
      token := null;
    elsif jsonb_typeof(entry) = 'object' then
      entry_text := coalesce(entry->>'text', '');
      token := entry->>'token';
    else
      continue;
    end if;
    current_text := coalesce(p_current->>key, '');
    if current_text = '' or current_text is distinct from entry_text then
      continue;
    end if;
    -- Legacy string approvals that still match are upgraded to a fresh token so a later
    -- edit+restore cannot revive the prior approval without an explicit approve action.
    if token is null or token = '' then
      token := gen_random_uuid()::text;
      entry := jsonb_build_object(
        'text', entry_text,
        'token', token,
        'approved_at', coalesce(entry->>'approved_at', timezone('utc', now())::text),
        'legacy', false
      );
    else
      entry := jsonb_build_object(
        'text', entry_text,
        'token', token,
        'approved_at', coalesce(entry->>'approved_at', timezone('utc', now())::text),
        'legacy', false
      );
    end if;
    result := result || jsonb_build_object(key, entry);
  end loop;
  return result;
end;
$$;

create or replace function public.gefen_tender_2027_current_answers(p_payload jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  result jsonb := '{}'::jsonb;
  details jsonb;
  key text;
  val text;
  assoc jsonb;
  assoc_idx int := 0;
  q jsonb;
  q_idx int;
begin
  details := coalesce(p_payload->'details', '{}'::jsonb);
  for key, val in
    select d.key, case
      when jsonb_typeof(d.value) = 'array' then (
        select string_agg(x, ', ') from jsonb_array_elements_text(d.value) as t(x)
      )
      else d.value #>> '{}'
    end
    from jsonb_each(details) as d
  loop
    result := result || jsonb_build_object('details.' || key, coalesce(val, ''));
  end loop;

  for assoc in select * from jsonb_array_elements(coalesce(p_payload->'associations', '[]'::jsonb))
  loop
    if jsonb_typeof(assoc->'questions') = 'array' and jsonb_array_length(assoc->'questions') > 0 then
      q_idx := 0;
      for q in select * from jsonb_array_elements(assoc->'questions')
      loop
        result := result || jsonb_build_object(
          'association.' || assoc_idx || '.' || q_idx,
          coalesce(q->>'answer', '')
        );
        q_idx := q_idx + 1;
      end loop;
    else
      result := result || jsonb_build_object(
        'association.' || assoc_idx || '.placeholder',
        coalesce(assoc->>'answers', '')
      );
    end if;
    assoc_idx := assoc_idx + 1;
  end loop;

  foreach key in array array['syllabus','experience','recommendations','developers','operators']
  loop
    result := result || jsonb_build_object(key, coalesce(p_payload->>key, ''));
  end loop;

  return result;
end;
$$;

create or replace function public.gefen_tender_2027_save(
  p_id text,
  p_expected_revision bigint,
  p_payload jsonb,
  p_mode text default 'save_payload'
) returns public.gefen_tender_2027
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.gefen_tender_2027;
  next_payload jsonb;
  existing_items jsonb;
  incoming_items jsonb;
  merged_items jsonb;
  item jsonb;
  seen jsonb := '{}'::jsonb;
  current_answers jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if public.app_current_role() is distinct from 'admin' then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if p_mode not in ('save_payload', 'set_answers', 'append_knowledge') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;

  select * into current_row
  from public.gefen_tender_2027
  where id = p_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if current_row.revision is distinct from p_expected_revision then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;

  if p_mode = 'append_knowledge' then
    existing_items := coalesce(current_row.payload->'knowledge_items', '[]'::jsonb);
    incoming_items := coalesce(p_payload->'knowledge_items', '[]'::jsonb);
    merged_items := '[]'::jsonb;
    for item in select * from jsonb_array_elements(existing_items)
    loop
      merged_items := merged_items || jsonb_build_array(item);
      if item ? 'id' then
        seen := seen || jsonb_build_object(item->>'id', true);
      end if;
    end loop;
    for item in select * from jsonb_array_elements(incoming_items)
    loop
      if coalesce(item->>'content', '') = '' then
        continue;
      end if;
      if item ? 'id' and (seen->>(item->>'id')) = 'true' then
        continue;
      end if;
      merged_items := merged_items || jsonb_build_array(item);
      if item ? 'id' then
        seen := seen || jsonb_build_object(item->>'id', true);
      end if;
    end loop;
    next_payload := current_row.payload || jsonb_build_object('knowledge_items', merged_items);
    -- Preserve any other non-knowledge keys supplied without touching final_answers
    next_payload := next_payload || (p_payload - 'knowledge_items' - 'final_answers');
    next_payload := jsonb_set(next_payload, '{final_answers}', coalesce(current_row.payload->'final_answers', '{}'::jsonb), true);
  else
    next_payload := p_payload;
    current_answers := public.gefen_tender_2027_current_answers(next_payload);
    next_payload := jsonb_set(
      next_payload,
      '{final_answers}',
      public.gefen_tender_2027_reconcile_final_answers(
        coalesce(next_payload->'final_answers', '{}'::jsonb),
        current_answers
      ),
      true
    );
  end if;

  update public.gefen_tender_2027
  set
    payload = next_payload,
    revision = current_row.revision + 1,
    updated_at = timezone('utc', now())
  where id = p_id
  returning * into current_row;

  return current_row;
end;
$$;

revoke all on function public.gefen_tender_2027_reconcile_final_answers(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.gefen_tender_2027_current_answers(jsonb) from public, anon, authenticated;
revoke all on function public.gefen_tender_2027_save(text, bigint, jsonb, text) from public, anon;
grant execute on function public.gefen_tender_2027_save(text, bigint, jsonb, text) to authenticated;
grant execute on function public.gefen_tender_2027_save(text, bigint, jsonb, text) to service_role;

comment on function public.gefen_tender_2027_save(text, bigint, jsonb, text) is
  'Admin-only Gefen tender save with revision checks, append-only knowledge, and approved-answer token reconciliation.';

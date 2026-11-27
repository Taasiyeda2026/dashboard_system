-- Add append_historical mode to gefen_tender_2027_save (append-only; never touches final_answers).

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
  hist_key text;
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
  if p_mode not in ('save_payload', 'set_answers', 'append_knowledge', 'append_historical') then
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
    hist_key := 'knowledge_items';
    existing_items := coalesce(current_row.payload->hist_key, '[]'::jsonb);
    incoming_items := coalesce(p_payload->hist_key, '[]'::jsonb);
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
    next_payload := current_row.payload || jsonb_build_object(hist_key, merged_items);
    next_payload := next_payload || (p_payload - hist_key - 'final_answers');
    next_payload := jsonb_set(next_payload, '{final_answers}', coalesce(current_row.payload->'final_answers', '{}'::jsonb), true);

  elsif p_mode = 'append_historical' then
    hist_key := 'historical_answers';
    existing_items := coalesce(current_row.payload->hist_key, '[]'::jsonb);
    incoming_items := coalesce(p_payload->hist_key, '[]'::jsonb);
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
      if coalesce(item->>'answer', '') = '' then
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
    next_payload := current_row.payload || jsonb_build_object(hist_key, merged_items);
    next_payload := next_payload || (p_payload - hist_key - 'final_answers');
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

comment on function public.gefen_tender_2027_save(text, bigint, jsonb, text) is
  'Admin-only Gefen tender save with revision checks. Modes: save_payload, set_answers, append_knowledge, append_historical.';

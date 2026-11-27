-- Helper for append-only knowledge / unassigned knowledge merges (preserves final_answers).

create or replace function public.gefen_tender_append_knowledge_field(
  p_id text,
  p_field text,
  p_items jsonb
) returns public.gefen_tender_2027
language plpgsql
security definer
set search_path = public
as $$
declare
  cur public.gefen_tender_2027;
  existing jsonb;
  merged jsonb := '[]'::jsonb;
  item jsonb;
  seen jsonb := '{}'::jsonb;
  next_payload jsonb;
begin
  if p_field not in ('knowledge_items', 'unassigned_knowledge_items') then
    raise exception 'invalid_field' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items' using errcode = '22023';
  end if;

  select * into cur from public.gefen_tender_2027 where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  existing := coalesce(cur.payload->p_field, '[]'::jsonb);
  for item in select * from jsonb_array_elements(existing)
  loop
    merged := merged || jsonb_build_array(item);
    if item ? 'id' then
      seen := seen || jsonb_build_object(item->>'id', true);
    end if;
  end loop;
  for item in select * from jsonb_array_elements(p_items)
  loop
    if coalesce(item->>'content', '') = '' then
      continue;
    end if;
    if item ? 'id' and (seen->>(item->>'id')) = 'true' then
      continue;
    end if;
    merged := merged || jsonb_build_array(item);
    if item ? 'id' then
      seen := seen || jsonb_build_object(item->>'id', true);
    end if;
  end loop;

  next_payload := jsonb_set(cur.payload, array[p_field], merged, true);
  next_payload := jsonb_set(next_payload, '{final_answers}', coalesce(cur.payload->'final_answers', '{}'::jsonb), true);

  update public.gefen_tender_2027
  set payload = next_payload,
      revision = cur.revision + 1,
      updated_at = timezone('utc', now())
  where id = p_id
  returning * into cur;

  return cur;
end;
$$;

revoke all on function public.gefen_tender_append_knowledge_field(text, text, jsonb) from public, anon;
grant execute on function public.gefen_tender_append_knowledge_field(text, text, jsonb) to service_role;
comment on function public.gefen_tender_append_knowledge_field(text, text, jsonb) is
  'Append-only merge into knowledge_items or unassigned_knowledge_items; preserves final_answers.';

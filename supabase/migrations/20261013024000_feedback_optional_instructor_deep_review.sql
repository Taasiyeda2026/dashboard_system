-- Optional five-minute instructor deep-review, attached atomically to the final questionnaire.
-- Does not alter the existing published templates, answers, or public submit contract.

create table if not exists public.feedback_instructor_extended_reviews (
  response_id uuid primary key references public.feedback_responses(id) on delete cascade,
  opted_in boolean not null,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint feedback_instructor_extended_reviews_items_array check (jsonb_typeof(items) = 'array'),
  constraint feedback_instructor_extended_reviews_declined_empty check (opted_in or items = '[]'::jsonb)
);

alter table public.feedback_instructor_extended_reviews enable row level security;
revoke all on public.feedback_instructor_extended_reviews from public, anon, authenticated;

create or replace function public.feedback_public_submit_instructor_review(
  p_token text,
  p_submission_id uuid,
  p_answers jsonb,
  p_duration_seconds integer,
  p_review jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target record;
  v_campaign public.feedback_campaigns;
  v_item jsonb;
  v_opts jsonb;
  v_result jsonb;
  v_response_id uuid;
  v_opted_in boolean;
  v_items jsonb;
begin
  if p_review is null or jsonb_typeof(p_review) <> 'object'
     or jsonb_typeof(p_review->'opted_in') <> 'boolean'
     or jsonb_typeof(p_review->'items') <> 'array'
     or pg_column_size(p_review) > 50000 then
    return jsonb_build_object('ok', false, 'state', 'invalid_review');
  end if;

  v_opted_in := (p_review->>'opted_in')::boolean;
  v_items := p_review->'items';
  if jsonb_array_length(v_items) > 8
     or (not v_opted_in and v_items <> '[]'::jsonb)
     or (v_opted_in and jsonb_array_length(v_items) = 0) then
    return jsonb_build_object('ok', false, 'state', 'invalid_review');
  end if;

  -- Validate untrusted data before accepting the main questionnaire; errors leave no partial response.
  for v_item in select value from jsonb_array_elements(v_items) loop
    -- Guard types in separate statements so a malformed scalar never reaches
    -- jsonb_array_length() and missing required fields cannot slip through NULL booleans.
    if jsonb_typeof(v_item) is distinct from 'object' then
      return jsonb_build_object('ok', false, 'state', 'invalid_review');
    end if;
    if jsonb_typeof(v_item->'actions') is distinct from 'array' then
      return jsonb_build_object('ok', false, 'state', 'invalid_review');
    end if;
    if jsonb_typeof(v_item->'area') is distinct from 'string'
       or coalesce(v_item->>'area', '') not in ('content', 'slides', 'activity', 'structure', 'materials', 'equipment', 'other')
       or jsonb_array_length(v_item->'actions') = 0
       or jsonb_array_length(v_item->'actions') > 9
       or jsonb_typeof(v_item->'issue') is distinct from 'string'
       or jsonb_typeof(v_item->'recommendation') is distinct from 'string'
       or coalesce(char_length(btrim(v_item->>'issue')), 0) not between 1 and 2000
       or coalesce(char_length(btrim(v_item->>'recommendation')), 0) not between 1 and 2000
       or coalesce(char_length(v_item->>'meeting'), 0) > 60
       or coalesce(char_length(v_item->>'reference'), 0) > 160
       or coalesce(v_item->>'priority', '') not in ('urgent', 'high', 'normal') then
      return jsonb_build_object('ok', false, 'state', 'invalid_review');
    end if;

    if exists (
      select 1 from jsonb_array_elements_text(v_item->'actions') a(value)
      where a.value not in ('fix','update','replace','reorder','simplify','illustrate','engage','extend','remove')
    ) then
      return jsonb_build_object('ok', false, 'state', 'invalid_review');
    end if;
  end loop;

  select * into v_target from private.feedback_token_target(p_token, true) limit 1;
  if v_target.campaign_id is null then
    return jsonb_build_object('ok', false, 'state', 'invalid');
  end if;
  select * into v_campaign from public.feedback_campaigns where id = v_target.campaign_id;
  if v_campaign.audience <> 'instructor' or v_campaign.stage not in ('final','final_b') then
    return jsonb_build_object('ok', false, 'state', 'invalid_review');
  end if;

  -- Reuse the existing locked, idempotent questionnaire submit; both writes share one transaction.
  v_result := public.feedback_public_submit(p_token, p_submission_id, p_answers, p_duration_seconds);
  if coalesce((v_result->>'ok')::boolean, false) then
    select r.id into v_response_id
    from public.feedback_responses r
    where r.campaign_id = v_target.campaign_id
      and r.client_submission_id = p_submission_id
      and r.recipient_id is not distinct from v_target.recipient_id;
    if v_response_id is null then
      raise exception 'feedback_review_response_not_found' using errcode = 'P0001';
    end if;
    insert into public.feedback_instructor_extended_reviews (response_id, opted_in, items)
    values (v_response_id, v_opted_in, v_items)
    on conflict (response_id) do nothing;
  end if;
  return v_result;
end $$;

revoke all on function public.feedback_public_submit_instructor_review(text, uuid, jsonb, integer, jsonb) from public;
grant execute on function public.feedback_public_submit_instructor_review(text, uuid, jsonb, integer, jsonb) to anon, authenticated;

-- Detailed improvement recommendations are shown only to authorized feedback viewers.
-- The existing answer facts remain untouched and are never merged with these notes.
create or replace function public.feedback_admin_instructor_review_items(p_academic_year text default null)
returns table (
  response_id uuid,
  program_key text,
  academic_year text,
  instructor_name text,
  submitted_at timestamptz,
  item_number integer,
  area text,
  meeting text,
  reference text,
  actions text[],
  issue text,
  recommendation text,
  priority text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.feedback_can_view() then
    raise exception 'feedback_forbidden' using errcode = '42501';
  end if;
  return query
    select r.id, c.program_key, c.academic_year,
           coalesce(rc.display_name, c.instructor_name),
           r.submitted_at, i.ordinality::int,
           i.item->>'area', i.item->>'meeting', i.item->>'reference',
           array(select jsonb_array_elements_text(i.item->'actions')),
           i.item->>'issue', i.item->>'recommendation', i.item->>'priority'
    from public.feedback_instructor_extended_reviews x
    join public.feedback_responses r on r.id = x.response_id
    join public.feedback_campaigns c on c.id = r.campaign_id
    left join public.feedback_recipients rc on rc.id = r.recipient_id
    cross join lateral jsonb_array_elements(x.items) with ordinality i(item, ordinality)
    where x.opted_in and (p_academic_year is null or c.academic_year = p_academic_year)
    order by c.program_key, r.submitted_at, i.ordinality;
end $$;
revoke all on function public.feedback_admin_instructor_review_items(text) from public, anon;
grant execute on function public.feedback_admin_instructor_review_items(text) to authenticated;

notify pgrst, 'reload schema';

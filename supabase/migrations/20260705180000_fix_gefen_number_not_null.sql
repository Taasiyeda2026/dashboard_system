-- Fix: save_proposal_agreement_items_atomic uses nullif(item->>'gefen_number', '')
-- which converts empty string to NULL, then fails the NOT NULL constraint on
-- proposal_agreement_items.gefen_number (defined NOT NULL DEFAULT '').
-- Fix: wrap with coalesce(..., '') so empty string is preserved instead of NULL.

CREATE OR REPLACE FUNCTION public.save_proposal_agreement_items_atomic(
  p_proposal_id uuid,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE(id uuid, item_name text, sort_order integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM public.proposals_agreements
  WHERE proposals_agreements.id = p_proposal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal_agreement_not_found';
  END IF;

  IF v_status = 'sent' THEN
    RAISE EXCEPTION 'proposal_agreement_sent_locked';
  END IF;

  DELETE FROM public.proposal_agreement_items
  WHERE proposal_agreement_id = p_proposal_id;

  RETURN QUERY
  INSERT INTO public.proposal_agreement_items (
    proposal_agreement_id, activity_no, item_name, item_type, gefen_number,
    meetings_count, hours_count, quantity, unit_price, hourly_price, total_price,
    description, course_note, unit_duration, proposal_group, sort_order,
    proposal_display_mode, source_pricing_key, selected_bundle_items, list_id
  )
  SELECT
    p_proposal_id,
    nullif(item->>'activity_no', ''),
    nullif(item->>'item_name', ''),
    coalesce(nullif(item->>'item_type', ''), 'פעילות'),
    coalesce(nullif(item->>'gefen_number', ''), ''),
    nullif(item->>'meetings_count', '')::numeric,
    nullif(item->>'hours_count', '')::numeric,
    coalesce(nullif(item->>'quantity', '')::numeric, 1),
    nullif(item->>'unit_price', '')::numeric,
    nullif(item->>'hourly_price', '')::numeric,
    nullif(item->>'total_price', '')::numeric,
    nullif(item->>'description', ''),
    nullif(item->>'course_note', ''),
    nullif(item->>'unit_duration', ''),
    nullif(item->>'proposal_group', ''),
    coalesce(nullif(item->>'sort_order', '')::integer, ordinality::integer - 1),
    coalesce(nullif(item->>'proposal_display_mode', ''), 'single'),
    nullif(item->>'source_pricing_key', ''),
    coalesce(item->'selected_bundle_items', '[]'::jsonb),
    nullif(item->>'list_id', '')::bigint
  FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) WITH ORDINALITY AS input(item, ordinality)
  RETURNING proposal_agreement_items.id, proposal_agreement_items.item_name, proposal_agreement_items.sort_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_proposal_agreement_items_atomic(uuid, jsonb) TO authenticated;

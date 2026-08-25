import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260825120000_prefill_israa_activity_drafts.sql', import.meta.url),
  'utf8'
);

test('Israa draft defaults use the matching canonical proposal line and known tracking metadata', () => {
  assert.match(migration, /where id = p_proposal_item_id and proposal_agreement_id = v_tracking\.proposal_agreement_id/);
  for (const source of [
    'v_item.item_name', 'v_item.item_type', 'v_item.activity_no', 'v_item.gefen_number',
    'v_item.meetings_count', 'v_item.quantity', 'v_tracking.contact_person',
    'v_tracking.phone', 'v_tracking.email', 'v_tracking.grade'
  ]) assert.match(migration, new RegExp(source.replaceAll('.', '\\.')));
});

test('Israa activity price prefers unit price and only derives a unit from total divided by quantity', () => {
  assert.match(migration, /v_item\.unit_price,[\s\S]*v_item\.total_price \/ nullif\(greatest\(1, coalesce\(v_item\.quantity/);
  assert.doesNotMatch(migration, /coalesce\(v_item\.total_price, v_item\.unit_price\)/);
});

test('existing draft edits win while Gefen funding is only a default', () => {
  assert.match(migration, /p_draft := coalesce\(v_existing_draft[\s\S]*\|\| coalesce\(p_draft/);
  assert.match(migration, /'price', coalesce\([\s\S]*p_draft->>'price'[\s\S]*v_item\.unit_price/);
  assert.match(migration, /'funding', coalesce\(nullif\(btrim\(p_draft->>'funding'\)[\s\S]*then 'גפן' end\)/);
  assert.match(migration, /on conflict \(israa_tracking_id, israa_source_item_id, israa_group_number\)/);
});

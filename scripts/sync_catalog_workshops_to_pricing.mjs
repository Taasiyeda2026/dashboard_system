/**
 * sync_catalog_workshops_to_pricing.mjs
 *
 * Reads activities.json (the summer catalog) and upserts workshop entries
 * into proposal_activity_pricing in Supabase.
 *
 * Mapping:
 *   activities.json.id            → activity_no  (as string, prefixed "cat-")
 *   activities.json.workshopName  → activity_name
 *   activities.json.domain        → catalog_group
 *   activities.json.durationMinutes → unit_duration ("45 דקות")
 *   activities.json.description   → description_for_proposal
 *   activities.json.personalProduct → description_short (not a DB column — ignored if absent)
 *   domain = "חלל"               → parent_pricing_key = "space_workshop"
 *   otherwise                    → parent_pricing_key = "maker_workshop"
 *
 * Parent bundle rows (maker_workshop / space_workshop) are upserted first
 * if they do not already exist or need to be updated.
 *
 * Run:
 *   SUPABASE_URL=<url> SUPABASE_SERVICE_KEY=<key> node scripts/sync_catalog_workshops_to_pricing.mjs
 *
 * Dry-run (print SQL-like payload, no writes):
 *   SYNC_DRY_RUN=1 node scripts/sync_catalog_workshops_to_pricing.mjs
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT_DIR   = join(__dirname, '..');

// ─── Config ──────────────────────────────────────────────────────────────────

const ACTIVITIES_JSON_PATH = join(ROOT_DIR, 'frontend', 'public', 'catalog', 'summercatalog', 'activities.json');
const DRY_RUN = process.env.SYNC_DRY_RUN === '1' || process.env.SYNC_DRY_RUN === 'true';

// activity_no prefix used for catalog-sourced rows so they don't collide with
// manually maintained pricing rows that may already exist with numeric IDs.
const CAT_PREFIX = 'cat-';

// Parent bundle rows that must exist before child rows are written.
const BUNDLE_PARENTS = [
  {
    pricing_key:          'maker_workshop',
    activity_name:        'סדנאות STEM',
    proposal_display_mode:'bundle_parent',
    is_bundle_parent:     true,
    is_active_for_proposals: true,
    proposal_bundle_label:'סדנאות STEM',
    item_type:            'סדנה',
    sort_order:           10,
    catalog_group:        'makers'
  },
  {
    pricing_key:          'space_workshop',
    activity_name:        'סדנאות חלל',
    proposal_display_mode:'bundle_parent',
    is_bundle_parent:     true,
    is_active_for_proposals: true,
    proposal_bundle_label:'סדנאות חלל',
    item_type:            'סדנה',
    sort_order:           11,
    catalog_group:        'space'
  }
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing required env var: ${name}`);
  return String(v).trim();
}

function asText(v) {
  return v == null ? '' : String(v).trim();
}

function durationLabel(minutes) {
  const n = Number(minutes);
  if (!n) return '';
  return `${n} דקות`;
}

function parentKeyForDomain(domain) {
  const d = asText(domain);
  if (d === 'חלל') return 'space_workshop';
  return 'maker_workshop';
}

function bundleLabelForDomain(domain) {
  const d = asText(domain);
  if (d === 'חלל') return 'סדנאות חלל';
  return 'סדנאות STEM';
}

function catalogGroupForDomain(domain) {
  const d = asText(domain);
  if (d === 'חלל') return 'space';
  // Map other Hebrew domain names to sensible catalog_group values.
  const map = {
    'תעופה':    'makers',
    'אופטיקה':  'makers',
    'ביומימיקרי':'makers',
    'קיימות':   'makers',
    'כימיה':    'makers',
    'ביולוגיה': 'makers',
    'פיזיקה':   'makers',
    'הנדסה':    'makers',
    'AI':       'makers',
    'מדעי כדור הארץ': 'makers'
  };
  return map[d] || 'makers';
}

// ─── Read & transform ─────────────────────────────────────────────────────────

async function loadActivities() {
  const raw = await readFile(ACTIVITIES_JSON_PATH, 'utf8');
  const json = JSON.parse(raw);

  const groups = Array.isArray(json.gradeGroups) ? json.gradeGroups : [];
  const all = [];
  for (const group of groups) {
    const acts = Array.isArray(group.activities) ? group.activities : [];
    for (const act of acts) {
      // Only include actual workshops (activityType "סדנה" or unset).
      // Escape-rooms and חדר-בריחה are kept out of the STEM/Space bundle lists.
      const actType = asText(act.activityType);
      if (actType && actType !== 'סדנה') continue;

      all.push(act);
    }
  }
  return all;
}

function mapActivityToPricingRow(act, sortBase) {
  const actNo = `${CAT_PREFIX}${act.id}`;
  const parentKey = parentKeyForDomain(act.domain);
  const bundleLabel = bundleLabelForDomain(act.domain);
  const catalogGroup = catalogGroupForDomain(act.domain);

  return {
    // Identity
    activity_no:           actNo,
    activity_name:         asText(act.workshopName),
    pricing_key:           actNo,       // unique key per row
    parent_pricing_key:    parentKey,

    // Display / proposal
    proposal_display_mode: 'bundle_child',
    is_bundle_parent:      false,
    is_active_for_proposals: true,
    proposal_bundle_label: bundleLabel,

    // Content from catalog
    catalog_group:         catalogGroup,
    unit_duration:         durationLabel(act.durationMinutes),
    description_for_proposal: asText(act.description),

    // Pricing — not in activities.json; leave null so the pricing team fills them
    unit_price:            null,
    hourly_price:          null,

    // Metadata
    item_type:             'סדנה',
    sort_order:            sortBase,

    // No gefen, hours, meetings for workshops
    gefen_number:          '',
    hours_count:           null,
    meetings_count:        null
  };
}

// ─── Supabase upsert ──────────────────────────────────────────────────────────

async function upsertRows(supabase, rows, label) {
  if (!rows.length) {
    console.log(`  ${label}: nothing to upsert`);
    return;
  }
  if (DRY_RUN) {
    console.log(`  [DRY RUN] ${label}: would upsert ${rows.length} row(s)`);
    for (const r of rows) console.log('   ', JSON.stringify(r));
    return;
  }
  const { error } = await supabase
    .from('proposal_activity_pricing')
    .upsert(rows, { onConflict: 'pricing_key' });
  if (error) {
    throw new Error(`Supabase upsert failed for ${label}: ${error.message}`);
  }
  console.log(`  ✓ ${label}: upserted ${rows.length} row(s)`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== sync_catalog_workshops_to_pricing ${DRY_RUN ? '[DRY RUN]' : ''} ===\n`);

  let supabase;
  if (!DRY_RUN) {
    const url = requireEnv('SUPABASE_URL');
    const key = requireEnv('SUPABASE_SERVICE_KEY');
    supabase = createClient(url, key);
  }

  // 1. Load activities
  console.log('Loading activities.json...');
  const activities = await loadActivities();
  console.log(`  Found ${activities.length} workshops (excluding escape-rooms)`);

  // 2. Upsert parent bundle rows
  console.log('\nUpserting bundle parent rows...');
  await upsertRows(supabase, BUNDLE_PARENTS, 'bundle parents');

  // 3. Map catalog workshops → pricing rows
  console.log('\nMapping catalog workshops → pricing rows...');
  const pricingRows = activities.map((act, idx) => mapActivityToPricingRow(act, 100 + idx));
  console.log(`  Mapped ${pricingRows.length} rows`);

  // 4. Upsert workshops
  console.log('\nUpserting workshop rows...');
  // Split into chunks to avoid hitting Supabase row limits
  const CHUNK = 50;
  for (let i = 0; i < pricingRows.length; i += CHUNK) {
    const chunk = pricingRows.slice(i, i + CHUNK);
    await upsertRows(supabase, chunk, `workshops chunk ${Math.floor(i / CHUNK) + 1}`);
  }

  // 5. Summary
  console.log('\n=== Sync complete ===');
  console.log(`  ${pricingRows.length} workshop rows synced`);
  console.log(`  ${BUNDLE_PARENTS.length} parent bundle rows ensured`);
  if (DRY_RUN) console.log('  (dry-run — no actual writes performed)');

  // Print the pricing_keys that were synced so the caller can verify
  const spaceCount = pricingRows.filter((r) => r.parent_pricing_key === 'space_workshop').length;
  const makerCount = pricingRows.filter((r) => r.parent_pricing_key === 'maker_workshop').length;
  console.log(`  → space_workshop children: ${spaceCount}`);
  console.log(`  → maker_workshop children: ${makerCount}`);
}

main().catch((err) => {
  console.error('\n[sync-catalog-to-pricing] ERROR:', err.message || err);
  process.exit(1);
});

import { api } from './api.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const PATCH_KEY = Symbol.for('taasiyeda.adminListsAuthHotfix');
const LIST_COLUMNS = 'list_id,category,value,label,label_he,active,is_active,category_order,sort_order,activity_no,activity_name,activity_type,type,stock_quantity,stock_group_key,stock_group_name,stock_item_name,stock_label,parent_value';

function hasInventoryCatalog(payload = {}) {
  const categories = Array.isArray(payload?.categories) ? payload.categories : [];
  return categories.some(({ category, items }) =>
    String(category || '').trim().toLowerCase() === 'activity_names'
    && Array.isArray(items)
    && items.length > 0
  );
}

function groupListRows(rows = []) {
  const categoryMap = new Map();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const category = String(row?.category || '').trim();
    const value = String(row?.value ?? '').trim();
    if (!category || !value) continue;
    const label = String(row?.label ?? row?.label_he ?? value).trim() || value;
    if (!categoryMap.has(category)) categoryMap.set(category, []);
    categoryMap.get(category).push({ label, value, active: row?.active, _row: row });
  }
  return {
    categories: Array.from(categoryMap, ([category, items]) => ({ category, items })),
    _source: 'supabase-auth-retry'
  };
}

async function readFreshListsAfterAuth() {
  if (!supabase) return null;
  await waitForSupabaseAuthSession();
  const result = await supabase
    .from('lists')
    .select(LIST_COLUMNS)
    .order('category_order', { ascending: true, nullsFirst: false })
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('category', { ascending: true })
    .order('value', { ascending: true });
  if (result.error) throw result.error;
  return groupListRows(result.data);
}

export function installAdminListsAuthHotfix(targetApi = api) {
  if (!targetApi || targetApi[PATCH_KEY] || typeof targetApi.adminLists !== 'function') return false;
  const originalAdminLists = targetApi.adminLists.bind(targetApi);

  targetApi.adminLists = async (...args) => {
    try {
      await waitForSupabaseAuthSession();
    } catch {
      // The original loader still gets a chance to return its normal error payload.
    }

    const current = await originalAdminLists(...args);
    if (hasInventoryCatalog(current)) return current;

    try {
      const fresh = await readFreshListsAfterAuth();
      if (hasInventoryCatalog(fresh)) return fresh;
      return {
        ...(fresh || current || {}),
        _loadError: 'inventory_catalog_missing_after_auth_retry'
      };
    } catch (error) {
      return {
        ...(current || { categories: [] }),
        _loadError: String(error?.message || 'admin_lists_auth_retry_failed')
      };
    }
  };

  Object.defineProperty(targetApi, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return true;
}

installAdminListsAuthHotfix(api);

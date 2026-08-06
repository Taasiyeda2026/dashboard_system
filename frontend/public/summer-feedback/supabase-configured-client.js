import { createClient as createSupabaseClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.3/+esm?dashboard-embedded-client=1';

const EMBEDDED_CONFIG_KEY = '__dashboardSummerFeedbackConfig';

function readDashboardConfig() {
  if (window.parent === window) return null;
  try {
    const config = window.parent?.[EMBEDDED_CONFIG_KEY];
    const url = String(config?.url || '').trim();
    const publishableKey = String(config?.publishableKey || '').trim();
    return url && publishableKey ? { url, publishableKey } : null;
  } catch {
    return null;
  }
}

export function createClient(defaultUrl, defaultPublishableKey, options) {
  const dashboardConfig = readDashboardConfig();
  return createSupabaseClient(
    dashboardConfig?.url || defaultUrl,
    dashboardConfig?.publishableKey || defaultPublishableKey,
    options
  );
}

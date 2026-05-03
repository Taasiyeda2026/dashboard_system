const FINANCE_LAST_USER_KEY = 'finance_last_user_id';

const FINANCE_ALL_PREF_KEYS = [
  'finance_search', 'finance_status_filter',
  'finance_month_ym', 'finance_tab', 'finance_view_mode',
  'finance_mgr_sort_col', 'finance_mgr_sort_dir',
  'finance_table_sort_col', 'finance_table_sort_dir',
  'finance_last_user_id'
];

function clearAllFinancePrefs() {
  FINANCE_ALL_PREF_KEYS.forEach((k) => localStorage.removeItem(k));
}

export function clearFinancePrefsIfUserChanged(userId) {
  const currentUserId = String(userId || '');
  const storedUserId = localStorage.getItem(FINANCE_LAST_USER_KEY) || '';
  if (currentUserId && storedUserId && currentUserId !== storedUserId) {
    clearAllFinancePrefs();
  }
  if (currentUserId) {
    localStorage.setItem(FINANCE_LAST_USER_KEY, currentUserId);
  }
}

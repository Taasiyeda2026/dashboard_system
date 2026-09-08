import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';

const typeCache = new Map();
let refreshToken = 0;

function text(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeKey(value) {
  return text(value).toLocaleLowerCase('he-IL');
}

function selectedManager() {
  const root = document.querySelector('[data-manager-board-root]');
  const select = root?.querySelector('[data-manager-board-manager]');
  if (select?.value) return text(select.value);
  return text(root?.querySelector('.manager-board-manager-fixed strong')?.textContent);
}

function activityTypeLabel(rawType) {
  const value = normalizeKey(rawType);
  if (value.includes('workshop') || value.includes('סדנה')) return 'סדנה';
  if (value.includes('course') || value.includes('קורס')) return 'קורס';
  if (value.includes('tour') || value.includes('סיור')) return 'סיור';
  return 'פעילות';
}

function activityKey(name, school) {
  return `${normalizeKey(name)}|${normalizeKey(school)}`;
}

async function loadManagerTypeMap(manager) {
  const cacheKey = normalizeKey(manager);
  if (!cacheKey || !supabase) return new Map();
  if (typeCache.has(cacheKey)) return typeCache.get(cacheKey);

  const promise = (async () => {
    await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
    const { data, error } = await supabase
      .from('activities')
      .select('activity_type,activity_name,program_name,school')
      .eq('activity_manager', manager);
    if (error) throw error;
    const map = new Map();
    (Array.isArray(data) ? data : []).forEach((row) => {
      const name = text(row.activity_name || row.program_name);
      const school = text(row.school);
      const key = activityKey(name, school);
      if (name && !map.has(key)) map.set(key, activityTypeLabel(row.activity_type));
    });
    return map;
  })().catch((error) => {
    console.warn('[manager-board-copy] activity type lookup failed', error);
    return new Map();
  });

  typeCache.set(cacheKey, promise);
  return promise;
}

function correctedMilestoneLabel(current, typeLabel) {
  const labels = [];
  if (current.includes('תחילת')) labels.push(`תחילת ${typeLabel}`);
  if (current.includes('אמצע')) labels.push(`אמצע ${typeLabel}`);
  if (current.includes('סיום')) labels.push(`סיום ${typeLabel}`);
  return labels.join(' · ') || current.replace(/\s*·\s*מפגש\s*1\b/g, '');
}

async function refreshMilestones() {
  const rows = [...document.querySelectorAll('.manager-board-milestone')];
  if (!rows.length) return;
  const manager = selectedManager();
  if (!manager) return;
  const token = ++refreshToken;
  const typeMap = await loadManagerTypeMap(manager);
  if (token !== refreshToken) return;

  rows.forEach((row) => {
    const name = text(row.querySelector('.manager-board-milestone__body strong')?.textContent);
    const school = text(row.querySelector('.manager-board-milestone__body span')?.textContent);
    const badge = row.querySelector('.manager-board-milestone__badge');
    if (!badge) return;
    const current = text(badge.textContent);
    const typeLabel = typeMap.get(activityKey(name, school)) || (current.includes('סדנה') ? 'סדנה' : 'קורס');
    badge.textContent = correctedMilestoneLabel(current, typeLabel);
  });
}

function scheduleRefresh() {
  queueMicrotask(() => void refreshMilestones());
}

if (typeof document !== 'undefined') {
  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('change', (event) => {
    if (event.target instanceof Element && event.target.matches('[data-manager-board-manager]')) {
      typeCache.clear();
      scheduleRefresh();
    }
  });
  scheduleRefresh();
}

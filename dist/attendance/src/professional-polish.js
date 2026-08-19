function decimalHoursToClock(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const totalMinutes = Math.round(numeric * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

function formatDisplayedHours(root = document) {
  for (const node of root.querySelectorAll?.('.av2-report__hours-value') || []) {
    const formatted = decimalHoursToClock(node.textContent);
    if (formatted) node.textContent = formatted;
  }

  for (const row of root.querySelectorAll?.('.av2-summary__row') || []) {
    const label = String(row.querySelector('span')?.textContent || '').trim();
    if (label !== 'סך שעות') continue;
    const value = row.querySelector('strong');
    const formatted = decimalHoursToClock(value?.textContent);
    if (formatted && value) value.textContent = formatted;
  }
}

function scheduleFormat() {
  requestAnimationFrame(() => formatDisplayedHours(document));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scheduleFormat, { once: true });
} else {
  scheduleFormat();
}

const observer = new MutationObserver(scheduleFormat);
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

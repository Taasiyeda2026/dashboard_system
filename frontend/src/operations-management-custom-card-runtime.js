const CUSTOM_TAB_KEYS = new Set([
  'summer_training_matrix',
  'course_training_matrix',
  'course_print_kits'
]);

const TILE_SELECTOR = '.operations-management-home__tile[data-operations-management-target-type="ops-custom-tab"]';
const MAX_ATTEMPTS = 14;
const RETRY_DELAY_MS = 90;

const pending = new Map();

function operations2027Root() {
  return document.querySelector(
    '.ds-ops-mgmt-screen[data-ops-year="2027"], .ds-ops-mgmt-screen.ops-year-2027'
  );
}

function targetButton(tabKey) {
  return operations2027Root()?.querySelector?.(
    `.ds-ops-mgmt-tabs [data-ops-custom-tab="${tabKey}"]`
  ) || null;
}

function finish(tabKey, token) {
  if (pending.get(tabKey) === token) pending.delete(tabKey);
}

function openWhenReady(tabKey) {
  if (!CUSTOM_TAB_KEYS.has(tabKey)) return;

  const token = Symbol(tabKey);
  pending.set(tabKey, token);

  const attemptOpen = (attempt = 0) => {
    if (pending.get(tabKey) !== token) return;

    const button = targetButton(tabKey);
    if (button?.classList?.contains('is-active')) {
      finish(tabKey, token);
      return;
    }

    if (button) button.click();

    window.setTimeout(() => {
      if (pending.get(tabKey) !== token) return;
      const current = targetButton(tabKey);
      if (current?.classList?.contains('is-active')) {
        finish(tabKey, token);
        return;
      }
      if (attempt >= MAX_ATTEMPTS) {
        finish(tabKey, token);
        return;
      }
      attemptOpen(attempt + 1);
    }, RETRY_DELAY_MS);
  };

  attemptOpen();
}

function handleHomeCardClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  const tile = target?.closest?.(TILE_SELECTOR);
  if (!tile) return;

  const tabKey = String(tile.getAttribute('data-operations-management-target-value') || '');
  if (!CUSTOM_TAB_KEYS.has(tabKey)) return;

  event.preventDefault();
  queueMicrotask(() => openWhenReady(tabKey));
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', handleHomeCardClick, true);
}

export { CUSTOM_TAB_KEYS, openWhenReady };

import { escapeHtml } from './html.js';

/**
 * שורת חיפוש וסינון קטנה לרשימות בעמוד (סינון לקוח בלבד ב־DOM).
 * אלמנטים לסינון: `data-list-item` + `data-search` (טקסט) + אופציונלי `data-filter` (ערך או ערכים מופרדים ברווח).
 */
export function dsPageListToolsBar(options = {}) {
  const { searchPlaceholder = 'חיפוש ברשימה…', filterLabel = 'סינון', filters = [] } = options;
  const selectHtml =
    filters.length > 0
      ? `<select class="ds-input ds-input--sm ds-page-list-tools__select" data-page-f aria-label="${escapeHtml(filterLabel)}"><option value="">${escapeHtml(
          'הכול'
        )}</option>${filters
          .map((f) => `<option value="${escapeHtml(String(f.value))}">${escapeHtml(f.label)}</option>`)
          .join('')}</select>`
      : '';
  return `<div class="ds-page-list-tools" role="search" aria-label="חיפוש וסינון בעמוד">
    <input type="search" class="ds-input ds-input--sm ds-page-list-tools__q" data-page-q placeholder="${escapeHtml(
      searchPlaceholder
    )}" aria-label="חיפוש" />
    ${selectHtml}
  </div>`;
}

/**
 * @param {HTMLElement} root
 * @param {{ mode?: 'hide' | 'dim' }} [opts] — `dim` לתאים בלוח חודש שלא ניתן להסתיר בלי לשבור רשת
 */
export function bindPageListTools(root, opts = {}) {
  const mode = opts.mode || 'hide';
  const q = root.querySelector('[data-page-q]');
  const f = root.querySelector('[data-page-f]');
  if (!q && !f) return;
  if (root._pageListToolsAbort) root._pageListToolsAbort.abort();
  root._pageListToolsAbort = new AbortController();
  const listenerOptions = { signal: root._pageListToolsAbort.signal };
  let debounceTimer = null;
  const apply = () => {
    const qv = (q?.value || '').trim().toLowerCase();
    const fv = (f?.value || '').trim();
    root.querySelectorAll('[data-list-item]').forEach((el) => {
      const hay = (el.getAttribute('data-search') || '').toLowerCase();
      const fkRaw = el.getAttribute('data-filter') || '';
      const fkParts = fkRaw.split(/\s+/).filter(Boolean);
      const okQ = !qv || hay.includes(qv);
      const okF = !fv || fkParts.includes(fv);
      if (mode === 'dim') {
        el.classList.toggle('is-page-search-dim', !(okQ && okF));
      } else {
        el.toggleAttribute('hidden', !(okQ && okF));
      }
    });
  };
  const applyDebounced = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(apply, 120);
  };
  q?.addEventListener('input', applyDebounced, listenerOptions);
  f?.addEventListener('change', apply, listenerOptions);
}

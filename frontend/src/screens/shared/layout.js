import { escapeHtml } from './html.js';

/** Page title row — use on every screen for hierarchy consistency */
export function dsPageHeader(title, subtitle = '') {
  const sub = subtitle
    ? `<p class="ds-page-header__subtitle">${escapeHtml(subtitle)}</p>`
    : '';
  return `<header class="ds-page-header"><h1 class="ds-page-header__title">${escapeHtml(title)}</h1>${sub}</header>`;
}

/** Primary content column inside screen root */
export function dsScreenStack(innerHtml) {
  return `<div class="ds-screen-stack">${innerHtml}</div>`;
}

/**
 * Card with optional header — replaces ad-hoc details blocks for tables.
 * @param {{ title: string, badge?: string, body: string, padded?: boolean }} opts
 */
export function dsCard({ title, badge = '', body, padded = true }) {
  const badgeHtml = badge
    ? `<span class="ds-badge" dir="rtl">${escapeHtml(badge)}</span>`
    : '';
  const padClass = padded ? ' ds-card__body--padded' : '';
  return `
    <section class="ds-card">
      <div class="ds-card__head">
        <h2 class="ds-card__title">${escapeHtml(title)}</h2>
        ${badgeHtml}
      </div>
      <div class="ds-card__body${padClass}">${body}</div>
    </section>
  `;
}

export function dsFilterBar(innerHtml) {
  return `<div class="ds-filter-bar" role="toolbar">${innerHtml}</div>`;
}

export function dsToolbar(innerHtml) {
  return `<div class="ds-toolbar">${innerHtml}</div>`;
}

export function dsTableWrap(tableHtml) {
  return `<div class="ds-table-wrap">${tableHtml}</div>`;
}

export function dsEmptyState(message) {
  return `<div class="ds-empty" role="status"><p class="ds-empty__msg">${escapeHtml(message)}</p></div>`;
}

export function dsKpiGrid(items) {
  const cells = items
    .map(
      (item) => `
    <article class="ds-kpi">
      <p class="ds-kpi__label">${escapeHtml(item.label)}</p>
      <p class="ds-kpi__value">${escapeHtml(String(item.value ?? ''))}</p>
      ${item.hint ? `<p class="ds-kpi__hint">${escapeHtml(item.hint)}</p>` : ''}
    </article>`
    )
    .join('');
  return `<div class="ds-kpi-grid">${cells}</div>`;
}

/**
 * Shared clickable card primitive for KPI / mini cards / day cells / session cards.
 * Requires an explicit action key to avoid ambiguous clickable behavior.
 */
export function dsInteractiveCard({
  action,
  title,
  subtitle = '',
  meta = '',
  variant = 'mini',
  selected = false,
  disabled = false,
  extraClass = ''
} = {}) {
  if (!action) {
    throw new Error('dsInteractiveCard requires action');
  }
  const selectedClass = selected ? ' is-selected' : '';
  const disabledAttr = disabled ? ' disabled aria-disabled="true"' : '';
  const subtitleHtml = subtitle ? `<p class="ds-interactive-card__subtitle">${escapeHtml(subtitle)}</p>` : '';
  const metaHtml = meta ? `<p class="ds-interactive-card__meta">${escapeHtml(meta)}</p>` : '';
  const moreClass = extraClass && /^[a-zA-Z0-9_\s-]+$/.test(extraClass) ? ` ${extraClass}` : '';

  return `
    <button
      type="button"
      class="ds-interactive-card ds-interactive-card--${escapeHtml(variant)}${selectedClass}${moreClass}"
      data-card-action="${escapeHtml(action)}"${disabledAttr}
    >
      <p class="ds-interactive-card__title">${escapeHtml(title)}</p>
      ${subtitleHtml}
      ${metaHtml}
    </button>
  `;
}

export function dsSkeletonLines(count = 3) {
  const lines = Array.from({ length: count }, (_, i) => {
    const mod = i === count - 1 ? ' ds-skeleton-line--short' : '';
    return `<div class="ds-skeleton-line${mod}" aria-hidden="true"></div>`;
  }).join('');
  return `<div class="ds-skeleton" aria-hidden="true">${lines}</div>`;
}

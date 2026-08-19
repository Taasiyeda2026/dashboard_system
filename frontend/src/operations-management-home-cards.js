const STYLE_ID = 'operations-management-home-cards-style';
const HOME_ATTRIBUTE = 'data-operations-management-home';
const PLACEHOLDER_TEXT = 'בחרו לשונית להצגת הנתונים.';
const CARD_LABELS = [
  'מלאי סדנאות',
  'הזמנות לאירועים',
  'קטלוג',
  'תעודות',
  'הכשרות סדנאות',
  'הכשרות קורסים',
  'ערכות דפוס'
];
let scheduled = false;

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function iconSvg(label) {
  const text = normalize(label);
  const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  if (text.includes('מלאי') || text.includes('ציוד')) return `<svg ${common}><path d="M4 7h16v13H4z"/><path d="M7 7V4h10v3M8 12h8M8 16h5"/></svg>`;
  if (text.includes('הזמנות')) return `<svg ${common}><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/><path d="M16 2v4M8 2v4"/></svg>`;
  if (text.includes('קטלוג')) return `<svg ${common}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z"/></svg>`;
  if (text.includes('תעודות') || text.includes('אישורי')) return `<svg ${common}><path d="M7 3h10v18H7z"/><path d="M10 8h4M10 12h4"/><path d="M9 17l2-1 2 1 2-1"/></svg>`;
  if (text.includes('הכשרות')) return `<svg ${common}><path d="M3 10l9-5 9 5-9 5z"/><path d="M7 13v4c3 2 7 2 10 0v-4"/></svg>`;
  if (text.includes('הרשאות')) return `<svg ${common}><path d="M12 3l7 3v5c0 4.4-2.8 8.4-7 10-4.2-1.6-7-5.6-7-10V6z"/><path d="M9.5 12l1.8 1.8 3.5-4"/></svg>`;
  if (text.includes('דפוס')) return `<svg ${common}><path d="M7 8V3h10v5"/><rect x="4" y="8" width="16" height="9" rx="2"/><path d="M7 14h10v7H7zM16 11h1"/></svg>`;
  if (text.includes('רשויות')) return `<svg ${common}><path d="M3 21h18M5 21V9l7-4 7 4v12"/><path d="M9 13h6M9 17h6"/></svg>`;
  return `<svg ${common}><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>`;
}

function descriptionFor(label) {
  const text = normalize(label);
  if (text.includes('מלאי') || text.includes('ציוד')) return 'ניהול מלאי, ציוד ופריטי סדנאות';
  if (text.includes('הזמנות')) return 'הזמנות לאירועים ומעקב תפעולי';
  if (text.includes('קטלוג')) return 'ניהול קטלוג הפעילויות והתכנים';
  if (text.includes('תעודות')) return 'הפקה וניהול של תעודות';
  if (text === 'הכשרות סדנאות') return 'ניהול הכשרות והיערכות לסדנאות';
  if (text === 'הכשרות קורסים') return 'ניהול הכשרות והיערכות לקורסים';
  if (text.includes('אישורי')) return 'בקרה והפקת אישורי ביצוע';
  if (text.includes('הכשרות')) return 'ניהול הכשרות והיערכות';
  if (text.includes('הרשאות')) return 'ניהול הרשאות וקורסים תפעוליים';
  if (text.includes('דפוס')) return 'ניהול ערכות וחומרי דפוס';
  if (text.includes('רשויות')) return 'מידע תפעולי לפי רשויות';
  return `פתיחת ${text}`;
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .operations-management-home {
      width: min(100%, 1040px);
      margin: 26px auto 0;
      padding: 0 8px 24px;
      direction: rtl;
    }
    .operations-management-home__heading {
      margin-bottom: 14px;
    }
    .operations-management-home__heading h2 {
      margin: 0;
      font-size: 18px;
      line-height: 1.3;
      color: var(--color-text, #172033);
      font-weight: 800;
    }
    .operations-management-home__grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }
    .operations-management-home__tile {
      appearance: none;
      min-width: 0;
      min-height: 120px;
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr) 18px;
      align-items: center;
      gap: 12px;
      padding: 17px;
      border: 1px solid var(--color-border, #dbe3ec);
      border-radius: 16px;
      background: var(--color-surface, #fff);
      color: var(--color-text, #172033);
      text-align: right;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
      transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
    }
    .operations-management-home__tile:hover {
      transform: translateY(-2px);
      border-color: var(--color-primary, #1597b8);
      box-shadow: 0 8px 22px rgba(15, 23, 42, .08);
    }
    .operations-management-home__tile:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--color-primary, #1597b8) 26%, transparent);
      outline-offset: 2px;
    }
    .operations-management-home__icon {
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      border: 1px solid var(--color-border, #dbe3ec);
      border-radius: 12px;
      background: var(--color-surface-muted, #f8fafc);
      color: var(--color-primary, #0f7f9b);
    }
    .operations-management-home__icon svg {
      width: 23px;
      height: 23px;
    }
    .operations-management-home__content {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .operations-management-home__content strong {
      font-size: 15.5px;
      line-height: 1.25;
      font-weight: 800;
    }
    .operations-management-home__content small {
      color: var(--color-text-secondary, #64748b);
      font-size: 12.5px;
      line-height: 1.45;
    }
    .operations-management-home__arrow {
      color: var(--color-text-secondary, #94a3b8);
      font-size: 23px;
      line-height: 1;
    }
    @media (max-width: 980px) {
      .operations-management-home__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 620px) {
      .operations-management-home { margin-top: 18px; }
      .operations-management-home__grid { grid-template-columns: 1fr; gap: 10px; }
      .operations-management-home__tile { min-height: 105px; padding: 14px; }
    }
  `;
  document.head.append(style);
}

function navButtons(nav) {
  const buttons = [...nav.querySelectorAll('button[data-ops-tab], button[data-route], button[data-ops-custom-tab]')]
    .filter((button) => normalize(button.textContent));
  const byLabel = new Map(buttons.map((button) => [normalize(button.textContent), button]));
  return CARD_LABELS.map((label) => byLabel.get(label)).filter(Boolean);
}

function findPlaceholder(nav) {
  const root = nav.closest('#app') || document.getElementById('app');
  if (!root) return null;
  const candidates = [...root.querySelectorAll('div, p')];
  return candidates.find((element) => normalize(element.textContent) === PLACEHOLDER_TEXT) || null;
}

function findHome(nav) {
  const root = nav.closest('#app') || document.getElementById('app');
  return root?.querySelector?.(`[${HOME_ATTRIBUTE}]`) || null;
}

function createHome() {
  const home = document.createElement('section');
  home.className = 'operations-management-home';
  home.setAttribute(HOME_ATTRIBUTE, 'true');
  home.innerHTML = `
    <div class="operations-management-home__heading">
      <h2>כלי התפעול</h2>
    </div>
    <div class="operations-management-home__grid"></div>
  `;
  return home;
}

function renderTiles(home, buttons) {
  const grid = home?.querySelector?.('.operations-management-home__grid');
  if (!grid) return;
  grid.replaceChildren();

  buttons.forEach((target) => {
    const label = normalize(target.textContent);
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'operations-management-home__tile';
    tile.innerHTML = `
      <span class="operations-management-home__icon">${iconSvg(label)}</span>
      <span class="operations-management-home__content">
        <strong></strong>
        <small></small>
      </span>
      <span class="operations-management-home__arrow" aria-hidden="true">‹</span>
    `;
    tile.querySelector('strong').textContent = label;
    tile.querySelector('small').textContent = descriptionFor(label);
    tile.setAttribute('aria-label', `פתיחת ${label}`);
    tile.addEventListener('click', () => {
      if (target.isConnected) target.click();
    });
    grid.append(tile);
  });
}

function buildOrSyncHome(nav, placeholder) {
  const buttons = navButtons(nav);
  if (!buttons.length) return;

  let home = findHome(nav);
  if (!home && placeholder) {
    home = createHome();
    placeholder.replaceWith(home);
  }
  if (!home) return;
  renderTiles(home, buttons);
}

function sync() {
  scheduled = false;
  ensureStyles();
  document.querySelectorAll('.ds-ops-mgmt-tabs').forEach((nav) => {
    const placeholder = findPlaceholder(nav);
    const home = findHome(nav);
    if (placeholder || home) buildOrSyncHome(nav, placeholder);
  });
}

function scheduleSync() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(sync);
}

function start() {
  ensureStyles();
  const root = document.getElementById('app') || document.documentElement;
  const observer = new MutationObserver(scheduleSync);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  document.addEventListener('app:navigate', scheduleSync);
  document.addEventListener('ops-mgmt-standard-tab', scheduleSync);
  scheduleSync();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

export const ACCENT_COLORS = {
  blue:   { accent: '#1a3358', hover: '#142a49', soft: '#e8eef6', stripe: '#eef3fb', stripeHover: '#e8f0fd' },
  green:  { accent: '#166534', hover: '#14532d', soft: '#eaf5ec', stripe: '#eaf5ec', stripeHover: '#dcf0e0' },
  purple: { accent: '#5b21b6', hover: '#4c1d95', soft: '#f3eefa', stripe: '#f3eefa', stripeHover: '#ece0f8' },
  orange: { accent: '#c2410c', hover: '#9a3412', soft: '#fdf3ea', stripe: '#fdf3ea', stripeHover: '#fce9d8' },
  gray:   { accent: '#334155', hover: '#1e293b', soft: '#f1f3f6', stripe: '#f1f3f6', stripeHover: '#e8eaee' },
  pink:   { accent: '#ed608a', hover: '#d94f79', soft: '#fdebf1', stripe: '#fdebf1', stripeHover: '#fbdde7' },
  cyan:   { accent: '#0292b7', hover: '#027b9b', soft: '#e6f7fb', stripe: '#e6f7fb', stripeHover: '#d8f1f7' }
};

export const ACCENT_LS_KEY = 'ds_global_accent';
export const LEGACY_STRIPE_LS_KEY = 'ds_activities_stripe';

export function normalizeAccentName(value) {
  const raw = String(value || '').trim();
  if (ACCENT_COLORS[raw]) return raw;
  const lower = raw.toLowerCase();
  const match = Object.entries(ACCENT_COLORS).find(([, colors]) =>
    [colors.accent, colors.hover, colors.soft, colors.stripe, colors.stripeHover]
      .some((color) => String(color).toLowerCase() === lower)
  );
  return match?.[0] || '';
}

export function accentNameFromStorage(clientSettings = {}) {
  try {
    return normalizeAccentName(localStorage.getItem(ACCENT_LS_KEY))
      || normalizeAccentName(localStorage.getItem(LEGACY_STRIPE_LS_KEY))
      || normalizeAccentName(clientSettings?.accent_color)
      || normalizeAccentName(clientSettings?.theme_accent)
      || normalizeAccentName(clientSettings?.ui_accent_color)
      || 'blue';
  } catch {
    return 'blue';
  }
}

export function applyGlobalAccent(name = accentNameFromStorage()) {
  const selected = normalizeAccentName(name) || 'blue';
  const colors = ACCENT_COLORS[selected];
  const root = document.documentElement;
  root.style.setProperty('--ds-accent', colors.accent);
  root.style.setProperty('--ds-accent-hover', colors.hover);
  root.style.setProperty('--ds-accent-soft', colors.soft);
  root.style.setProperty('--ds-interactive-selected', colors.soft);
  root.style.setProperty('--ds-activities-stripe', colors.stripe);
  root.style.setProperty('--ds-activities-stripe-hover', colors.stripeHover);
  root.style.setProperty('--ds-focus-ring', `0 0 0 2px color-mix(in srgb, ${colors.accent} 24%, transparent)`);
  root.style.setProperty('--ds-focus-ring-strong', `0 0 0 3px color-mix(in srgb, ${colors.accent} 30%, transparent)`);
  root.dataset.dsAccent = selected;
  document.querySelectorAll('[data-accent-picker-btn]').forEach((btn) => {
    btn.style.backgroundColor = colors.accent;
    btn.dataset.currentAccent = selected;
  });
  document.querySelectorAll('[data-accent-swatch]').forEach((sw) => { sw.classList.toggle('is-active', sw.dataset.accent === selected); });
  return selected;
}

let accentPickerBound = false;

export function bindAccentPickerOnce(options = {}) {
  if (accentPickerBound) return;
  accentPickerBound = true;
  const {
    getClientSettings = () => ({}),
    setClientSettings = () => {},
    saveRoutes = () => {},
    saveClientSetting = null
  } = options;

  document.addEventListener('click', (ev) => {
    const swatch = ev.target.closest('[data-accent-swatch]');
    if (swatch) {
      ev.preventDefault();
      const name = swatch.dataset.accent || 'blue';
      const selected = applyGlobalAccent(name);
      console.info('[accent-picker] selected', selected);
      try {
        localStorage.setItem(ACCENT_LS_KEY, selected);
        localStorage.setItem(LEGACY_STRIPE_LS_KEY, selected);
      } catch {}
      const nextSettings = {
        ...(getClientSettings() || {}),
        accent_color: selected,
        theme_accent: selected,
        ui_accent_color: selected
      };
      setClientSettings(nextSettings);
      saveRoutes(nextSettings);
      if (typeof saveClientSetting === 'function') {
        Promise.all(['accent_color', 'theme_accent', 'ui_accent_color']
          .map((key) => saveClientSetting({ key, value: selected })))
          .catch((err) => {
            console.warn('[accent-picker] Supabase accent save failed; local choice remains active:', err);
          });
      }
      const pop = swatch.closest('[data-accent-picker-popover]')
        || document.querySelector('[data-accent-picker-popover]');
      if (pop) {
        pop.hidden = true;
        if (pop.parentElement === document.body) {
          document.querySelector('[data-accent-picker-wrap]')?.appendChild(pop);
        }
      }
      return;
    }
    const btn = ev.target.closest('[data-accent-picker-btn]');
    if (btn) {
      ev.preventDefault();
      applyGlobalAccent();
      const wrap = btn.closest('[data-accent-picker-wrap]');
      const pop = wrap?.querySelector('[data-accent-picker-popover]')
        || document.querySelector('[data-accent-picker-popover]');
      if (!pop) return;
      if (pop.hidden) {
        const rect = btn.getBoundingClientRect();
        const popW = 36;
        let left = rect.left + rect.width / 2 - popW / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
        document.body.appendChild(pop);
        pop.style.position = 'fixed';
        pop.style.left = `${left}px`;
        pop.style.top = `${rect.top - 8}px`;
        pop.style.transform = 'translateY(-100%)';
        pop.style.zIndex = '99999';
        pop.hidden = false;
      } else {
        pop.hidden = true;
        if (pop.parentElement === document.body) {
          document.querySelector('[data-accent-picker-wrap]')?.appendChild(pop);
        }
      }
      return;
    }
    const pop = document.querySelector('[data-accent-picker-popover]');
    if (pop && !pop.hidden) {
      pop.hidden = true;
      if (pop.parentElement === document.body) {
        document.querySelector('[data-accent-picker-wrap]')?.appendChild(pop);
      }
    }
  });
}

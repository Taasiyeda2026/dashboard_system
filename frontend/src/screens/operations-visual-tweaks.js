function addOperationsVisualTweaksStyle() {
  if (document.getElementById('ops-visual-tweaks-style')) return;
  const style = document.createElement('style');
  style.id = 'ops-visual-tweaks-style';
  style.textContent = `
    .ops-trx-section td {
      border-top: 4px solid var(--ds-accent, #0292b7) !important;
      border-bottom: 2px solid var(--ds-accent, #0292b7) !important;
      background: color-mix(in srgb, var(--ds-accent, #0292b7) 12%, #ffffff) !important;
      color: var(--ds-accent, #0292b7) !important;
      font-weight: 900 !important;
    }
    .ops-trx-section-title {
      background: color-mix(in srgb, var(--ds-accent, #0292b7) 12%, #ffffff) !important;
      color: var(--ds-accent, #0292b7) !important;
    }
  `;
  document.head.appendChild(style);
}

function removeEmptyCellLegendText() {
  document.querySelectorAll('.ops-trx-legend span').forEach((span) => {
    const text = String(span.textContent || '').trim();
    if (text.includes('תא ריק')) span.remove();
  });
}

function runOperationsVisualTweaks() {
  addOperationsVisualTweaksStyle();
  removeEmptyCellLegendText();
}

function scheduleOperationsVisualTweaks() {
  setTimeout(runOperationsVisualTweaks, 80);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleOperationsVisualTweaks, { once: true });
  } else {
    scheduleOperationsVisualTweaks();
  }
  new MutationObserver(scheduleOperationsVisualTweaks).observe(document.documentElement, { childList: true, subtree: true });
}

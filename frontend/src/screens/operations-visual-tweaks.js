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
    #app table thead,
    #app table thead tr,
    #app table thead th {
      position: sticky;
      top: 0;
      z-index: 40;
    }
    #app table thead th {
      background: #eef8fb !important;
      color: #0f172a !important;
      font-weight: 800 !important;
      box-shadow: inset 0 -1px 0 #b7d7e4, 0 2px 5px rgba(15, 23, 42, 0.08);
      border-bottom: 1px solid #b7d7e4 !important;
      vertical-align: middle;
    }
    #app table thead th:first-child {
      border-top-right-radius: 8px;
    }
    #app table thead th:last-child {
      border-top-left-radius: 8px;
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

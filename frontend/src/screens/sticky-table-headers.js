// Global visual polish: keep table headers visible while scrolling.
// Applies to activity lists and operations-management tables without changing data logic.

const STYLE_ID = 'taasiyeda-sticky-table-headers-style';

function injectStickyTableHeaderStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
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

    #app .ds-table-wrap,
    #app .ds-table-scroll,
    #app .ops-training-matrix__wrap,
    #app .ops-training-list__wrap {
      scrollbar-gutter: stable;
    }
  `;
  document.head.appendChild(style);
}

injectStickyTableHeaderStyle();

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', injectStickyTableHeaderStyle, { once: true });
}

const STYLE_ID = 'annual-reviews-ui-compact-feedback-styles';

if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #app .ar2-screen textarea.ar2-textarea:not([data-ar2-metric-comment]),
    #app [data-ar2-landing] textarea.ar2-textarea:not([data-ar2-metric-comment]) {
      min-height: 64px;
      height: 64px;
      resize: vertical;
    }

    #app .ar2-btn,
    #app .ar2-rating {
      transform: translateY(0) scale(1);
      transition: transform 80ms ease, box-shadow 80ms ease, filter 80ms ease;
      will-change: transform;
    }

    #app .ar2-btn:not(:disabled):active,
    #app .ar2-rating:not(:disabled):active {
      transform: translateY(2px) scale(.98);
      box-shadow: inset 0 2px 5px rgba(15, 23, 42, .22);
      filter: brightness(.92);
    }

    @media print {
      body.ar2-printing #app .ar2-screen textarea.ar2-textarea:not([data-ar2-metric-comment]),
      body.ar2-printing #app [data-ar2-landing] textarea.ar2-textarea:not([data-ar2-metric-comment]) {
        min-height: 0;
        height: auto;
        field-sizing: content;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      #app .ar2-btn,
      #app .ar2-rating {
        transition: none;
      }
    }
  `;
  document.head.appendChild(style);
}

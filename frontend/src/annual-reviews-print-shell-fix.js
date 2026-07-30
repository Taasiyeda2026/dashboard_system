const STYLE_ID = 'annual-reviews-print-shell-fix-styles';
const SCROLL_ATTR = 'data-ar2-print-previous-scroll-top';

function installPrintShellStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @media print {
      body.ar2-printing {
        background: #fff !important;
        overflow: visible !important;
      }

      body.ar2-printing .app-shell,
      body.ar2-printing .shell-main,
      body.ar2-printing .shell-stage,
      body.ar2-printing .screen-root,
      body.ar2-printing #app {
        display: block !important;
        position: static !important;
        width: 100% !important;
        max-width: none !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        overflow: visible !important;
        transform: none !important;
        contain: none !important;
      }

      body.ar2-printing .app-shell,
      body.ar2-printing .shell-main,
      body.ar2-printing .shell-stage {
        flex: none !important;
      }

      body.ar2-printing .shell-stage {
        padding: 0 !important;
        overscroll-behavior: auto !important;
      }

      body.ar2-printing .screen-root {
        margin: 0 !important;
        zoom: 1 !important;
      }

      body.ar2-printing .shell-backdrop {
        display: none !important;
      }

      body.ar2-printing #app .ar2-card {
        break-inside: auto !important;
        page-break-inside: auto !important;
      }

      body.ar2-printing #app .ar2-question,
      body.ar2-printing #app .ar2-card__head {
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function resetAnnualReviewScrollForPrint() {
  if (!document.body.classList.contains('ar2-printing')) return;

  document.querySelectorAll('.shell-stage').forEach((stage) => {
    stage.setAttribute(SCROLL_ATTR, String(stage.scrollTop || 0));
    stage.scrollTop = 0;
  });
}

function restoreAnnualReviewScrollAfterPrint() {
  const restore = () => {
    document.querySelectorAll(`.shell-stage[${SCROLL_ATTR}]`).forEach((stage) => {
      const previousScrollTop = Number(stage.getAttribute(SCROLL_ATTR)) || 0;
      stage.removeAttribute(SCROLL_ATTR);
      stage.scrollTop = previousScrollTop;
    });
  };

  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
  else setTimeout(restore, 0);
}

installPrintShellStyles();
window.addEventListener('beforeprint', resetAnnualReviewScrollForPrint);
window.addEventListener('afterprint', restoreAnnualReviewScrollAfterPrint);

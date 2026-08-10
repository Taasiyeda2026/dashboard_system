const i="annual-reviews-print-shell-fix-styles",n="data-ar2-print-previous-scroll-top";function o(){if(document.getElementById(i))return;const t=document.createElement("style");t.id=i,t.textContent=`
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
  `,document.head.appendChild(t)}function a(){document.body.classList.contains("ar2-printing")&&document.querySelectorAll(".shell-stage").forEach(t=>{t.setAttribute(n,String(t.scrollTop||0)),t.scrollTop=0})}function p(){const t=()=>{document.querySelectorAll(`.shell-stage[${n}]`).forEach(r=>{const e=Number(r.getAttribute(n))||0;r.removeAttribute(n),r.scrollTop=e})};typeof requestAnimationFrame=="function"?requestAnimationFrame(t):setTimeout(t,0)}o();window.addEventListener("beforeprint",a);window.addEventListener("afterprint",p);

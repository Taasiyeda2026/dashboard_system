function s(t){return String((t==null?void 0:t.textContent)||"").replace(/\s+/g," ").trim()}function c(){if(document.getElementById("ops-completion-toolbar-compact-style"))return;const t=document.createElement("style");t.id="ops-completion-toolbar-compact-style",t.textContent=`
    #app .ds-ops-completion-control-card {
      padding: 8px 10px !important;
    }

    #app .ds-ops-completion-title-bar {
      display: grid !important;
      grid-template-columns: auto minmax(0, 1fr) !important;
      align-items: center !important;
      gap: 8px !important;
    }

    #app .ds-ops-completion-summary {
      min-width: max-content !important;
      margin: 0 !important;
    }

    #app .ops-completion-single-row {
      display: flex !important;
      align-items: center !important;
      justify-content: flex-start !important;
      flex-wrap: nowrap !important;
      gap: 4px !important;
      width: 100% !important;
      min-width: 0 !important;
      overflow-x: auto !important;
      padding: 2px 0 !important;
      margin: 0 !important;
      scrollbar-width: thin;
      box-sizing: border-box;
    }

    #app .ops-completion-single-row > *,
    #app .ops-completion-single-row label {
      flex: 0 0 auto !important;
      min-width: 0 !important;
      margin: 0 !important;
    }

    #app .ops-completion-single-row .ds-btn,
    #app .ops-completion-single-row button {
      min-width: 0 !important;
      width: auto !important;
      height: 27px !important;
      min-height: 27px !important;
      padding: 2px 7px !important;
      border-radius: 7px !important;
      font-size: 10.5px !important;
      line-height: 1 !important;
      font-weight: 750 !important;
      white-space: nowrap !important;
    }

    #app .ops-completion-single-row .ds-input,
    #app .ops-completion-single-row input,
    #app .ops-completion-single-row select {
      height: 27px !important;
      min-height: 27px !important;
      padding: 1px 6px !important;
      border-radius: 7px !important;
      font-size: 10.5px !important;
      line-height: 1 !important;
      white-space: nowrap !important;
    }

    #app .ops-completion-single-row [data-ops-completion-date-filter] {
      width: 118px !important;
      max-width: 118px !important;
    }

    #app .ops-completion-single-row [data-ops-completion-status-filter] {
      width: 104px !important;
      max-width: 104px !important;
    }

    #app .ops-completion-single-row [data-ops-completion-type-filter] {
      width: 92px !important;
      max-width: 92px !important;
    }

    #app .ops-completion-single-row [data-ops-completion-authority-filter] {
      width: 106px !important;
      max-width: 106px !important;
    }

    #app .ops-completion-single-row [data-ops-approval-print-instructor] {
      width: 116px !important;
      max-width: 116px !important;
    }

    #app .ds-ops-completion-toolbar-stack,
    #app .ds-ops-completion-toolbar-section,
    #app .ds-ops-completion-filter-toolbar,
    #app .ds-ops-completion-actions-toolbar,
    #app .ds-ops-completion-subtabs {
      display: contents !important;
    }

    #app .ds-ops-completion-toolbar-label {
      display: none !important;
    }

    @media (max-width: 900px) {
      #app .ds-ops-completion-title-bar {
        grid-template-columns: 1fr !important;
      }
    }
  `,document.head.appendChild(t)}function d(){const t=document.querySelector("#app .ds-ops-mgmt-screen"),p=t==null?void 0:t.querySelector(".ds-ops-completion-title-bar");if(!t||!p)return;t.querySelectorAll("button").forEach(o=>{s(o)==="אנשי קשר ואחראי קשר"&&(o.textContent="אחראי קשר")});let e=p.querySelector(":scope > .ops-completion-single-row");if(!e){e=document.createElement("div"),e.className="ops-completion-single-row",e.setAttribute("role","toolbar"),e.setAttribute("aria-label","סינון ופעולות אישורי ביצוע");const o=p.querySelector(":scope > .ds-ops-completion-summary");o?o.insertAdjacentElement("afterend",e):p.prepend(e)}const a=p.querySelector(".ds-ops-completion-subtabs"),r=p.querySelector(".ds-ops-completion-filter-toolbar"),l=p.querySelector(".ds-ops-completion-actions-toolbar");[a,r,l].forEach(o=>{o&&Array.from(o.children).forEach(m=>e.appendChild(m))}),p.querySelectorAll(".ds-ops-completion-toolbar-label").forEach(o=>o.remove())}function u(){c(),d()}let i=!1;function n(){i||(i=!0,setTimeout(()=>{i=!1,u()},60))}typeof document<"u"&&(document.readyState==="loading"?document.addEventListener("DOMContentLoaded",n,{once:!0}):n(),new MutationObserver(n).observe(document.documentElement,{childList:!0,subtree:!0}));

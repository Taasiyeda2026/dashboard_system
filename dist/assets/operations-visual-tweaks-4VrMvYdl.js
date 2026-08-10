import{_ as l}from"./index-CH0LFGSL.js";function m(){if(document.getElementById("ops-visual-tweaks-style"))return;const t=document.createElement("style");t.id="ops-visual-tweaks-style",t.textContent=`
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
    #app .ds-activities-screen .ds-table--activities-list thead,
    #app .ds-activities-screen .ds-table--activities-list thead tr,
    #app .ds-activities-screen .ds-table--activities-list thead th {
      position: sticky;
      top: 0;
      z-index: 40;
    }
    #app .ds-activities-screen .ds-table--activities-list thead th {
      background: #eef8fb !important;
      color: #0f172a !important;
      font-weight: 800 !important;
      box-shadow: inset 0 -1px 0 #b7d7e4, 0 2px 5px rgba(15, 23, 42, 0.08);
      border-bottom: 1px solid #b7d7e4 !important;
      vertical-align: middle;
    }
    #app .ds-activities-screen .ds-table-wrap:has(.ds-table--activities-list) {
      overflow: visible;
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

    #app.ds-activities-archive-mode .ds-table--activities-list {
      width: 100% !important;
      table-layout: fixed !important;
      border-collapse: separate;
      border-spacing: 0;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list th,
    #app.ds-activities-archive-mode .ds-table--activities-list td {
      height: 50px;
      padding: 8px 10px;
      vertical-align: middle;
      box-sizing: border-box;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list thead th {
      height: 44px;
      white-space: nowrap;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:not(.ds-activities-col--instructor) {
      text-align: center;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list thead th.ds-activities-col--instructor,
    #app.ds-activities-archive-mode .ds-table--activities-list td.ds-activities-col--instructor {
      text-align: right !important;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(1),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(1) {
      width: 24%;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(1),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(1),
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(2),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(2),
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(3),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(3),
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(4),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(4),
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(5),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(5) {
      text-align: right;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(2),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(2),
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(3),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(3) {
      width: 12%;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(4),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(4) {
      width: 16%;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(6),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(6),
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(7),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(7) {
      width: 10%;
      text-align: center;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-program-cell,
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-instructor-wrap {
      min-width: 0;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-program-name,
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-cell-ellipsis,
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-instructor-name,
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-manager-line {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-program-name {
      font-weight: 800;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-program-type,
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-manager-line {
      font-size: 11px;
      color: #64748b;
      line-height: 1.2;
      margin-top: 2px;
    }

    /* ניהול תפעול — שורת פעולות וחיפוש קומפקטית */
    #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar,
    #app .ds-ops-mgmt-screen .ops-compact-action-row {
      display: flex !important;
      align-items: center !important;
      justify-content: flex-start !important;
      gap: 6px !important;
      flex-wrap: nowrap !important;
      width: 100% !important;
      max-width: 100% !important;
      padding: 4px 0 !important;
      margin: 0 0 8px !important;
      overflow-x: auto !important;
      scrollbar-width: thin;
      box-sizing: border-box;
    }
    #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar .ds-btn,
    #app .ds-ops-mgmt-screen .ops-compact-action-row .ds-btn,
    #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar button,
    #app .ds-ops-mgmt-screen .ops-compact-action-row button {
      min-width: 0 !important;
      width: auto !important;
      min-height: 30px !important;
      height: 30px !important;
      padding: 3px 9px !important;
      border-radius: 8px !important;
      font-size: 12px !important;
      line-height: 1.1 !important;
      font-weight: 750 !important;
      white-space: nowrap !important;
      flex: 0 0 auto !important;
    }
    #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar .ds-input,
    #app .ds-ops-mgmt-screen .ops-compact-action-row .ds-input,
    #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar input,
    #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar select,
    #app .ds-ops-mgmt-screen .ops-compact-action-row input,
    #app .ds-ops-mgmt-screen .ops-compact-action-row select {
      min-width: 165px !important;
      width: min(230px, 24vw) !important;
      max-width: 230px !important;
      min-height: 30px !important;
      height: 30px !important;
      padding: 2px 8px !important;
      border-radius: 8px !important;
      font-size: 12px !important;
      flex: 1 1 190px !important;
    }
    @media (max-width: 1050px) {
      #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar,
      #app .ds-ops-mgmt-screen .ops-compact-action-row {
        flex-wrap: wrap !important;
        overflow-x: visible !important;
      }
      #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar .ds-input,
      #app .ds-ops-mgmt-screen .ops-compact-action-row .ds-input,
      #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar input,
      #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar select,
      #app .ds-ops-mgmt-screen .ops-compact-action-row input,
      #app .ds-ops-mgmt-screen .ops-compact-action-row select {
        width: 210px !important;
        max-width: 210px !important;
      }
    }
  `,document.head.appendChild(t)}function h(){document.querySelectorAll(".ops-trx-legend span").forEach(t=>{String(t.textContent||"").trim().includes("תא ריק")&&t.remove()})}function o(t){return String((t==null?void 0:t.textContent)||"").replace(/\s+/g," ").trim()}function v(t){var e;if(!t)return!1;const a=(e=t.getBoundingClientRect)==null?void 0:e.call(t);return a?a.width>0&&a.height>0:!0}function b(){const t=document.getElementById("app");if(!t||!t.querySelector(".ds-table--activities-list"))return!1;const a=t.querySelectorAll(`
    button.is-active,
    button.active,
    button[aria-pressed="true"],
    .is-active,
    .active,
    [aria-selected="true"],
    [data-active="true"]
  `);return Array.from(a).some(e=>v(e)&&o(e).includes("ארכיון"))}function u(){const t=document.getElementById("app");t&&t.classList.toggle("ds-activities-archive-mode",b())}function g(){const t=document.querySelector("#app .ds-ops-mgmt-screen");if(!t)return;Array.from(t.querySelectorAll("button")).forEach(i=>{o(i)==="אנשי קשר ואחראי קשר"&&(i.textContent="אחראי קשר")});const e=new Set(["הדפס סידור עבודה","כולל ישנים","מדריכים","אחראי קשר","אנשי קשר ואחראי קשר","הכשרות קיץ","סדנת קיץ"]),d=Array.from(t.querySelectorAll("button")).filter(i=>e.has(o(i)));if(!d.length)return;const c=d.find(i=>o(i)==="אחראי קשר")||d[0];let s=c.closest(".ds-ops-mgmt-panel__toolbar, .ds-toolbar, .ds-screen-top-row");if(!s){let i=c.parentElement,r=0;for(;i&&i!==t&&r<5;){if(Array.from(i.querySelectorAll("button")).filter(n=>e.has(o(n))).length>=2){s=i;break}i=i.parentElement,r+=1}}s==null||s.classList.add("ops-compact-action-row")}function f(){m(),h(),u(),g()}function p(){setTimeout(f,80)}typeof document<"u"&&(document.readyState==="loading"?document.addEventListener("DOMContentLoaded",p,{once:!0}):p(),new MutationObserver(p).observe(document.documentElement,{childList:!0,subtree:!0,attributes:!0,attributeFilter:["class","aria-pressed","aria-selected","data-active"]}));l(()=>import("./index-CH0LFGSL.js").then(t=>t.bl),[],import.meta.url).catch(t=>{console.warn("[contacts-full-directory] failed to load enhancement",t)});

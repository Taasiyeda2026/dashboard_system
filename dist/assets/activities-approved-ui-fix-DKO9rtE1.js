function s(){if(document.getElementById("activities-approved-ui-fix-styles"))return;const t=document.createElement("style");t.id="activities-approved-ui-fix-styles",t.textContent=`
    #app .ds-table--activities-list th.ds-activities-col--instructor,
    #app .ds-table--activities-list td.ds-activities-col--instructor {
      min-width: 190px !important;
      width: 190px !important;
      overflow: hidden !important;
    }
    #app .ds-table--activities-list .ds-activities-instructor-wrap,
    #app .ds-table--activities-list .ds-activities-instructor-name {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      line-height: 1.35 !important;
    }
    #app .ds-table--activities-list .ds-chip--instructor-empty {
      display: inline-flex !important;
      width: auto !important;
      min-width: 0 !important;
      color: #475569 !important;
      font-weight: 700 !important;
      white-space: nowrap !important;
    }
    #app .ds-table--activities-list .ds-contact-popover-btn {
      display: block !important;
      width: 100% !important;
      min-width: 0 !important;
      max-width: 100% !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      text-align: right !important;
      line-height: 1.25 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      cursor: pointer !important;
    }
    #app .ds-table--activities-list .ds-contact-popover-btn > span:first-child {
      display: block !important;
      min-width: 0 !important;
      color: #334155 !important;
      font-weight: 700 !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }
    #app .ds-table--activities-list .ds-activities-contact-phone {
      display: none !important;
    }
    .ds-modal.ds-modal--scheduling {
      width: min(430px, calc(100vw - 32px)) !important;
      max-width: 430px !important;
      min-height: 0 !important;
    }
    .ds-modal--scheduling .scheduling-workspace__activity {
      display: none !important;
    }
    .ds-modal--scheduling .scheduling-workspace,
    .ds-modal--scheduling .scheduling-workspace__requirements {
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
    }
    .ds-modal--scheduling .scheduling-workspace__fields {
      display: grid !important;
      grid-template-columns: 1fr !important;
      gap: 10px !important;
    }
    .ds-modal--scheduling .scheduling-workspace__fields label {
      display: grid !important;
      gap: 4px !important;
      margin: 0 !important;
    }
    .ds-modal--scheduling .scheduling-workspace__status:empty {
      display: none !important;
    }
  `,document.head.appendChild(t)}function p(t=document){var a;(a=t.querySelectorAll)==null||a.call(t,".ds-chip--instructor-empty").forEach(e=>{e.textContent!=="ללא מדריך"&&(e.textContent="ללא מדריך"),e.hasAttribute("title")&&e.removeAttribute("title")})}function d(){s(),p(document.getElementById("app")||document)}if(typeof document<"u"){d();const t=document.getElementById("app");t&&typeof MutationObserver=="function"&&new MutationObserver(a=>{a.some(n=>n.type!=="childList"?!1:Array.from(n.addedNodes).some(i=>{var r,o;return i.nodeType!==1?!1:((r=i.matches)==null?void 0:r.call(i,".ds-chip--instructor-empty"))||!!((o=i.querySelector)!=null&&o.call(i,".ds-chip--instructor-empty"))}))&&p(t)}).observe(t,{childList:!0,subtree:!0})}

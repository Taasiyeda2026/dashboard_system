import{o as c}from"./operations-management-D2HQdRbS.js";import{aF as E,bi as b}from"./index-CH0LFGSL.js";import"./operations-2027-loading-controller-Cz8B4VN-.js";import"./summer-contacts-modal-iq9EM1Vl.js";import"./completion-approval-status-BaQ-Md5L.js";import"./instructors-workspace-nav-CEfb1SVY.js";const F="authorities",D="schools",K="instructors",V="workshops";let v=!1,h=null;function O(t){var s;const e=(s=t==null?void 0:t.querySelector)==null?void 0:s.call(t,".ds-ops-mgmt-tab.is-active[data-ops-tab]");return(e==null?void 0:e.getAttribute("data-ops-tab"))||""}function z(t){const e=O(t);return e===F||e===D}function P(t){return O(t)===K}function W(t){var n,i;const e=O(t),s=String(((i=(n=t==null?void 0:t.querySelector)==null?void 0:n.call(t,".ds-ops-mgmt-tab.is-active"))==null?void 0:i.textContent)||"").trim();return e===V||["ציוד ומלאי","כמויות סדנאות","מלאי סדנאות"].includes(s)}function Y(t){var n,i,o;const e=(n=t==null?void 0:t.querySelector)==null?void 0:n.call(t,".ds-ops-mgmt-tab.is-active[data-ops-training-tab], .ds-ops-mgmt-tab.is-active[data-ops-custom-tab]"),s=String(((o=(i=t==null?void 0:t.querySelector)==null?void 0:i.call(t,".ds-ops-mgmt-tab.is-active"))==null?void 0:o.textContent)||"").trim();return!!e||["הכשרות קיץ","הכשרות סדנאות","הכשרות קורסים","ערכות דפוס"].includes(s)}function j(t){return W(t)||Y(t)}function X(){if(document.getElementById("ops-authorities-cleanup-style"))return;const t=document.createElement("style");t.id="ops-authorities-cleanup-style",t.textContent=`
    .ds-ops-mgmt-screen .ds-filter-field--search {
      display: none !important;
    }
    .ds-ops-mgmt-screen.ops-hide-filter-panel .ds-ops-mgmt-filters {
      display: none !important;
    }
    .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-mgmt-summary-line,
    .ds-ops-mgmt-screen.ops-schedule-clean .ds-ops-mgmt-summary-line {
      display: none !important;
    }

    @media screen {
      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-schools-authority,
      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authority-school,
      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authority-date {
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }

      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authority-date .ds-table-wrap,
      .ds-ops-mgmt-screen.ops-authorities-clean .ds-table-wrap:has(.ds-ops-authorities-table) {
        width: min(780px, 100%) !important;
        max-width: 780px !important;
        overflow-x: visible !important;
        margin-inline: auto !important;
        box-sizing: border-box !important;
      }

      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authorities-table {
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        table-layout: fixed !important;
        border-collapse: collapse !important;
      }

      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authorities-table col.ds-ops-col--time,
      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authorities-table th.ds-ops-col--time,
      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authorities-table td.ds-ops-col--time {
        width: 18% !important;
        text-align: center !important;
        white-space: nowrap !important;
      }

      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authorities-table col.ds-ops-col--instructor,
      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authorities-table th.ds-ops-col--instructor,
      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authorities-table td.ds-ops-col--instructor {
        width: 26% !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }

      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authorities-table col.ds-ops-col--grade,
      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authorities-table th.ds-ops-col--grade,
      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authorities-table td.ds-ops-col--grade {
        width: 12% !important;
        max-width: none !important;
        text-align: center !important;
        white-space: nowrap !important;
      }

      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authorities-table col.ds-ops-col--activity,
      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authorities-table th.ds-ops-col--activity,
      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authorities-table td.ds-ops-col--activity {
        width: 44% !important;
        max-width: none !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }

      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authorities-table th,
      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authorities-table td {
        height: 34px !important;
        padding: 6px 8px !important;
        vertical-align: middle !important;
        box-sizing: border-box !important;
      }

      .ds-ops-mgmt-screen.ops-authorities-clean .ds-ops-authority-date__title {
        width: min(780px, 100%) !important;
        max-width: 780px !important;
        margin-inline: auto !important;
        text-align: center !important;
        box-sizing: border-box !important;
      }
    }

    @media print {
      #app table thead,
      #app table thead tr,
      #app table thead th {
        position: static !important;
        top: auto !important;
        z-index: auto !important;
        box-shadow: none !important;
      }
    }
  `,document.head.appendChild(t)}function $(t){var s;const e=(s=t==null?void 0:t.querySelector)==null?void 0:s.call(t,"[data-ops-search]");!e||e.value===""||(e.value="",e.dispatchEvent(new Event("input",{bubbles:!0})))}function G(){const t=document.querySelector(".ds-ops-mgmt-screen");t&&(X(),$(t),t.classList.toggle("ops-authorities-clean",z(t)),t.classList.toggle("ops-schedule-clean",P(t)),t.classList.toggle("ops-hide-filter-panel",j(t)))}function g(){v||(v=!0,requestAnimationFrame(()=>{v=!1,G()}))}function A(){var e;const t=document.getElementById("app");!t||typeof MutationObserver!="function"||((e=h==null?void 0:h.disconnect)==null||e.call(h),h=new MutationObserver(s=>{s.some(i=>Array.from(i.addedNodes||[]).some(o=>{var r,p;return(o==null?void 0:o.nodeType)===1&&(((r=o.matches)==null?void 0:r.call(o,".ds-ops-mgmt-screen, .ds-ops-mgmt-tab, .ds-ops-mgmt-filters"))||((p=o.querySelector)==null?void 0:p.call(o,".ds-ops-mgmt-screen, .ds-ops-mgmt-tab, .ds-ops-mgmt-filters")))}))&&g()}),h.observe(t,{childList:!0,subtree:!0}))}typeof document<"u"&&(document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{g(),A()},{once:!0}):(g(),A()),document.addEventListener("click",t=>{var e,s;(s=(e=t.target)==null?void 0:e.closest)!=null&&s.call(e,".ds-ops-mgmt-screen [data-ops-tab], .ds-ops-mgmt-screen [data-ops-training-tab], .ds-ops-mgmt-screen [data-ops-custom-tab]")&&g()},!0));const k=new Set(["authorities","completion_approval"]),T="__operations2027RemainingFixApplied";function y(t={}){var s;const e=String(((s=t==null?void 0:t.operationsManagement)==null?void 0:s.period)||(t==null?void 0:t.activityPeriodTab)||"").trim();return e===E||e==="2027"}function N(t={}){var e;return String(((e=t==null?void 0:t.operationsManagement)==null?void 0:e.tab)||"").trim()}function Q(t={}){return String((t==null?void 0:t.activity_season)||(t==null?void 0:t.activity_period)||"").trim()===E}function U(t=[]){return(Array.isArray(t)?t:[]).map(e=>({...e,inventory_year:Number((e==null?void 0:e.inventory_year)??(e==null?void 0:e.inventoryYear)??2027),activity_season:String((e==null?void 0:e.activity_season)||(e==null?void 0:e.activitySeason)||E).trim(),stock_group_key:String((e==null?void 0:e.stock_group_key)||(e==null?void 0:e.stockGroupKey)||"").trim(),workshop_numbers:String((e==null?void 0:e.workshop_numbers)||(e==null?void 0:e.workshopNumbers)||"").trim(),workshop_name:String((e==null?void 0:e.workshop_name)||(e==null?void 0:e.workshopName)||"").trim(),holder_name:String((e==null?void 0:e.holder_name)||(e==null?void 0:e.holderName)||"").trim(),holder_type:String((e==null?void 0:e.holder_type)||(e==null?void 0:e.holderType)||"").trim(),opening_quantity:Number((e==null?void 0:e.opening_quantity)??(e==null?void 0:e.openingQuantity)??0)||0})).filter(e=>e.stock_group_key&&e.holder_name&&e.opening_quantity>0)}function I(t={},e={}){return!y(e)||N(e)!=="workshops"?t:{...t,workshopStockDistributions:[],workshopInventoryOpeningBalances:U(t==null?void 0:t.workshopInventoryOpeningBalances),workshopInventory2027Rows:(Array.isArray(t==null?void 0:t.workshopInventory2027Rows)?t.workshopInventory2027Rows:[]).filter(Q)}}function w(t){return String(t||"").replace('class="ds-screen-stack ds-ops-mgmt-screen"','class="ds-screen-stack ds-ops-mgmt-screen ops-year-2027" data-ops-year="2027"')}function S(t={}){var e;y(t)&&((e=t==null?void 0:t.operationsManagement)==null?void 0:e.context)!=="instructors"&&k.has(N(t))&&(t.operationsManagement=t.operationsManagement||{},t.operationsManagement.tab="workshops")}function J(t={}){const e=t.operationsManagement;if(!e||typeof e!="object")return()=>{};const s=Object.getOwnPropertyDescriptor(e,"tab");if(s&&typeof s.set=="function"&&s.get)return()=>{};let n=e.tab;return Object.defineProperty(e,"tab",{configurable:!0,enumerable:!0,get(){return n},set(i){n=i,y(t)&&e.context!=="instructors"&&k.has(String(n||"").trim())&&(n="workshops")}}),()=>{const i=e.tab;Object.defineProperty(e,"tab",{configurable:!0,enumerable:!0,writable:!0,value:i})}}function Z(){if(c[T])return;c[T]=!0;const t=c.load;c.load=async function(n={}){const i=n.state||{};S(i);const o=J(i);S(i);try{const r=await t.call(this,n);return I(r||{},i)}finally{o()}};const e=c.render;c.render=function(n,i={}){const o=i.state||{};if(S(o),!y(o))return e.call(this,n,i);const r=I(n||{},o),p=e.call(this,r,i);return w(p)}}function tt(){if(typeof document>"u"||document.getElementById("ops-2027-remaining-fix-style"))return;const t=document.createElement("style");t.id="ops-2027-remaining-fix-style",t.textContent=`
    .ds-ops-mgmt-screen[data-ops-year="2027"] .ds-filter-field:has([data-ops-period]),
    .ds-ops-mgmt-screen[data-ops-year="2027"] [data-ops-tab="authorities"],
    .ds-ops-mgmt-screen[data-ops-year="2027"] [data-ops-tab="completion_approval"] {
      display: none !important;
    }

    .ds-ops-mgmt-screen[data-ops-year="2027"] .ds-ops-workshop-col--location {
      width: 250px !important;
      min-width: 210px !important;
      max-width: 290px !important;
      white-space: normal !important;
      text-align: right !important;
      font-size: 10px !important;
      line-height: 1.25 !important;
    }

    .ds-ops-mgmt-screen[data-ops-year="2027"] .ds-ops-opening-location-list {
      display: flex;
      flex-wrap: wrap;
      gap: 3px 8px;
      align-items: center;
    }

    .ds-ops-mgmt-screen[data-ops-year="2027"] .ds-ops-opening-location-item {
      display: inline-flex;
      gap: 3px;
      white-space: nowrap;
      color: #334155;
    }

    .ds-ops-mgmt-screen[data-ops-year="2027"] .ds-ops-opening-location-item strong {
      color: #17365d;
      font-weight: 700;
    }

    .ds-ops-mgmt-screen[data-ops-year="2027"] .ds-ops-opening-location-empty {
      color: #64748b;
    }
  `,document.head.appendChild(t)}function et(){var s,n,i;if(typeof document>"u")return;const t=document.querySelector('.ds-ops-mgmt-screen[data-ops-year="2027"]');if(!t)return;const e=t.querySelector("[data-ops-period]");(i=(n=(s=e==null?void 0:e.closest)==null?void 0:s.call(e,".ds-filter-field"))==null?void 0:n.remove)==null||i.call(n),k.forEach(o=>{var r,p;return(p=(r=t.querySelector(`[data-ops-tab="${o}"]`))==null?void 0:r.remove)==null?void 0:p.call(r)})}let _=!1;function x(){_||typeof requestAnimationFrame!="function"||(_=!0,requestAnimationFrame(()=>{_=!1,et()}))}function st(){if(typeof document>"u")return;tt(),x();const t=document.getElementById("app");t&&typeof MutationObserver=="function"&&new MutationObserver(()=>x()).observe(t,{childList:!0,subtree:!0}),document.addEventListener("click",e=>{var s,n;(n=(s=e.target)==null?void 0:s.closest)!=null&&n.call(s,".ds-ops-mgmt-screen [data-ops-tab], .ds-ops-mgmt-screen [data-ops-custom-tab]")&&x()},!0)}Z();st();const L="__operations2027WorkshopLabelsInstalled",R=new Map([["מלאי פתיחה 2027","מלאי פתיחה"],["ניצול בפועל 2027","ניצול בפועל"],["צפי נדרש 2027","צפי נדרש"],["יתרה צפויה 2027","יתרה צפויה"]]);function nt(t){var e,s;return t?(e=t.matches)!=null&&e.call(t,'[data-ops-year="2027"], .ops-year-2027')?t:((s=t.querySelector)==null?void 0:s.call(t,'.ds-ops-mgmt-screen[data-ops-year="2027"], .ds-ops-mgmt-screen.ops-year-2027'))||null:null}function it(t){if(!t)return;for(const n of t.childNodes){if(n.nodeType!==3)continue;const i=String(n.textContent||"");for(const[o,r]of R.entries())if(i.includes(o)){n.textContent=i.replace(o,r);return}}const e=String(t.textContent||"").trim(),s=R.get(e);s&&(t.textContent=s)}function ot(t){const e=nt(t);e&&e.querySelectorAll(".ds-ops-workshops-table thead th").forEach(it)}function at(){if(c[L])return;c[L]=!0;const t=c.bind;c.bind=function(s={}){t.call(this,s),ot(s.root)}}at();const C="__operations2027EmptyDataFilterInstalled",q="ops-2027-empty-data-filter-20260807-v1",rt=new Set(["summer_training_matrix","course_training_matrix","course_print_kits"]),pt=new Set(["מחסן","הילה","עידן","גיל"]);String(b.HOTFIX_VERSION||"").includes(q)||(b.HOTFIX_VERSION=`${String(b.HOTFIX_VERSION||"").replace(/-$/,"")}-${q}`);function M(t){return t?!!t.querySelector([".ops2027-status.is-yes",".ops2027-status.is-no",".ops2027-cell-button.is-yes",".ops2027-cell-button.is-no",'[data-trained="1"]','[data-assigned="1"]',"[data-ops-kit-return]"].join(",")):!1}function B(t){var r,p,m,u;const e=Array.from(((p=(r=t==null?void 0:t.tBodies)==null?void 0:r[0])==null?void 0:p.rows)||[]),s=(u=(m=t==null?void 0:t.tHead)==null?void 0:m.rows)==null?void 0:u[0];if(!s||!e.length)return!1;const n=e.filter(a=>Array.from(a.cells).slice(1).some(M));e.filter(a=>!n.includes(a)).forEach(a=>a.remove());const i=Math.max(0,s.cells.length-1),o=[];for(let a=1;a<=i;a+=1)n.some(d=>M(d.cells[a]))||o.push(a);return o.reverse().forEach(a=>{var l;(l=s.cells[a])==null||l.remove(),n.forEach(d=>{var f;return(f=d.cells[a])==null?void 0:f.remove()})}),n.length>0&&s.cells.length>1}function H(t){if(!t)return 0;const e=t.querySelector('input[type="number"]'),s=e?e.value:t.textContent,n=Number(String(s||"").replace(/,/g,"").trim());return Number.isFinite(n)?n:0}function ct(t){var i,o,r,p,m,u;const e=Array.from(((o=(i=t==null?void 0:t.tBodies)==null?void 0:i[0])==null?void 0:o.rows)||[]),s=(p=(r=t==null?void 0:t.tHead)==null?void 0:r.rows)==null?void 0:p[0];return!s||!e.length?!1:(Array.from(s.cells).map((a,l)=>({index:l,label:String(a.textContent||"").trim()})).filter(({label:a})=>pt.has(a)).map(({index:a})=>a).filter(a=>e.every(l=>H(l.cells[a])===0)).sort((a,l)=>l-a).forEach(a=>{var l;(l=s.cells[a])==null||l.remove(),e.forEach(d=>{var f;return(f=d.cells[a])==null?void 0:f.remove()})}),e.forEach(a=>{Array.from(a.cells).slice(1).map(H).every(d=>d===0)&&a.remove()}),!!((u=(m=t.tBodies[0])==null?void 0:m.rows)!=null&&u.length))}function lt(t){var i,o,r;const e=(i=t==null?void 0:t.querySelector)==null?void 0:i.call(t,".ops2027-view[data-ops-controller-tab]"),s=String(((o=e==null?void 0:e.dataset)==null?void 0:o.opsControllerTab)||"");if(!e||!rt.has(s))return;if(s==="course_print_kits"){const p=e.querySelector(".ops2027-print-kit-stock table"),m=p==null?void 0:p.closest(".ops2027-section");p&&!ct(p)&&(m==null||m.remove()),e.querySelectorAll(".ops2027-print-kit-matrix table").forEach(u=>{var a;B(u)||(a=u.closest(".ops2027-section"))==null||a.remove()});return}const n=e.querySelector(".ops2027-table");n&&!B(n)&&((r=n.closest(".ops2027-table-shell"))==null||r.remove())}function mt(){if(c[C])return;c[C]=!0;const t=c.bind;c.bind=function(s={}){var p;t.call(this,s);const n=s.root;if(!n)return;const i=()=>lt(n);queueMicrotask(i);const o=(p=n.querySelector)==null?void 0:p.call(n,".ds-ops-mgmt-content");if(!o||o.dataset.ops2027EmptyFilterObserved==="1")return;o.dataset.ops2027EmptyFilterObserved="1",new MutationObserver(()=>queueMicrotask(i)).observe(o,{childList:!0,subtree:!0})}}mt();

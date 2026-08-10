(function(){if(globalThis.__dsProposalDetailsPublicCleanupInstalled)return;globalThis.__dsProposalDetailsPublicCleanupInstalled=!0;const b=new Set(["נשלח על ידי","תאריך שליחה"]),v=new Set(["סטטוס","תחום","תאריך הצעה"]),x=new Set(["","לא הוזן","לא נשמר","לא קיים","—"]),l=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,s=a=>String((a==null?void 0:a.textContent)||"").replace(/\s+/g," ").trim(),c=a=>s(a==null?void 0:a.querySelector(".ds-pa-info-label")),p=a=>s(a==null?void 0:a.querySelector(".ds-pa-info-value")),h=(a,i)=>Array.from(a.querySelectorAll(".ds-pa-info-card")).find(e=>s(e.querySelector(".ds-pa-card-title"))===i)||null;let u=null;function S(){if(document.getElementById("proposal-details-public-style"))return;const a=document.createElement("style");a.id="proposal-details-public-style",a.textContent=`
      #app [data-pa-proposal-detail] .ds-pa-proposal-info-grid.ds-pa-proposal-info-grid--public {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      }
      #app [data-pa-proposal-detail] .ds-pa-activities-wide {
        height: auto !important;
        min-height: 0 !important;
        margin-top: 12px !important;
        padding: 10px 12px 12px !important;
      }
      #app [data-pa-proposal-detail] .ds-pa-activities-wide > .ds-pa-card-title {
        margin: 0 0 6px !important;
        padding: 0 !important;
        line-height: 1.25;
      }
      #app [data-pa-proposal-detail] [data-pa-drawer-items] {
        height: auto !important;
        min-height: 0 !important;
      }
      #app [data-pa-proposal-detail] [data-pa-drawer-items] > :first-child {
        margin-top: 0 !important;
      }
      #app [data-pa-proposal-detail] [data-pa-drawer-items] :is(h3, h4, h5) {
        margin-top: 0 !important;
        margin-bottom: 6px !important;
        line-height: 1.25;
      }
      #app [data-pa-proposal-detail] .ds-pa-info-card--financial-summary {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 12px !important;
        height: auto !important;
        min-height: 0 !important;
        margin: 8px 0 0 !important;
        padding: 9px 12px !important;
        border: 0 !important;
        border-top: 1px solid var(--ds-border) !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
      }
      #app [data-pa-proposal-detail] .ds-pa-info-card--financial-summary .ds-pa-card-title {
        margin: 0 !important;
        padding: 0 !important;
        font-size: 0.9rem;
        line-height: 1.2;
      }
      #app [data-pa-proposal-detail] .ds-pa-info-card--financial-summary .ds-pa-total-amount {
        margin: 0 !important;
        padding: 0 !important;
        font-size: 1.05rem;
        line-height: 1.2;
        white-space: nowrap;
      }
      #app [data-pa-proposal-detail] .ds-pa-saved-pdf-indicator {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 17px;
        height: 17px;
        color: #0f766e;
        vertical-align: middle;
      }
      #app [data-pa-proposal-detail] .ds-pa-saved-pdf-indicator svg {
        display: block;
        width: 15px;
        height: 15px;
      }
      @media (max-width: 900px) {
        #app [data-pa-proposal-detail] .ds-pa-proposal-info-grid.ds-pa-proposal-info-grid--public {
          grid-template-columns: 1fr !important;
        }
      }
    `,document.head.appendChild(a)}function w(a,i){const e=document.createElement("div");e.className="ds-pa-info-cell",e.dataset.paMergedSending="true";const n=document.createElement("span");n.className="ds-pa-info-label",n.textContent=a;const t=document.createElement("span");return t.className="ds-pa-info-value",t.textContent=i,e.append(n,t),e}function E(a,i){if(a.querySelectorAll("[data-pa-saved-pdf-indicator]").forEach(d=>d.remove()),!i)return;const e=a.querySelector(".ds-pa-drawer-meta-item--status"),n=e==null?void 0:e.parentElement;if(!n)return;const t=document.createElement("span");t.className="ds-pa-saved-pdf-indicator",t.dataset.paSavedPdfIndicator="true",t.title="קיים PDF שמור",t.setAttribute("aria-label","קיים PDF שמור"),t.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',n.appendChild(t)}function P(){document.querySelector("#app [data-pa-proposal-detail], #app [data-pa-screen]")&&(S(),document.querySelectorAll("#app [data-pa-proposal-detail]").forEach(a=>{var d;const i=h(a,"פרטי ההצעה"),e=i==null?void 0:i.querySelector(".ds-pa-info-grid");i==null||i.querySelectorAll(".ds-pa-info-cell").forEach(o=>{(v.has(c(o))||l.test(p(o)))&&o.remove()});const n=h(a,"פרטי שליחה"),t=n==null?void 0:n.querySelector(".ds-pa-info-grid");if(n){const o=Array.from((t==null?void 0:t.querySelectorAll(".ds-pa-info-cell"))||[]).find(r=>c(r)==="סטטוס PDF");E(a,p(o)==="נשמר")}if(e&&n){e.querySelectorAll("[data-pa-merged-sending]").forEach(r=>r.remove());const o=[];t==null||t.querySelectorAll(".ds-pa-info-cell").forEach(r=>{const q=c(r),y=p(r);b.has(q)&&!x.has(y)&&!l.test(y)&&(r.dataset.paMergedSending="true",o.push(r))}),o.length?o.forEach(r=>e.appendChild(r)):e.appendChild(w("פרטי שליחה","ההצעה טרם נשלחה")),n.remove(),(d=i.parentElement)==null||d.classList.add("ds-pa-proposal-info-grid--public")}a.querySelectorAll(".ds-pa-info-cell").forEach(o=>{l.test(p(o))&&o.remove()})}))}let m=!1;const f=()=>{m||(m=!0,setTimeout(()=>{m=!1,P()},40))};function g(){u||typeof MutationObserver>"u"||(u=new MutationObserver(f),u.observe(document.documentElement,{childList:!0,subtree:!0}))}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{f(),g()},{once:!0}):(f(),g())})();

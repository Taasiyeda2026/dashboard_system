const u="data-ar2-print-plain-generated",l="ar2-print-plain-source",s="annual-reviews-print-plain-styles";function m(){if(document.getElementById(s))return;const e=document.createElement("style");e.id=s,e.textContent=`
    #app .ar2-print-plain-value { display: none; }

    @media print {
      body.ar2-printing #app .${l} { display: none !important; }
      body.ar2-printing #app .ar2-print-plain-value {
        display: block !important;
        margin-top: 4px;
        color: #111827;
        line-height: 1.45;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      body.ar2-printing #app .ar2-print-plain-rating { font-weight: 700; }
    }
  `,document.head.appendChild(e)}function d(){document.querySelectorAll(`[${u}]`).forEach(e=>e.remove()),document.querySelectorAll(`.${l}`).forEach(e=>e.classList.remove(l))}function o(e,t,r=""){if(!e||e.classList.contains(l))return;const n=document.createElement("div");n.className=`ar2-print-plain-value${r?` ${r}`:""}`,n.setAttribute(u,"true"),n.textContent=t,e.classList.add(l),e.insertAdjacentElement("afterend",n)}function c(e){var r,n,a,i;return e.matches("[data-ar2-metric-comment]")||(r=e.closest(".ar2-question"))!=null&&r.querySelector(".ar2-rating-wrap")?"הערות":((i=(a=(n=e.closest(".ar2-field"))==null?void 0:n.querySelector(":scope > span"))==null?void 0:a.textContent)==null?void 0:i.trim())||"תשובה"}function f(){d();const e=document.querySelector("#app .ar2-screen");e&&(e.querySelectorAll(".ar2-rating-wrap").forEach(t=>{var n;const r=t.querySelector(".ar2-rating.is-selected");o(t,`דירוג: ${((n=r==null?void 0:r.textContent)==null?void 0:n.trim())||"לא צוין"}`,"ar2-print-plain-rating")}),e.querySelectorAll("textarea.ar2-textarea").forEach(t=>{var a;const r=c(t),n=((a=t.value)==null?void 0:a.trim())||"—";o(t,`${r}: ${n}`)}),e.querySelectorAll("select.ar2-select").forEach(t=>{var a,i,p;const r=c(t),n=((p=(i=(a=t.selectedOptions)==null?void 0:a[0])==null?void 0:i.textContent)==null?void 0:p.trim())||"—";o(t,`${r}: ${n}`)}),e.querySelectorAll("input.ar2-input").forEach(t=>{var n;const r=c(t);o(t,`${r}: ${((n=t.value)==null?void 0:n.trim())||"—"}`)}))}m();window.addEventListener("beforeprint",f);window.addEventListener("afterprint",d);

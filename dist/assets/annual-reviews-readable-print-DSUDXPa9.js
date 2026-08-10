const w="[data-ar2-print]";function u(a,t=""){const e=document.createElement("div");return e.className=`ar2-readable-value${t?` ${t}`:""}`,e.textContent=String(a||"").trim(),e}function v(a){var t,e;return((e=(t=a==null?void 0:a.querySelector(".ar2-rating.is-selected"))==null?void 0:t.textContent)==null?void 0:e.trim())||""}function b(a){var t,e,r;return a.matches("[data-ar2-metric-comment]")?"הערה":a.closest(".ar2-question")?"":((r=(e=(t=a.closest(".ar2-field"))==null?void 0:t.querySelector(":scope > span"))==null?void 0:e.textContent)==null?void 0:r.replace(/\s+/g," ").trim())||""}function x(a,t){const e=[...a.querySelectorAll(".ar2-rating-wrap")],r=[...t.querySelectorAll(".ar2-rating-wrap")];e.forEach((n,i)=>{var c,s;const o=r[i];if(!o)return;const l=v(n);if(!l){o.remove();return}const p=((s=(c=n.querySelector(".ar2-rating-label"))==null?void 0:c.textContent)==null?void 0:s.replace(/:+$/,"").trim())||"דירוג",m=u(`${p}: ${l}`,"ar2-readable-rating");o.replaceWith(m)})}function q(a,t){const e=[...a.querySelectorAll("textarea.ar2-textarea")],r=[...t.querySelectorAll("textarea.ar2-textarea")];e.forEach((n,i)=>{var c;const o=r[i];if(!o)return;const l=((c=n.value)==null?void 0:c.trim())||"";if(!l){o.remove();return}const p=b(n),m=n.matches("[data-ar2-metric-comment]")?"ar2-readable-comment":"ar2-readable-answer";o.replaceWith(u(p?`${p}: ${l}`:l,m))})}function S(a,t){const e=[...a.querySelectorAll("select.ar2-select")],r=[...t.querySelectorAll("select.ar2-select")];e.forEach((n,i)=>{var m,c,s;const o=r[i];if(!o)return;const l=((s=(c=(m=n.selectedOptions)==null?void 0:m[0])==null?void 0:c.textContent)==null?void 0:s.trim())||"";if(!l||l==="בחירה"){o.remove();return}const p=b(n);o.replaceWith(u(p?`${p}: ${l}`:l))})}function k(a,t){const e=[...a.querySelectorAll('input.ar2-input:not([type="file"])')],r=[...t.querySelectorAll('input.ar2-input:not([type="file"])')];e.forEach((n,i)=>{var m;const o=r[i];if(!o)return;const l=((m=n.value)==null?void 0:m.trim())||"";if(!l){o.remove();return}const p=b(n);o.replaceWith(u(p?`${p}: ${l}`:l))})}function C(a,t){const e=[...a.querySelectorAll('input[type="checkbox"]')],r=[...t.querySelectorAll('input[type="checkbox"]')];e.forEach((n,i)=>{const o=r[i];if(!o)return;const l=document.createElement("span");l.className="ar2-readable-checkmark",l.textContent=n.checked?"☑":"☐",o.replaceWith(l)})}function g(a,t){var e,r;return((r=(e=a.querySelector(t))==null?void 0:e.textContent)==null?void 0:r.replace(/\s+/g," ").trim())||""}function d(a,t){var n,i;const e=[...a.querySelectorAll(".ar2-field")].find(o=>g(o,":scope > span")===t);return(((i=(n=e==null?void 0:e.querySelector(".ar2-readable-value"))==null?void 0:n.textContent)==null?void 0:i.trim())||"").replace(new RegExp(`^${t}\\s*:\\s*`),"")||"—"}function E(a){var i;const t=[...a.querySelectorAll(".ar-safe-goal")];if(!t.length)return;const e=document.createElement("table");e.className="ar2-readable-goals-table",e.innerHTML=`<thead><tr>
    <th class="ar2-goal-number">מס׳</th>
    <th>יעד</th>
    <th>פעולות</th>
    <th>מדד הצלחה</th>
    <th>אחריות</th>
    <th>תאריך יעד</th>
  </tr></thead>`;const r=document.createElement("tbody");t.forEach((o,l)=>{var s;const p=g(o,":scope > strong"),m=document.createElement("tr");[((s=p.match(/\d+/))==null?void 0:s[0])||String(l+1),d(o,"היעד"),d(o,"פעולות מוסכמות"),d(o,"מדד הצלחה"),d(o,"אחריות"),d(o,"תאריך יעד")].forEach((y,f)=>{const h=document.createElement(f===0?"th":"td");f===0&&(h.className="ar2-goal-number"),h.textContent=y,m.appendChild(h)}),r.appendChild(m)}),e.appendChild(r);const n=document.createElement("div");n.className="ar2-readable-goals-wrap",n.appendChild(e),(i=t[0].parentElement)==null||i.replaceWith(n)}function A(a){a.querySelectorAll(".ar2-question").forEach(t=>{const e=t.querySelector(".ar2-question__title"),r=t.querySelector(".ar2-readable-rating");if(!t.querySelector(".ar2-readable-answer")&&!r){t.remove();return}if(e){const i=document.createElement("div");i.className="ar2-readable-question-heading",i.appendChild(e),r&&i.appendChild(r),t.prepend(i)}}),a.querySelectorAll(".ar2-metric").forEach(t=>{const e=t.querySelector(":scope > strong"),r=t.querySelector(".ar2-readable-rating"),n=t.querySelector(".ar2-readable-comment");if(!r&&!n){t.remove();return}if(e){const i=document.createElement("div");i.className="ar2-readable-question-heading",i.appendChild(e),r&&i.appendChild(r),t.prepend(i)}}),a.querySelectorAll(".ar2-metrics").forEach(t=>{if(t.querySelector(".ar2-metric"))return;const e=t.parentElement;e&&e.querySelector(":scope > h3")?e.remove():t.remove()})}function z(a){a.querySelectorAll(".ar2-field").forEach(t=>{t.querySelector(".ar2-readable-value")||t.remove()})}function $(a){a.querySelectorAll(".ar2-status").forEach(t=>t.remove()),a.querySelectorAll(".ar2-card__head").forEach(t=>{t.closest("header.ar2-card")||t.querySelectorAll(".ar2-muted").forEach(e=>e.remove())})}function _(a){const t=a.cloneNode(!0);return x(a,t),q(a,t),S(a,t),k(a,t),C(a,t),t.querySelectorAll([".ar2-no-print",".ar2-topbar",".ar2-save",".ar-safe-save",".ar2-toast",".ar2-progress","[data-final-pdf-card]",'input[type="file"]',"button","script"].join(",")).forEach(e=>e.remove()),$(t),A(t),E(t),z(t),t}function T(){return`
    @page { size: A4 portrait; margin: 12mm; }
    *, *::before, *::after { box-sizing: border-box !important; }
    html, body {
      margin: 0 !important; padding: 0 !important; width: 100% !important;
      height: auto !important; overflow: visible !important;
      visibility: visible !important; opacity: 1 !important;
      background: #fff !important; color: #172033 !important; direction: rtl !important;
    }
    body {
      font-family: Arial, "Segoe UI", sans-serif !important;
      font-size: 10.7pt !important; line-height: 1.48 !important;
    }
    #app, .ar2-screen, .ar2-body {
      display: block !important; position: static !important; width: 100% !important;
      max-width: none !important; height: auto !important; max-height: none !important;
      margin: 0 !important; padding: 0 !important; overflow: visible !important;
      visibility: visible !important; opacity: 1 !important; transform: none !important;
      zoom: 1 !important; contain: none !important; background: #fff !important;
    }
    .ar2-topbar, .ar2-no-print, .ar2-private, .ar2-save, .ar-safe-save,
    .ar2-toast, .ar2-progress, .ar2-status, [data-final-pdf-card], button,
    input[type="file"] { display: none !important; }
    h1, h2, h3, p, strong, span, li, label, div, td, th {
      visibility: visible !important; opacity: 1 !important;
    }
    .ar2-card {
      display: block !important; width: 100% !important; height: auto !important;
      margin: 0 0 4.5mm !important; padding: 4mm !important;
      overflow: visible !important; background: #fff !important;
      border: 1px solid #cbd5e1 !important; border-radius: 2.5mm !important;
      box-shadow: none !important; break-inside: auto !important;
      page-break-inside: auto !important;
    }
    header.ar2-card {
      padding: 4.5mm !important; border-top: 3px solid #334155 !important;
    }
    .ar2-card__head {
      display: block !important; margin: 0 0 3mm !important;
      break-inside: avoid !important; page-break-inside: avoid !important;
    }
    h1 { margin: 0 0 1.5mm !important; font-size: 18pt !important; line-height: 1.2 !important; }
    h2 { margin: 0 !important; font-size: 14pt !important; line-height: 1.3 !important; color: #0f172a !important; }
    h3 { margin: 3mm 0 2mm !important; font-size: 11.5pt !important; line-height: 1.3 !important; }
    p { margin: 1.5mm 0 !important; }
    .ar2-muted { color: #526176 !important; font-size: 9.8pt !important; line-height: 1.4 !important; }
    .ar2-question-list, .ar2-summary-grid, .ar2-metrics,
    .ar-safe-shared, .ar-safe-shared-grid {
      display: block !important; margin: 0 !important; padding: 0 !important;
    }
    .ar2-question, .ar2-metric {
      display: block !important; margin: 0 !important; padding: 3mm 0 !important;
      border: 0 !important; border-bottom: 1px solid #dbe3ee !important;
      background: #fff !important; break-inside: auto !important;
      page-break-inside: auto !important; orphans: 3; widows: 3;
    }
    .ar2-question:last-child, .ar2-metric:last-child { border-bottom: 0 !important; }
    .ar2-readable-question-heading {
      display: flex !important; align-items: flex-start !important;
      justify-content: space-between !important; gap: 5mm !important;
      margin: 0 0 1mm !important; break-after: avoid !important;
      page-break-after: avoid !important;
    }
    .ar2-question__title, .ar2-readable-question-heading > strong {
      margin: 0 !important; color: #0f172a !important; font-size: 11pt !important;
      font-weight: 700 !important; line-height: 1.35 !important;
    }
    .ar2-question__prompt {
      display: block !important; margin: 0 0 1.7mm !important;
      color: #526176 !important; font-size: 9.7pt !important; line-height: 1.4 !important;
    }
    .ar2-readable-value {
      display: block !important; width: 100% !important; margin: 0 !important;
      padding: 0 !important; border: 0 !important; background: transparent !important;
      color: #172033 !important; font-size: 10.5pt !important; line-height: 1.48 !important;
      white-space: pre-wrap !important; overflow-wrap: anywhere !important;
    }
    .ar2-readable-answer, .ar2-readable-comment {
      padding: 2.4mm 3mm !important; background: #f8fafc !important;
      border-right: 2px solid #94a3b8 !important; border-radius: 1.5mm !important;
    }
    .ar2-readable-rating {
      display: inline-block !important; width: auto !important; flex: 0 0 auto !important;
      padding: .8mm 2.2mm !important; border: 1px solid #64748b !important;
      border-radius: 999px !important; color: #334155 !important;
      font-size: 9.3pt !important; font-weight: 700 !important; line-height: 1.2 !important;
      white-space: nowrap !important;
    }
    .ar2-field {
      display: grid !important; grid-template-columns: 36mm 1fr !important;
      gap: 4mm !important; align-items: start !important; padding: 2mm 0 !important;
      border-bottom: 1px solid #e2e8f0 !important; break-inside: avoid !important;
    }
    .ar2-field > span { color: #334155 !important; font-size: 10pt !important; font-weight: 700 !important; }
    .ar2-check { display: flex !important; align-items: flex-start !important; gap: 2mm !important; margin-top: 2mm !important; }
    .ar2-readable-checkmark { flex: 0 0 auto !important; font-size: 12pt !important; line-height: 1 !important; }
    .ar2-readable-goals-wrap { margin-top: 2mm !important; overflow: visible !important; }
    .ar2-readable-goals-table {
      width: 100% !important; border-collapse: collapse !important; table-layout: fixed !important;
      direction: rtl !important; font-size: 9pt !important; line-height: 1.35 !important;
    }
    .ar2-readable-goals-table th, .ar2-readable-goals-table td {
      padding: 2mm !important; border: 1px solid #b8c4d3 !important;
      vertical-align: top !important; text-align: right !important;
      white-space: pre-wrap !important; overflow-wrap: anywhere !important;
    }
    .ar2-readable-goals-table thead th { background: #eef2f7 !important; font-weight: 700 !important; }
    .ar2-readable-goals-table th:nth-child(1) { width: 6% !important; }
    .ar2-readable-goals-table th:nth-child(2) { width: 20% !important; }
    .ar2-readable-goals-table th:nth-child(3) { width: 27% !important; }
    .ar2-readable-goals-table th:nth-child(4) { width: 24% !important; }
    .ar2-readable-goals-table th:nth-child(5) { width: 10% !important; }
    .ar2-readable-goals-table th:nth-child(6) { width: 13% !important; }
    .ar2-goal-number { text-align: center !important; font-weight: 700 !important; }
    .ar2-signatures {
      display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
      gap: 4mm !important; font-size: 9.8pt !important; break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    [hidden] { display: none !important; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  `}function N(a){var r,n;const t=_(a);return`<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${(((n=(r=a.querySelector("h1"))==null?void 0:r.textContent)==null?void 0:n.trim())||"משוב שנתי").replace(/[<>&"]/g,"")}</title>
  <style>${T()}</style>
</head>
<body><main id="app">${t.outerHTML}</main></body>
</html>`}function L(){const a=window.open("",`annual-review-readable-${Date.now()}`,"popup=yes,width=1000,height=900");if(!a)throw new Error("print_popup_blocked");try{a.opener=null}catch{}return a}async function P(a,t){var r;const e=t.document;e.open(),e.write(N(a)),e.close(),(r=e.fonts)!=null&&r.ready&&await e.fonts.ready.catch(()=>{}),await new Promise(n=>setTimeout(n,150)),t.addEventListener("afterprint",()=>setTimeout(()=>{try{t.close()}catch{}},0),{once:!0}),t.focus(),t.print()}document.addEventListener("click",async a=>{const t=a.target instanceof Element?a.target:null,e=t==null?void 0:t.closest(w);if(!e||e.disabled)return;const r=e.closest(".ar2-screen")||document.querySelector("#app .ar2-screen");if(!r)return;a.preventDefault(),a.stopImmediatePropagation();let n;try{n=L()}catch(o){console.error("[annual-review readable print]",o),window.alert("הדפדפן חסם את חלון ההדפסה. יש לאפשר חלונות קופצים לאתר ולנסות שוב.");return}const i=e.textContent;e.disabled=!0,e.textContent="מכין את המשוב להדפסה…";try{await P(r,n)}catch(o){console.error("[annual-review readable print]",o);try{n.close()}catch{}window.alert("לא ניתן היה להכין את המשוב להדפסה. יש לרענן את העמוד ולנסות שוב.")}finally{e.disabled=!1,e.textContent=i}},!0);

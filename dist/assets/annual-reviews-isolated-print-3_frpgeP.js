const C="[data-ar2-print]";function y(a,t=""){const r=document.createElement("div");return r.className=`ar2-print-static-value${t?` ${t}`:""}`,r.textContent=a,r}function v(a){var t,r,e;return a.matches("[data-ar2-metric-comment]")?"הערה":a.closest(".ar2-question")?"תשובה":((e=(r=(t=a.closest(".ar2-field"))==null?void 0:t.querySelector(":scope > span"))==null?void 0:r.textContent)==null?void 0:e.trim())||"תשובה"}function x(a,t){const r=String(a||"").trim();return r?!t||t==="תשובה"?r:`${t}: ${r}`:"—"}function E(a,t){var r,e;return((e=(r=a.querySelector(t))==null?void 0:r.textContent)==null?void 0:e.replace(/\s+/g," ").trim())||""}function u(a,t){var i,p;const r=[...a.querySelectorAll(".ar2-field")].find(m=>E(m,":scope > span")===t);return(((p=(i=r==null?void 0:r.querySelector(".ar2-print-static-value"))==null?void 0:i.textContent)==null?void 0:p.trim())||"—").replace(new RegExp(`^${t}\\s*:\\s*`),"")||"—"}function A(a){const t=[...a.querySelectorAll(".ar-safe-goal")];if(!t.length)return;const r=document.createElement("table");r.className="ar2-print-goals-table",r.innerHTML=`<thead><tr>
    <th class="ar2-goal-number">מס׳</th>
    <th>יעד</th>
    <th>פעולות</th>
    <th>מדד הצלחה</th>
    <th>אחריות</th>
    <th>תאריך יעד</th>
  </tr></thead>`;const e=document.createElement("tbody");t.forEach((m,c)=>{var f;const w=((f=E(m,":scope > strong").match(/\d+/))==null?void 0:f[0])||String(c+1),g=document.createElement("tr");[w,u(m,"היעד"),u(m,"פעולות מוסכמות"),u(m,"מדד הצלחה"),u(m,"אחריות"),u(m,"תאריך יעד")].forEach((o,l)=>{const n=document.createElement(l===0?"th":"td");l===0&&(n.className="ar2-goal-number"),n.textContent=o,g.appendChild(n)}),e.appendChild(g)}),r.appendChild(e);const i=t[0].parentElement,p=document.createElement("div");p.className="ar2-print-goals-wrap",p.appendChild(r),i==null||i.replaceWith(p)}function _(a){a.querySelectorAll(".ar2-question").forEach(t=>{var m;const r=t.querySelector(".ar2-question__title"),e=t.querySelector(".ar2-print-static-rating"),i=t.querySelector(".ar2-print-answer"),p=!!(i&&i.textContent.trim()&&i.textContent.trim()!=="—");if((m=t.querySelector(".ar2-question__prompt"))==null||m.remove(),!p&&!e){t.remove();return}if(r){const c=document.createElement("div");c.className="ar2-print-question-heading",c.appendChild(r),e&&c.appendChild(e),t.prepend(c)}}),a.querySelectorAll(".ar2-metric").forEach(t=>{const r=t.querySelector(":scope > strong"),e=t.querySelector(".ar2-print-static-rating");if(!r)return;const i=document.createElement("div");i.className="ar2-print-question-heading",i.appendChild(r),e&&i.appendChild(e),t.prepend(i)})}function z(a){a.querySelectorAll(".ar2-status").forEach(t=>t.remove()),a.querySelectorAll(".ar2-card__head").forEach(t=>{t.closest("header.ar2-card")||t.querySelectorAll(".ar2-muted").forEach(r=>r.remove())}),a.querySelectorAll(".ar2-card__head > div").forEach(t=>{t.style.removeProperty("display")})}function T(a,t){const r=[...a.querySelectorAll(".ar2-rating-wrap")],e=[...t.querySelectorAll(".ar2-rating-wrap")];r.forEach((o,l)=>{var h,q,S;const n=e[l];if(!n)return;const s=o.querySelector(".ar2-rating.is-selected"),d=(q=(h=o.querySelector(".ar2-rating-label"))==null?void 0:h.textContent)==null?void 0:q.trim(),b=d?`${d}: `:"דירוג: ";n.replaceWith(y(`${b}${((S=s==null?void 0:s.textContent)==null?void 0:S.trim())||"לא צוין"}`,"ar2-print-static-rating"))});const i=[...a.querySelectorAll("textarea.ar2-textarea")],p=[...t.querySelectorAll("textarea.ar2-textarea")];i.forEach((o,l)=>{const n=p[l];if(!n)return;const s=v(o),d=s==="תשובה"?"ar2-print-answer":"";n.replaceWith(y(x(o.value,s),d))});const m=[...a.querySelectorAll("select.ar2-select")],c=[...t.querySelectorAll("select.ar2-select")];m.forEach((o,l)=>{var d,b,h;const n=c[l];if(!n)return;const s=((h=(b=(d=o.selectedOptions)==null?void 0:d[0])==null?void 0:b.textContent)==null?void 0:h.trim())||"—";n.replaceWith(y(x(s,v(o))))});const k=[...a.querySelectorAll('input.ar2-input:not([type="file"])')],w=[...t.querySelectorAll('input.ar2-input:not([type="file"])')];k.forEach((o,l)=>{const n=w[l];n&&n.replaceWith(y(x(o.value,v(o))))});const g=[...a.querySelectorAll('input[type="checkbox"]')],f=[...t.querySelectorAll('input[type="checkbox"]')];g.forEach((o,l)=>{const n=f[l];if(!n)return;const s=document.createElement("span");s.className="ar2-print-checkmark",s.textContent=o.checked?"☑":"☐",n.replaceWith(s)}),t.querySelectorAll([".ar2-no-print",".ar2-topbar",".ar2-save",".ar-safe-save",".ar2-toast",".ar2-progress","[data-final-pdf-card]",'input[type="file"]',"button","script"].join(",")).forEach(o=>o.remove()),z(t),_(t),A(t)}function P(){return`
    @page { size: A4 portrait; margin: 10mm; }
    *, *::before, *::after { box-sizing: border-box !important; }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      overflow: visible !important;
      visibility: visible !important;
      opacity: 1 !important;
      background: #fff !important;
      color: #111827 !important;
      direction: rtl !important;
    }
    body {
      font-family: Arial, "Segoe UI", sans-serif !important;
      font-size: 10.2pt !important;
      line-height: 1.42 !important;
    }
    #app, .ar2-screen, .ar2-body {
      display: block !important;
      position: static !important;
      width: 100% !important;
      max-width: none !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: visible !important;
      visibility: visible !important;
      opacity: 1 !important;
      transform: none !important;
      zoom: 1 !important;
      contain: none !important;
      color: #111827 !important;
      background: #fff !important;
    }
    .ar2-topbar,
    .ar2-no-print,
    .ar2-private,
    .ar2-save,
    .ar-safe-save,
    .ar2-toast,
    .ar2-progress,
    .ar2-status,
    [data-final-pdf-card],
    button,
    input[type="file"] { display: none !important; }

    .ar2-card {
      display: block !important;
      width: 100% !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      margin: 0 0 4mm !important;
      padding: 0 0 4mm !important;
      overflow: visible !important;
      visibility: visible !important;
      opacity: 1 !important;
      color: #111827 !important;
      background: #fff !important;
      border: 0 !important;
      border-bottom: 1px solid #cbd5e1 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
    }
    header.ar2-card {
      margin-bottom: 5mm !important;
      padding-bottom: 4mm !important;
      border-bottom: 2px solid #334155 !important;
    }
    .ar2-card__head {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 5mm !important;
      margin: 0 0 2.5mm !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    .ar2-card__head > div { width: 100% !important; }
    h1, h2, h3, p, strong, span, li, label, div, td, th {
      visibility: visible !important;
      opacity: 1 !important;
    }
    h1 { margin: 0 0 1.5mm !important; font-size: 18pt !important; line-height: 1.2 !important; }
    h2 {
      margin: 0 !important;
      padding: 0 0 1.5mm !important;
      font-size: 13.5pt !important;
      line-height: 1.25 !important;
      color: #0f172a !important;
    }
    h3 { margin: 2mm 0 1.5mm !important; font-size: 11.5pt !important; line-height: 1.25 !important; }
    p { margin: 1mm 0 !important; }
    .ar2-muted { color: #475569 !important; font-size: 9.5pt !important; line-height: 1.35 !important; }

    .ar2-question-list,
    .ar2-summary-grid,
    .ar2-metrics,
    .ar-safe-shared,
    .ar-safe-shared-grid {
      display: block !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    .ar2-question,
    .ar2-metric {
      display: block !important;
      margin: 0 !important;
      padding: 2.2mm 0 !important;
      border: 0 !important;
      border-bottom: 1px solid #e2e8f0 !important;
      border-radius: 0 !important;
      background: #fff !important;
      color: #111827 !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
      orphans: 3;
      widows: 3;
    }
    .ar2-question:last-child,
    .ar2-metric:last-child { border-bottom: 0 !important; }
    .ar2-print-question-heading {
      display: flex !important;
      align-items: baseline !important;
      justify-content: space-between !important;
      gap: 5mm !important;
      margin: 0 0 1mm !important;
      break-after: avoid !important;
      page-break-after: avoid !important;
    }
    .ar2-question__title,
    .ar2-print-question-heading > strong {
      margin: 0 !important;
      color: #0f172a !important;
      font-size: 10.5pt !important;
      font-weight: 700 !important;
      line-height: 1.3 !important;
    }
    .ar2-question__prompt { display: none !important; }
    .ar2-print-static-value {
      display: block !important;
      width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      color: #111827 !important;
      font-size: 10.2pt !important;
      line-height: 1.42 !important;
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    .ar2-print-static-rating {
      display: inline-block !important;
      width: auto !important;
      flex: 0 0 auto !important;
      padding: .7mm 2mm !important;
      border: 1px solid #94a3b8 !important;
      border-radius: 999px !important;
      color: #334155 !important;
      font-size: 9pt !important;
      font-weight: 700 !important;
      line-height: 1.2 !important;
      white-space: nowrap !important;
    }
    .ar2-field {
      display: grid !important;
      grid-template-columns: minmax(34mm, auto) 1fr !important;
      align-items: start !important;
      gap: 3mm !important;
      margin: 0 !important;
      padding: 1.5mm 0 !important;
      border-bottom: 1px solid #e2e8f0 !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    .ar2-field > span {
      color: #334155 !important;
      font-size: 9.5pt !important;
      font-weight: 700 !important;
    }
    .ar2-field .ar2-print-static-value { font-size: 9.8pt !important; }
    .ar2-check {
      display: flex !important;
      align-items: flex-start !important;
      gap: 2mm !important;
      margin-top: 2mm !important;
      font-size: 9.5pt !important;
      line-height: 1.35 !important;
    }
    .ar2-print-checkmark {
      display: inline-block !important;
      flex: 0 0 auto !important;
      font-size: 12pt !important;
      line-height: 1 !important;
    }

    .ar2-print-goals-wrap {
      margin-top: 2mm !important;
      overflow: visible !important;
    }
    .ar2-print-goals-table {
      width: 100% !important;
      border-collapse: collapse !important;
      table-layout: fixed !important;
      direction: rtl !important;
      font-size: 8.7pt !important;
      line-height: 1.3 !important;
    }
    .ar2-print-goals-table th,
    .ar2-print-goals-table td {
      padding: 1.7mm !important;
      border: 1px solid #cbd5e1 !important;
      vertical-align: top !important;
      text-align: right !important;
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
    }
    .ar2-print-goals-table thead th {
      background: #f1f5f9 !important;
      color: #0f172a !important;
      font-weight: 700 !important;
    }
    .ar2-print-goals-table th:nth-child(1) { width: 6% !important; }
    .ar2-print-goals-table th:nth-child(2) { width: 20% !important; }
    .ar2-print-goals-table th:nth-child(3) { width: 28% !important; }
    .ar2-print-goals-table th:nth-child(4) { width: 24% !important; }
    .ar2-print-goals-table th:nth-child(5) { width: 10% !important; }
    .ar2-print-goals-table th:nth-child(6) { width: 12% !important; }
    .ar2-goal-number { text-align: center !important; font-weight: 700 !important; }

    .ar2-guide { margin: 1mm 0 0 !important; padding-inline-start: 6mm !important; }
    .ar2-guide li { margin-bottom: 1mm !important; }
    .ar2-signatures {
      display: grid !important;
      grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
      gap: 4mm !important;
      margin-top: 3mm !important;
      padding-top: 3mm !important;
      border-top: 1px solid #94a3b8 !important;
      border-bottom: 0 !important;
      font-size: 9.5pt !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    [hidden] { display: none !important; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  `}function $(a){var e,i;const t=a.cloneNode(!0);return T(a,t),`<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${(((i=(e=a.querySelector("h1"))==null?void 0:e.textContent)==null?void 0:i.trim())||"משוב שנתי").replace(/[<>&"]/g,"")}</title>
  <style>${P()}</style>
</head>
<body>
  <main id="app">${t.outerHTML}</main>
</body>
</html>`}function N(){const a=`annual-review-print-${Date.now()}`,t=window.open("",a,"popup=yes,width=1000,height=900");if(!t)throw new Error("print_popup_blocked");try{t.opener=null}catch{}return t.document.open(),t.document.write('<!doctype html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><title>מכין משוב להדפסה</title></head><body style="font-family:Arial,sans-serif;direction:rtl;padding:24px">מכין את המשוב להדפסה…</body></html>'),t.document.close(),t}async function L(a){var r;const t=a.document;(r=t.fonts)!=null&&r.ready&&await t.fonts.ready.catch(()=>{}),await Promise.all([...t.images].map(e=>e.complete?Promise.resolve():new Promise(i=>{e.addEventListener("load",i,{once:!0}),e.addEventListener("error",i,{once:!0}),setTimeout(i,1500)}))),await new Promise(e=>setTimeout(e,120))}async function j(a,t){const r=t.document;r.open(),r.write($(a)),r.close(),await L(t),t.addEventListener("afterprint",()=>{setTimeout(()=>{try{t.close()}catch{}},0)},{once:!0}),t.focus(),t.print()}async function D(a,t){const r=t.closest(".ar2-screen")||document.querySelector("#app .ar2-screen");if(!r||t.disabled)return;a.preventDefault(),a.stopImmediatePropagation();let e;try{e=N()}catch(p){console.error("[annual-review standalone print]",p),window.alert("הדפדפן חסם את חלון ההדפסה. יש לאפשר חלונות קופצים לאתר ולנסות שוב.");return}const i=t.textContent;t.disabled=!0,t.textContent="מכין את המשוב להדפסה…";try{await j(r,e)}catch(p){console.error("[annual-review standalone print]",p);try{e.close()}catch{}window.alert("לא ניתן היה להכין את המשוב להדפסה. יש לרענן את העמוד ולנסות שוב.")}finally{t.disabled=!1,t.textContent=i}}document.addEventListener("click",a=>{const t=a.target instanceof Element?a.target:null,r=t==null?void 0:t.closest(C);r&&D(a,r)},!0);

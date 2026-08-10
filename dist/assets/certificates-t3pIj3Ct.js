const w="./assets/certificates/templates/",m="./assets/certificates/previews/",p="./assets/certificates/logos/",g=[{id:"sky",file:"sky.pdf",name:"השמיים אינם הגבול"},{id:"biomimicry1",file:"biomimicry1.pdf",name:"ביומימיקרי 1"},{id:"biomimicry2",file:"biomimicry2.pdf",name:"ביומימיקרי 2"},{id:"techspace",file:"techspace.pdf",name:"טכנולוגיות החלל"},{id:"ai",file:"ai.pdf",name:"בינה מלאכותית"},{id:"rokhim",file:"rokhim.pdf",name:"רוקחים עולם"}],l=[{id:"ministry",file:"ministry-of-education.png",label:"משרד החינוך"},{id:"taasiyeda1",file:"taasiyeda1.png",label:"תעשיידע 1"},{id:"taasiyeda2",file:"taasiyeda2.png",label:"תעשיידע 2"}],s={};function c(e){return s[e]||(s[e]={selected:new Set(l.map(o=>o.id)),customLogo:null}),s[e]}function _(e){return`
<div class="cert-card" data-cert-id="${e.id}">
  <div class="cert-card__preview-wrap">
    <img class="cert-card__preview-img" src="${m}${e.id}.png" alt="${e.name}" loading="lazy" />
  </div>
  <div class="cert-card__body">
    <p class="cert-card__name">${e.name}</p>
    <p class="cert-card__file">${e.file}</p>
    <div class="cert-card__actions">
      <button type="button" class="cert-btn cert-btn--primary" data-cert-open="${e.id}">פתח תעודה</button>
      <button type="button" class="cert-btn cert-btn--print" data-cert-print="${e.id}">הפקת PDF</button>
    </div>
  </div>
</div>`}function b(e){const o=c(e),i=l.map(r=>{const n=o.selected.has(r.id);return`
<button type="button"
  class="cert-logo-pick${n?" cert-logo-pick--on":""}"
  data-logo-toggle="${r.id}"
  title="${n?"לחץ להסרה":"לחץ לבחירה"}">
  <img src="${p}${r.file}" alt="${r.label}" class="cert-logo-pick__img" />
  <span class="cert-logo-pick__label">${r.label}</span>
  <span class="cert-logo-pick__check">${n?"✓":""}</span>
</button>`}).join(""),t=o.customLogo,a=`
<label class="cert-logo-pick cert-logo-pick--upload" title="העלאת לוגו נוסף מהמחשב">
  ${t?`<img src="${t.dataUrl}" alt="לוגו נוסף" class="cert-logo-pick__img" /><span class="cert-logo-pick__label" style="font-size:.65rem">${t.name}</span><span class="cert-logo-pick__check">✓</span>`:'<span class="cert-logo-pick__plus">+</span><span class="cert-logo-pick__label">הוסף לוגו</span>'}
  <input type="file" data-cert-upload-modal="${e}" accept="image/*" hidden />
</label>
${t?`<button type="button" class="cert-logo-pick__remove-custom" data-cert-clear-custom="${e}" title="הסר לוגו נוסף">✕</button>`:""}`;return`
<div class="cert-logo-selector" id="certLogoSelector">
  <p class="cert-logo-selector__title">בחירת לוגואים לתעודה</p>
  <div class="cert-logo-selector__grid">
    ${i}
    ${a}
  </div>
</div>`}function u(e){const o=c(e),i=[...l.filter(t=>o.selected.has(t.id)).map(t=>`<img src="${p}${t.file}" alt="${t.label}" class="cert-strip-logo" />`),...o.customLogo?[`<img src="${o.customLogo.dataUrl}" alt="לוגו נוסף" class="cert-strip-logo" />`]:[]].join("");return i?`<div class="cert-preview-logo-strip" id="certLogoStrip">${i}</div>`:'<div class="cert-preview-logo-strip cert-preview-logo-strip--empty" id="certLogoStrip"></div>'}function d(e){const o=document.getElementById("certLogoSelector");o&&(o.outerHTML=b(e));const i=document.getElementById("certLogoStrip");i&&(i.outerHTML=u(e)),h(e)}function h(e){const o=document.getElementById("certLogoSelector");o&&(o.addEventListener("click",i=>{const t=i.target.closest("[data-logo-toggle]");if(t){const r=t.dataset.logoToggle,n=c(e);n.selected.has(r)?n.selected.delete(r):n.selected.add(r),d(e);return}i.target.closest("[data-cert-clear-custom]")&&(c(e).customLogo=null,d(e))}),o.addEventListener("change",i=>{var a;const t=i.target.closest("[data-cert-upload-modal]");if(t&&((a=t.files)!=null&&a[0])){const r=t.files[0],n=new FileReader;n.onload=x=>{c(e).customLogo={dataUrl:x.target.result,name:r.name},d(e)},n.readAsDataURL(r),t.value=""}}))}function y(e){const o=c(e);return[...l.filter(t=>o.selected.has(t.id)).map(t=>({src:new URL(`${p}${t.file}`,window.location.href).href,alt:t.label})),...o.customLogo?[{src:o.customLogo.dataUrl,alt:"לוגו נוסף"}]:[]].map(t=>`<img class="pl" src="${t.src}" alt="${t.alt}" />`).join("")}function v(e){const o=g.find(n=>n.id===e);if(!o)return;const i=new URL(`${m}${e}.png`,window.location.href).href,t=y(e),a=t.length>0,r=window.open("","_blank","width=900,height=1200");r&&(r.document.write(`<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8"/>
<title>${o.name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#e5e7eb;font-family:Arial,sans-serif;direction:rtl}
@page{size:A4 portrait;margin:0}
@media print{
  html,body{background:white}
  .no-print{display:none!important}
}
.no-print{text-align:center;padding:12px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
.no-print button{background:#1a8c6e;color:#fff;border:none;padding:8px 20px;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;margin:0 6px}
.no-print button:hover{background:#157a5e}
/* A4 page — exact dimensions, no scroll */
.cert-print-page{
  position:relative;
  width:210mm;
  height:297mm;
  margin:0 auto;
  background:white;
  box-shadow:0 4px 20px rgba(0,0,0,.2);
  overflow:hidden;
  page-break-inside:avoid;
}
/* Preview image fills full A4 */
.cert-print-img{
  position:absolute;
  top:0;left:0;
  width:100%;
  height:100%;
  object-fit:fill;
  display:block;
}
/* Logo overlay — transparent, centered, top ~5% inside the certificate */
.cert-print-logo-bar{
  position:absolute;
  top:5%;
  left:50%;
  transform:translateX(-50%);
  z-index:10;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8mm;
  background:transparent;
  padding:0;
  white-space:nowrap;
}
.pl{max-height:11mm;height:auto;max-width:28mm;width:auto;object-fit:contain;display:block;flex-shrink:0}
</style>
</head>
<body>
<div class="no-print">
  <button onclick="window.print()">הדפסה / שמירה כ-PDF</button>
  <button onclick="window.close()">סגירה</button>
</div>
<div class="cert-print-page">
  <img class="cert-print-img" src="${i}" alt="${o.name}" />
  ${a?`<div class="cert-print-logo-bar">${t}</div>`:""}
</div>
<script>
var img=document.querySelector('.cert-print-img');
function doP(){setTimeout(function(){window.print();},300)}
if(img.complete){doP()}else{img.onload=doP;img.onerror=doP}
window.onafterprint=function(){setTimeout(function(){window.close();},250)};
<\/script>
</body>
</html>`),r.document.close())}function k(e){const o=g.find(r=>r.id===e);if(!o)return;const i=`${w}${o.file}`,t=document.getElementById("certPreviewModal");t&&t.remove();const a=document.createElement("div");a.id="certPreviewModal",a.className="cert-preview-modal",a.innerHTML=`
<div class="cert-preview-modal__backdrop" data-close-preview></div>
<div class="cert-preview-modal__inner" role="dialog" aria-modal="true" aria-label="${o.name}">
  <div class="cert-preview-modal__header">
    <h2>${o.name}</h2>
    <button type="button" class="cert-preview-modal__close" data-close-preview aria-label="סגירה">✕</button>
  </div>
  ${b(e)}
  <div class="cert-preview-modal__body">
    <div class="cert-preview-viewer">
      <div class="cert-preview-iframe-wrap">
        <iframe src="${i}#toolbar=0&navpanes=0&scrollbar=0" title="${o.name}"></iframe>
        ${u(e)}
      </div>
    </div>
  </div>
  <div class="cert-preview-modal__footer">
    <button type="button" class="cert-btn cert-btn--print" data-modal-print="${e}">הפקת PDF</button>
    <button type="button" class="cert-btn cert-btn--secondary" data-close-preview>סגירה</button>
  </div>
</div>`,document.body.appendChild(a),a.querySelectorAll("[data-close-preview]").forEach(r=>r.addEventListener("click",()=>a.remove())),a.addEventListener("keydown",r=>{r.key==="Escape"&&a.remove()}),a.addEventListener("click",r=>{const n=r.target.closest("[data-modal-print]");n&&v(n.dataset.modalPrint)}),h(e)}function f(){if(document.getElementById("cert-screen-styles"))return;const e=document.createElement("style");e.id="cert-screen-styles",e.textContent=`
/* ─ Screen & grid ─ */
.cert-screen{padding:var(--ds-space-4,16px);direction:rtl}
.cert-screen__header{margin-bottom:4px}
.cert-screen__title{font-size:1.25rem;font-weight:700;color:var(--ds-text-primary,#111);margin:0}
.cert-cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,210px));gap:14px;margin-top:16px}
/* ─ Card ─ */
.cert-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 1px 4px rgba(0,0,0,.07);transition:box-shadow .15s}
.cert-card:hover{box-shadow:0 4px 14px rgba(0,0,0,.13)}
.cert-card__preview-wrap{width:100%;aspect-ratio:210/297;background:#f1f5f9;overflow:hidden;flex-shrink:0}
.cert-card__preview-img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
.cert-card__body{padding:8px 10px;display:flex;flex-direction:column;gap:5px;flex:1}
.cert-card__name{font-size:.82rem;font-weight:700;color:#1e293b;margin:0;line-height:1.3}
.cert-card__file{font-size:.7rem;color:#94a3b8;font-family:monospace;margin:0}
.cert-card__actions{display:flex;gap:6px;flex-wrap:nowrap;margin-top:6px}
/* ─ Buttons ─ */
.cert-btn{font-family:inherit;font-size:.76rem;font-weight:600;padding:5px 10px;border-radius:6px;cursor:pointer;border:none;transition:background .15s;white-space:nowrap;line-height:1.4}
.cert-btn--primary{background:var(--ds-accent,#1a3358);color:#fff;flex:1}
.cert-btn--primary:hover{filter:brightness(1.12)}
.cert-btn--secondary{background:#f1f5f9;color:#334155;border:1px solid #cbd5e1}
.cert-btn--secondary:hover{background:#e2e8f0}
.cert-btn--print{background:#16a34a;color:#fff}
.cert-btn--print:hover{background:#15803d}
/* ─ Modal shell ─ */
.cert-preview-modal{position:fixed;inset:0;z-index:9900;display:flex;align-items:center;justify-content:center;direction:rtl}
.cert-preview-modal__backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55)}
.cert-preview-modal__inner{position:relative;z-index:1;background:#fff;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;width:min(700px,96vw);max-height:94vh}
.cert-preview-modal__header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e2e8f0;gap:12px;flex-shrink:0}
.cert-preview-modal__header h2{font-size:1rem;font-weight:700;margin:0;color:#1e293b}
.cert-preview-modal__close{background:none;border:none;cursor:pointer;font-size:1.1rem;color:#64748b;padding:4px 8px;border-radius:6px}
.cert-preview-modal__close:hover{background:#f1f5f9}
.cert-preview-modal__body{flex:1;overflow:auto;padding:14px;display:flex;justify-content:center;min-height:0}
.cert-preview-modal__footer{display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid #e2e8f0;flex-shrink:0}
/* ─ Logo selector panel ─ */
.cert-logo-selector{padding:10px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0;flex-shrink:0}
.cert-logo-selector__title{font-size:.75rem;font-weight:700;color:#475569;margin:0 0 8px;letter-spacing:.02em;text-transform:uppercase}
.cert-logo-selector__grid{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap}
/* ─ Logo pick cards ─ */
.cert-logo-pick{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 8px;border:2px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer;transition:border-color .15s,box-shadow .15s;min-width:64px;max-width:80px;position:relative}
.cert-logo-pick:hover{border-color:#93c5fd;box-shadow:0 0 0 3px rgba(59,130,246,.1)}
.cert-logo-pick--on{border-color:#1a3358;background:#eff6ff;box-shadow:0 0 0 2px rgba(26,51,88,.12)}
.cert-logo-pick--upload{border-style:dashed;border-color:#94a3b8;background:#f8fafc;cursor:pointer}
.cert-logo-pick--upload:hover{border-color:#3b82f6}
.cert-logo-pick__img{height:28px;max-width:60px;object-fit:contain;display:block}
.cert-logo-pick__label{font-size:.62rem;color:#475569;text-align:center;line-height:1.2;max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cert-logo-pick__check{position:absolute;top:3px;left:3px;font-size:.65rem;color:#1a3358;font-weight:700;line-height:1}
.cert-logo-pick__plus{font-size:1.3rem;color:#94a3b8;line-height:1}
.cert-logo-pick__remove-custom{border:none;background:none;cursor:pointer;font-size:.75rem;color:#dc2626;padding:2px 5px;border-radius:4px;align-self:flex-end}
.cert-logo-pick__remove-custom:hover{background:#fee2e2}
/* ─ PDF iframe viewer — relative so logo overlay sits inside ─ */
.cert-preview-viewer{display:flex;flex-direction:column;align-items:center;width:100%;max-width:460px}
.cert-preview-iframe-wrap{position:relative;width:100%;aspect-ratio:210/297;background:#f1f5f9;flex-shrink:0;border-radius:4px;overflow:hidden}
.cert-preview-iframe-wrap iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:none;display:block}
/* ─ Logo overlay — transparent, centered, top ~5% inside the certificate ─ */
.cert-preview-logo-strip{
  position:absolute;
  top:5%;
  left:50%;
  transform:translateX(-50%);
  z-index:10;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:3%;
  background:transparent;
  padding:0;
  width:80%;
  pointer-events:none;
}
.cert-preview-logo-strip--empty{display:none}
.cert-strip-logo{max-height:36px;height:auto;max-width:80px;width:auto;object-fit:contain;display:block;flex-shrink:0}
@media print{
  body>*{display:none!important}
}`,document.head.appendChild(e)}const $={load(){return Promise.resolve({})},render(e,o){return f(),`
<div class="cert-screen">
  <div class="cert-screen__header">
    <h1 class="cert-screen__title">תעודות</h1>
  </div>
  <div class="cert-cards-grid">
    ${g.map(_).join("")}
  </div>
</div>`},bind({root:e}){f(),e.addEventListener("click",o=>{const i=o.target.closest("[data-cert-open]");if(i){k(i.dataset.certOpen);return}const t=o.target.closest("[data-cert-print]");t&&v(t.dataset.certPrint)})}};export{$ as certificatesScreen};

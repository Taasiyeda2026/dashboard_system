const CERT_TEMPLATES = './assets/certificates/templates/';
const CERT_PREVIEWS  = './assets/certificates/previews/';
const CERT_LOGOS_BASE = './assets/certificates/logos/';

const CERTIFICATES = [
  { id: 'sky',        file: 'sky.pdf',        name: 'השמיים אינם הגבול' },
  { id: 'biomimicry1',file: 'biomimicry1.pdf', name: 'ביומימיקרי 1' },
  { id: 'biomimicry2',file: 'biomimicry2.pdf', name: 'ביומימיקרי 2' },
  { id: 'techspace',  file: 'techspace.pdf',   name: 'טכנולוגיות החלל' },
  { id: 'ai',         file: 'ai.pdf',          name: 'בינה מלאכותית' },
  { id: 'rokhim',     file: 'rokhim.pdf',      name: 'רוקחים עולם' }
];

const FIXED_LOGOS = [
  { file: 'ministry-of-education.png', alt: 'משרד החינוך' },
  { file: 'taasiyeda1.png',            alt: 'תעשיידע 1' },
  { file: 'taasiyeda2.png',            alt: 'תעשיידע 2' },
];

const _certLogos = {};

function certCardHtml(cert) {
  return `
<div class="cert-card" data-cert-id="${cert.id}">
  <div class="cert-card__preview-wrap">
    <img class="cert-card__preview-img" src="${CERT_PREVIEWS}${cert.id}.png" alt="${cert.name}" loading="lazy" />
  </div>
  <div class="cert-card__body">
    <p class="cert-card__name">${cert.name}</p>
    <p class="cert-card__file">${cert.file}</p>
    <div class="cert-card__actions">
      <button type="button" class="cert-btn cert-btn--primary" data-cert-open="${cert.id}">פתח תעודה</button>
      <button type="button" class="cert-btn cert-btn--print" data-cert-print="${cert.id}">הפקת PDF</button>
    </div>
  </div>
</div>`;
}

function logoBarHtml(certId) {
  const custom = _certLogos[certId];
  const fixedImgs = FIXED_LOGOS.map(l =>
    `<img class="cert-modal-logo__img" src="${CERT_LOGOS_BASE}${l.file}" alt="${l.alt}" />`
  ).join('');
  const customImg = custom
    ? `<img class="cert-modal-logo__img cert-modal-logo__img--custom" src="${custom.dataUrl}" alt="לוגו נוסף" />`
    : '';
  return `
<div class="cert-modal-logo-bar" id="certLogoBar">
  <div class="cert-modal-logo-bar__logos">
    ${fixedImgs}${customImg}
  </div>
  <div class="cert-modal-logo-bar__actions">
    <label class="cert-btn cert-btn--secondary cert-upload-lbl cert-btn--sm" title="הוספת לוגו נוסף">
      ${custom ? 'החלף לוגו נוסף' : '+ הוסף לוגו'}
      <input type="file" id="certModalLogoInput" data-cert-upload-modal="${certId}" accept="image/*" hidden />
    </label>
    ${custom ? `<button type="button" class="cert-btn cert-btn--danger cert-btn--sm" id="certModalClearLogo" data-cert-clear-logo="${certId}">הסר</button>` : ''}
  </div>
</div>`;
}

function refreshLogoBar(certId) {
  const bar = document.getElementById('certLogoBar');
  if (bar) bar.outerHTML = logoBarHtml(certId);
  const newBar = document.getElementById('certLogoBar');
  if (!newBar) return;
  newBar.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-cert-upload-modal]');
    if (inp && inp.files?.[0]) {
      handleModalLogoUpload(certId, inp.files[0]);
      inp.value = '';
    }
  });
  newBar.addEventListener('click', (e) => {
    if (e.target.closest('[data-cert-clear-logo]')) {
      delete _certLogos[certId];
      refreshLogoBar(certId);
    }
  });
}

function handleModalLogoUpload(certId, file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    _certLogos[certId] = { dataUrl: e.target.result, name: file.name };
    refreshLogoBar(certId);
  };
  reader.readAsDataURL(file);
}

function buildLogosHtmlForPrint(certId) {
  const custom = _certLogos[certId];
  const allLogos = [
    ...FIXED_LOGOS.map(l => ({ src: new URL(`${CERT_LOGOS_BASE}${l.file}`, window.location.href).href, alt: l.alt })),
    ...(custom ? [{ src: custom.dataUrl, alt: 'לוגו נוסף' }] : [])
  ];
  return allLogos.map(l =>
    `<img class="pl" src="${l.src}" alt="${l.alt}" />`
  ).join('');
}

function doPrint(certId) {
  const cert = CERTIFICATES.find((c) => c.id === certId);
  if (!cert) return;
  const pdfUrl = new URL(`${CERT_TEMPLATES}${cert.file}`, window.location.href).href;
  const logosHtml = buildLogosHtmlForPrint(certId);
  const win = window.open('', '_blank', 'width=900,height=1200');
  if (!win) return;
  win.document.write(`<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8"/>
<title>${cert.name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#e5e7eb;font-family:Arial,sans-serif;direction:rtl}
@page{size:A4 portrait;margin:0}
@media print{
  html,body{background:white;width:210mm;height:297mm;overflow:hidden}
  .no-print{display:none!important}
  .cert-print-page{width:210mm;height:297mm;overflow:hidden}
  .cert-print-embed{position:absolute;top:0;left:0;width:210mm;height:297mm}
}
.no-print{text-align:center;padding:16px}
.no-print button{background:#1a8c6e;color:#fff;border:none;padding:9px 22px;border-radius:7px;font-size:14px;font-weight:700;cursor:pointer;margin:0 6px}
.no-print button:hover{background:#157a5e}
.cert-print-page{position:relative;width:210mm;height:297mm;margin:0 auto;background:white;box-shadow:0 4px 20px rgba(0,0,0,.2);overflow:hidden}
.cert-print-embed{position:absolute;top:0;left:0;width:100%;height:100%;border:none}
.cert-print-logo-bar{position:absolute;bottom:6mm;right:6mm;left:6mm;height:14mm;display:flex;align-items:center;justify-content:center;gap:4mm;z-index:10;background:rgba(255,255,255,.82);border-radius:3mm;padding:2mm 4mm}
.pl{height:10mm;max-width:28mm;object-fit:contain;display:block}
</style>
</head>
<body>
<div class="no-print">
  <button onclick="window.print()">הדפסה / שמירה כ-PDF</button>
  <button onclick="window.close()">סגירה</button>
</div>
<div class="cert-print-page">
  <embed class="cert-print-embed" src="${pdfUrl}" type="application/pdf" />
  <div class="cert-print-logo-bar">${logosHtml}</div>
</div>
<script>
window.addEventListener('load',function(){setTimeout(function(){window.print();},600)});
window.onafterprint=function(){setTimeout(function(){window.close();},250)};
</script>
</body>
</html>`);
  win.document.close();
}

function openPreview(certId) {
  const cert = CERTIFICATES.find((c) => c.id === certId);
  if (!cert) return;
  const pdfUrl = `${CERT_TEMPLATES}${cert.file}`;

  const existing = document.getElementById('certPreviewModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'certPreviewModal';
  modal.className = 'cert-preview-modal';
  modal.innerHTML = `
    <div class="cert-preview-modal__backdrop" data-close-preview></div>
    <div class="cert-preview-modal__inner" role="dialog" aria-modal="true" aria-label="${cert.name}">
      <div class="cert-preview-modal__header">
        <h2>${cert.name}</h2>
        <button type="button" class="cert-preview-modal__close" data-close-preview aria-label="סגירה">✕</button>
      </div>
      ${logoBarHtml(certId)}
      <div class="cert-preview-modal__body">
        <div class="cert-preview-iframe-wrap">
          <iframe src="${pdfUrl}#toolbar=0&navpanes=0" title="${cert.name}"></iframe>
        </div>
      </div>
      <div class="cert-preview-modal__footer">
        <button type="button" class="cert-btn cert-btn--print" data-modal-print="${certId}">הפקת PDF</button>
        <button type="button" class="cert-btn cert-btn--secondary" data-close-preview>סגירה</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  modal.querySelectorAll('[data-close-preview]').forEach((el) => {
    el.addEventListener('click', () => modal.remove());
  });
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.remove(); });

  modal.addEventListener('click', (e) => {
    const printBtn = e.target.closest('[data-modal-print]');
    if (printBtn) { doPrint(printBtn.dataset.modalPrint); return; }
  });

  const bar = modal.querySelector('#certLogoBar');
  if (bar) {
    bar.addEventListener('change', (e) => {
      const inp = e.target.closest('[data-cert-upload-modal]');
      if (inp && inp.files?.[0]) {
        handleModalLogoUpload(certId, inp.files[0]);
        inp.value = '';
      }
    });
    bar.addEventListener('click', (e) => {
      if (e.target.closest('[data-cert-clear-logo]')) {
        delete _certLogos[certId];
        refreshLogoBar(certId);
      }
    });
  }
}

function ensureStyles() {
  if (document.getElementById('cert-screen-styles')) return;
  const s = document.createElement('style');
  s.id = 'cert-screen-styles';
  s.textContent = `
.cert-screen{padding:var(--ds-space-4,16px);direction:rtl}
.cert-screen__title{font-size:1.25rem;font-weight:700;color:var(--ds-text-primary,#111);margin:0}
.cert-cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,210px));gap:14px;margin-top:16px}
.cert-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 1px 4px rgba(0,0,0,.07);transition:box-shadow .15s}
.cert-card:hover{box-shadow:0 4px 14px rgba(0,0,0,.13)}
.cert-card__preview-wrap{width:100%;aspect-ratio:210/297;background:#f1f5f9;overflow:hidden;flex-shrink:0}
.cert-card__preview-img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
.cert-card__body{padding:8px 10px;display:flex;flex-direction:column;gap:5px;flex:1}
.cert-card__name{font-size:.82rem;font-weight:700;color:#1e293b;margin:0;line-height:1.3}
.cert-card__file{font-size:.7rem;color:#94a3b8;font-family:monospace;margin:0}
.cert-card__actions{display:flex;gap:6px;flex-wrap:nowrap;margin-top:6px}
.cert-btn{font-family:inherit;font-size:.76rem;font-weight:600;padding:5px 10px;border-radius:6px;cursor:pointer;border:none;transition:background .15s;white-space:nowrap;line-height:1.4}
.cert-btn--sm{font-size:.72rem;padding:4px 8px}
.cert-btn--primary{background:var(--ds-accent,#1a3358);color:#fff;flex:1}
.cert-btn--primary:hover{filter:brightness(1.12)}
.cert-btn--secondary{background:#f1f5f9;color:#334155;border:1px solid #cbd5e1}
.cert-btn--secondary:hover{background:#e2e8f0}
.cert-btn--danger{background:#fee2e2;color:#dc2626;border:1px solid #fca5a5}
.cert-btn--danger:hover{background:#fecaca}
.cert-upload-lbl{display:inline-flex;align-items:center;justify-content:center}
.cert-btn--print{background:#16a34a;color:#fff}
.cert-btn--print:hover{background:#15803d}
.cert-preview-modal{position:fixed;inset:0;z-index:9900;display:flex;align-items:center;justify-content:center;direction:rtl}
.cert-preview-modal__backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55)}
.cert-preview-modal__inner{position:relative;z-index:1;background:#fff;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;width:min(680px,96vw);max-height:94vh}
.cert-preview-modal__header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e2e8f0;gap:12px;flex-shrink:0}
.cert-preview-modal__header h2{font-size:1rem;font-weight:700;margin:0;color:#1e293b}
.cert-preview-modal__close{background:none;border:none;cursor:pointer;font-size:1.1rem;color:#64748b;padding:4px 8px;border-radius:6px}
.cert-preview-modal__close:hover{background:#f1f5f9}
.cert-modal-logo-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0;flex-shrink:0;flex-wrap:wrap}
.cert-modal-logo-bar__logos{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.cert-modal-logo__img{height:32px;max-width:80px;object-fit:contain;display:block}
.cert-modal-logo__img--custom{height:32px;max-width:80px;border:1px dashed #94a3b8;border-radius:4px;padding:2px}
.cert-modal-logo-bar__actions{display:flex;align-items:center;gap:6px;flex-shrink:0}
.cert-preview-modal__body{flex:1;overflow:auto;padding:16px;display:flex;justify-content:center;min-height:0}
.cert-preview-iframe-wrap{width:100%;max-width:480px;aspect-ratio:210/297;flex-shrink:0}
.cert-preview-iframe-wrap iframe{width:100%;height:100%;border:none;display:block}
.cert-preview-modal__footer{display:flex;align-items:center;justify-content:flex-start;gap:8px;padding:10px 16px;border-top:1px solid #e2e8f0;flex-shrink:0}
@media print{
  body>*{display:none!important}
  body>.cert-print-root{display:block!important}
}`;
  document.head.appendChild(s);
}

export const certificatesScreen = {
  load() {
    return Promise.resolve({});
  },

  render(_data, _ctx) {
    return `
<div class="cert-screen">
  <div class="cert-screen__header">
    <h1 class="cert-screen__title">תעודות</h1>
  </div>
  <div class="cert-cards-grid">
    ${CERTIFICATES.map(certCardHtml).join('')}
  </div>
</div>`;
  },

  bind({ root }) {
    ensureStyles();

    root.addEventListener('click', (e) => {
      const openBtn = e.target.closest('[data-cert-open]');
      if (openBtn) { openPreview(openBtn.dataset.certOpen); return; }

      const printBtn = e.target.closest('[data-cert-print]');
      if (printBtn) { doPrint(printBtn.dataset.certPrint); return; }
    });
  }
};

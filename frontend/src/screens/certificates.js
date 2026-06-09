const CERT_TEMPLATES = './assets/certificates/templates/';
const CERT_PREVIEWS  = './assets/certificates/previews/';
const CERT_LOGOS_BASE = './assets/certificates/logos/';

const CERTIFICATES = [
  { id: 'sky', file: 'sky.pdf', name: 'השמיים אינם הגבול' },
  { id: 'biomimicry1', file: 'biomimicry1.pdf', name: 'ביומימיקרי 1' },
  { id: 'biomimicry2', file: 'biomimicry2.pdf', name: 'ביומימיקרי 2' },
  { id: 'techspace', file: 'techspace.pdf', name: 'טכנולוגיות החלל' },
  { id: 'ai', file: 'ai.pdf', name: 'בינה מלאכותית' },
  { id: 'rokhim', file: 'rokhim.pdf', name: 'רוקחים עולם' }
];

let _uploadedLogoDataUrl = null;
let _uploadedLogoName = '';

function certCardHtml(cert) {
  const previewUrl = `${CERT_PREVIEWS}${cert.id}.png`;
  return `
<div class="cert-card" data-cert-id="${cert.id}">
  <div class="cert-card__preview-wrap">
    <img
      class="cert-card__preview-img"
      src="${previewUrl}"
      alt="${cert.name}"
      loading="lazy"
    />
  </div>
  <div class="cert-card__body">
    <p class="cert-card__name">${cert.name}</p>
    <p class="cert-card__file">${cert.file}</p>
    <div class="cert-card__actions">
      <button type="button" class="cert-btn cert-btn--primary" data-cert-open="${cert.id}">פתח תעודה</button>
      <label class="cert-btn cert-btn--secondary cert-upload-lbl" title="העלאת לוגו">
        העלאת לוגו
        <input type="file" class="cert-logo-input" data-cert-upload="${cert.id}" accept="image/*" hidden />
      </label>
      <button type="button" class="cert-btn cert-btn--print" data-cert-print="${cert.id}">הפקת PDF</button>
    </div>
  </div>
</div>`;
}

function ensureStyles() {
  if (document.getElementById('cert-screen-styles')) return;
  const s = document.createElement('style');
  s.id = 'cert-screen-styles';
  s.textContent = `
.cert-screen{padding:var(--ds-space-4,16px);direction:rtl}
.cert-screen__title{font-size:1.25rem;font-weight:700;margin-bottom:var(--ds-space-4,16px);color:var(--ds-text-primary,#111)}
.cert-cards-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,210px));gap:14px}
.cert-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 1px 4px rgba(0,0,0,.07);transition:box-shadow .15s}
.cert-card:hover{box-shadow:0 4px 14px rgba(0,0,0,.13)}
.cert-card__preview-wrap{width:100%;aspect-ratio:210/297;background:#f1f5f9;overflow:hidden;flex-shrink:0}
.cert-card__preview-img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
.cert-card__body{padding:8px 10px;display:flex;flex-direction:column;gap:5px;flex:1}
.cert-card__name{font-size:.82rem;font-weight:700;color:#1e293b;margin:0;line-height:1.3}
.cert-card__file{font-size:.7rem;color:#94a3b8;font-family:monospace;margin:0}
.cert-card__actions{display:flex;gap:4px;flex-wrap:nowrap;margin-top:6px;align-items:center}
.cert-btn{font-family:inherit;font-size:.72rem;font-weight:600;padding:4px 8px;border-radius:6px;cursor:pointer;border:none;transition:background .15s;white-space:nowrap;line-height:1.4}
.cert-btn--primary{background:var(--ds-accent,#1a3358);color:#fff;flex:1}
.cert-btn--primary:hover{filter:brightness(1.12)}
.cert-btn--secondary{background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;cursor:pointer;flex:1}
.cert-btn--secondary:hover{background:#e2e8f0}
.cert-upload-lbl{display:inline-flex;align-items:center;justify-content:center}
.cert-btn--print{background:#16a34a;color:#fff;flex:1}
.cert-btn--print:hover{background:#15803d}
.cert-preview-modal{position:fixed;inset:0;z-index:9900;display:flex;align-items:center;justify-content:center;direction:rtl}
.cert-preview-modal__backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55)}
.cert-preview-modal__inner{position:relative;z-index:1;background:#fff;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;width:min(720px,96vw);max-height:92vh}
.cert-preview-modal__header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e2e8f0;gap:12px}
.cert-preview-modal__header h2{font-size:1rem;font-weight:700;margin:0;color:#1e293b}
.cert-preview-modal__close{background:none;border:none;cursor:pointer;font-size:1.1rem;color:#64748b;padding:4px 8px;border-radius:6px}
.cert-preview-modal__close:hover{background:#f1f5f9}
.cert-preview-modal__body{flex:1;overflow:auto;padding:16px;display:flex;justify-content:center}
.cert-preview-iframe-wrap{position:relative;width:100%;max-width:500px;aspect-ratio:210/297}
.cert-preview-iframe-wrap iframe{position:absolute;inset:0;width:100%;height:100%;border:none}
.cert-preview-logo-overlay{position:absolute;top:8%;left:4%;width:28%;max-height:12%;pointer-events:none;z-index:2;display:flex;align-items:center;justify-content:center}
.cert-preview-logo-overlay img{width:100%;height:100%;object-fit:contain;display:block}
.cert-logo-status{font-size:.75rem;color:#16a34a;font-style:italic}
@media print{
  body>*{display:none!important}
  body>.cert-print-root{display:block!important}
}`;
  document.head.appendChild(s);
}

function doPrint(certId) {
  const cert = CERTIFICATES.find((c) => c.id === certId);
  if (!cert) return;
  const pdfUrl = new URL(`${CERT_TEMPLATES}${cert.file}`, window.location.href).href;
  const logoHtml = _uploadedLogoDataUrl
    ? `<img class="cert-print-logo" src="${_uploadedLogoDataUrl}" alt="לוגו" />`
    : '';
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
.cert-print-logo{position:absolute;top:15mm;left:12mm;width:36mm;max-height:20mm;object-fit:contain;z-index:10;display:block}
</style>
</head>
<body>
<div class="no-print">
  <button onclick="window.print()">הדפסה / שמירה כ-PDF</button>
  <button onclick="window.close()">סגירה</button>
</div>
<div class="cert-print-page">
  <embed class="cert-print-embed" src="${pdfUrl}" type="application/pdf" />
  ${logoHtml}
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
        <h2>${cert.name} — ${cert.file}</h2>
        <button type="button" class="cert-preview-modal__close" data-close-preview aria-label="סגירה">✕</button>
      </div>
      <div class="cert-preview-modal__body">
        <div class="cert-preview-iframe-wrap" id="certPreviewWrap">
          <iframe src="${pdfUrl}#toolbar=0&navpanes=0" title="${cert.name}"></iframe>
          <div class="cert-preview-logo-overlay" id="certPreviewLogo">
            ${_uploadedLogoDataUrl ? `<img src="${_uploadedLogoDataUrl}" alt="לוגו" />` : ''}
          </div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(modal);

  modal.querySelectorAll('[data-close-preview]').forEach((el) => {
    el.addEventListener('click', () => modal.remove());
  });
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.remove(); });
  modal.querySelector('.cert-preview-modal__inner').focus?.();
}

function updateAllLogoOverlays() {
  document.querySelectorAll('[data-cert-logo-overlay]').forEach((wrap) => {
    wrap.innerHTML = _uploadedLogoDataUrl
      ? `<img src="${_uploadedLogoDataUrl}" alt="לוגו" />`
      : '';
  });
  const previewLogo = document.getElementById('certPreviewLogo');
  if (previewLogo) {
    previewLogo.innerHTML = _uploadedLogoDataUrl
      ? `<img src="${_uploadedLogoDataUrl}" alt="לוגו" />`
      : '';
  }
  const statusEl = document.getElementById('certLogoStatus');
  if (statusEl) {
    statusEl.textContent = _uploadedLogoDataUrl
      ? `לוגו שהועלה: ${_uploadedLogoName}`
      : 'לא הועלה לוגו';
  }
}

function handleLogoUpload(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    _uploadedLogoDataUrl = e.target.result;
    _uploadedLogoName = file.name;
    updateAllLogoOverlays();
  };
  reader.readAsDataURL(file);
}

export const certificatesScreen = {
  load() {
    return Promise.resolve({});
  },

  render(_data, _ctx) {
    return `
<div class="cert-screen">
  <div class="cert-screen__header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:16px">
    <h1 class="cert-screen__title" style="margin:0">תעודות</h1>
    <div style="display:flex;align-items:center;gap:10px;font-size:.8rem;color:#64748b">
      <span id="certLogoStatus">${_uploadedLogoDataUrl ? `לוגו שהועלה: ${_uploadedLogoName}` : 'לא הועלה לוגו'}</span>
      <label class="cert-btn cert-btn--secondary cert-upload-lbl" style="font-size:.8rem" title="העלאת לוגו גלובלי לכל התעודות">
        החלף לוגו
        <input type="file" id="certGlobalLogoInput" accept="image/*" hidden />
      </label>
      ${_uploadedLogoDataUrl ? `<button type="button" id="certClearLogo" class="cert-btn cert-btn--secondary" style="font-size:.78rem;color:#dc2626">הסר לוגו</button>` : ''}
    </div>
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

      const clearBtn = e.target.closest('#certClearLogo');
      if (clearBtn) {
        _uploadedLogoDataUrl = null;
        _uploadedLogoName = '';
        updateAllLogoOverlays();
        const statusEl = document.getElementById('certLogoStatus');
        if (statusEl) statusEl.textContent = 'לא הועלה לוגו';
        clearBtn.remove();
        return;
      }
    });

    root.addEventListener('change', (e) => {
      const uploadInput = e.target.closest('[data-cert-upload], #certGlobalLogoInput');
      if (uploadInput && uploadInput.files?.[0]) {
        handleLogoUpload(uploadInput.files[0]);
        uploadInput.value = '';
      }
    });
  }
};

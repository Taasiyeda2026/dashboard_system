import { photoConsentActivityFiles, photoConsentInvoke } from './photo-consent-client.js';

const STYLE = '<style>' +
  '.pc-drawer-viewer-backdrop{position:fixed;inset:0;z-index:100010;background:#102b3ecc;display:grid;place-items:center;padding:14px;direction:rtl}' +
  '.pc-drawer-viewer{width:min(94vw,900px);height:min(91dvh,820px);min-height:330px;display:flex;flex-direction:column;gap:12px;background:#fff;color:#243b49;border-radius:16px;box-shadow:0 18px 55px #12283944;padding:16px;overflow:hidden}' +
  '.pc-drawer-viewer-head,.pc-drawer-viewer-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}' +
  '.pc-drawer-viewer-title{font-weight:750;font-size:16px;overflow-wrap:anywhere}' +
  '.pc-drawer-viewer-btn{background:#fff;border:1px solid #d2e1e8;border-radius:9px;color:#126d80;min-height:37px;padding:8px 13px;cursor:pointer;font-size:13px}' +
  '.pc-drawer-viewer-btn:focus-visible{outline:2px solid #028b9f;outline-offset:2px}.pc-drawer-viewer-btn:hover{background:#eaf7f9}' +
  '.pc-drawer-viewer-btn--add{background:#eef9f4;color:#137645;border-color:#8dccab}' +
  '.pc-drawer-viewer-content{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:9px}' +
  '.pc-drawer-viewer-file{padding:11px;border:1px solid #e1eaee;border-radius:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}' +
  '.pc-drawer-viewer-file-name{min-width:0;overflow-wrap:anywhere;flex:1;font-size:13px}' +
  '.pc-drawer-viewer-preview{width:100%;flex:1;min-height:0;border:0;object-fit:contain}' +
  '@media(max-width:620px){.pc-drawer-viewer-backdrop{padding:6px}.pc-drawer-viewer{width:100%;height:96dvh;padding:12px;border-radius:13px}.pc-drawer-viewer-file{align-items:stretch}.pc-drawer-viewer-file-name{flex-basis:100%}}' +
  '</style>';

function button(label, onClick, extraClass = '') {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'pc-drawer-viewer-btn' + (extraClass ? ' ' + extraClass : '');
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

function blobFromData(data) {
  const binary = atob(data.base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: data.mime_type });
}

export async function openActivityPhotoConsentViewer(activityId, { onAdd = () => {} } = {}) {
  const files = await photoConsentActivityFiles(activityId);
  if (!files.length) return false;

  const previousFocus = document.activeElement;
  const overlay = document.createElement('div');
  const panel = document.createElement('section');
  const header = document.createElement('header');
  const title = document.createElement('strong');
  const actions = document.createElement('div');
  const content = document.createElement('div');
  let objectUrl = '';
  let closed = false;
  let loadSequence = 0;
  overlay.className = 'pc-drawer-viewer-backdrop';
  overlay.dir = 'rtl';
  panel.className = 'pc-drawer-viewer';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'צפייה באישורי צילום');
  header.className = 'pc-drawer-viewer-head';
  title.className = 'pc-drawer-viewer-title';
  actions.className = 'pc-drawer-viewer-actions';
  content.className = 'pc-drawer-viewer-content';

  function clearUrl() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
  }
  function close() {
    if (closed) return;
    closed = true;
    loadSequence++;
    clearUrl();
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    previousFocus?.focus?.();
  }
  function onKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  }
  function setActions(extra = []) {
    actions.replaceChildren(...extra,
      button('העלאת אישור נוסף', () => { close(); onAdd(); }, 'pc-drawer-viewer-btn--add'),
      button('סגירה', close));
  }
  function showList() {
    loadSequence++;
    clearUrl();
    title.textContent = 'אישורי צילום (' + files.length + ')';
    content.replaceChildren();
    for (const file of files) {
      const row = document.createElement('div');
      const name = document.createElement('span');
      name.className = 'pc-drawer-viewer-file-name';
      name.textContent = file.file_name || 'אישור צילום';
      row.className = 'pc-drawer-viewer-file';
      row.append(name, button('צפייה', () => { void showPreview(file); }));
      content.append(row);
    }
    setActions();
  }
  async function showPreview(file) {
    const sequence = ++loadSequence;
    clearUrl();
    title.textContent = file.file_name || 'אישור צילום';
    const loading = document.createElement('p');
    loading.textContent = 'טוען את המסמך…';
    content.replaceChildren(loading);
    setActions(files.length > 1 ? [button('חזרה לרשימה', showList)] : []);
    try {
      const data = await photoConsentInvoke('download', { file_id: file.id });
      if (closed || sequence !== loadSequence) return;
      objectUrl = URL.createObjectURL(blobFromData(data));
      const preview = document.createElement(data.mime_type === 'application/pdf' ? 'iframe' : 'img');
      preview.className = 'pc-drawer-viewer-preview';
      if (data.mime_type === 'application/pdf') preview.title = data.file_name || 'אישור צילום';
      else preview.alt = data.file_name || 'אישור צילום';
      preview.src = objectUrl;
      content.replaceChildren(preview);
      actions.prepend(button('הורדה', () => {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = data.file_name || 'אישור צילום';
        link.click();
      }));
    } catch (error) {
      if (!closed && sequence === loadSequence) {
        loading.textContent = error?.message || 'טעינת האישור נכשלה.';
      }
    }
  }

  const style = document.createElement('div');
  style.innerHTML = STYLE;
  header.append(title, actions);
  panel.append(header, content);
  overlay.append(style, panel);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  document.body.append(overlay);
  document.addEventListener('keydown', onKeydown);
  if (files.length === 1) void showPreview(files[0]);
  else showList();
  actions.querySelector('button:last-child')?.focus();
  return true;
}

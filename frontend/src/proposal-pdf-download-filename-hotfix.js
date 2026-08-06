import { api } from './api.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalPdfDownloadFilenameHotfix');
const DOWNLOAD_REQUEST_TTL_MS = 120000;

function cleanPdfDownloadFileName(value = '') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'proposal.pdf';
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

export function proposalPdfDownloadUrl(signedUrl, fileName, baseUrl = globalThis?.location?.href || 'http://localhost/') {
  const rawUrl = String(signedUrl || '').trim();
  if (!rawUrl) return rawUrl;
  const url = new URL(rawUrl, baseUrl);
  url.searchParams.set('download', cleanPdfDownloadFileName(fileName));
  return url.toString();
}

export function installProposalPdfDownloadFilenameHotfix(targetApi = api, scope = globalThis) {
  if (!targetApi || targetApi[PATCH_KEY]) return false;
  const original = targetApi.getProposalFinalPdfSignedUrl;
  if (typeof original !== 'function') return false;

  let downloadRequested = false;
  let resetTimer = null;

  const clearDownloadRequest = () => {
    downloadRequested = false;
    if (resetTimer != null && typeof scope?.clearTimeout === 'function') {
      scope.clearTimeout(resetTimer);
    }
    resetTimer = null;
  };

  const requestDownload = () => {
    downloadRequested = true;
    if (resetTimer != null && typeof scope?.clearTimeout === 'function') {
      scope.clearTimeout(resetTimer);
    }
    resetTimer = typeof scope?.setTimeout === 'function'
      ? scope.setTimeout(clearDownloadRequest, DOWNLOAD_REQUEST_TTL_MS)
      : null;
  };

  const documentRef = scope?.document;
  if (documentRef && typeof documentRef.addEventListener === 'function') {
    documentRef.addEventListener('click', (event) => {
      const target = event?.target;
      const closest = typeof target?.closest === 'function' ? target.closest.bind(target) : null;
      if (!closest) return;
      if (closest('#pa-print-btn')) {
        requestDownload();
        return;
      }
      if (closest('#pa-view-final-pdf-btn')) clearDownloadRequest();
    }, true);
  }

  targetApi.getProposalFinalPdfSignedUrl = async function proposalPdfSignedDownloadUrl(...args) {
    const shouldDownload = downloadRequested;
    clearDownloadRequest();
    const result = await original.apply(this, args);
    if (!shouldDownload || !result?.signedUrl) return result;
    return {
      ...result,
      signedUrl: proposalPdfDownloadUrl(result.signedUrl, result.fileName, scope?.location?.href)
    };
  };

  Object.defineProperty(targetApi, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return true;
}

installProposalPdfDownloadFilenameHotfix(api, globalThis);

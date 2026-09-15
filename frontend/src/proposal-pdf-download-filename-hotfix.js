import { api } from './api.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalPdfDownloadFilenameHotfix');
const OBJECT_URL_PATCH_KEY = Symbol.for('taasiyeda.proposalPdfNamedBlobDownloadHotfix');
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

function cleanSchoolName(value = '') {
  return String(value || '')
    .replace(/["“”״]/g, '')
    .replace(/[\\/:*?<>|]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function schoolNameFromProposalDocument(documentRef) {
  const previewAreas = Array.from(documentRef?.querySelectorAll?.('.proposal-preview-area') || []);
  for (const previewArea of previewAreas.reverse()) {
    const metaText = String(previewArea.querySelector?.('.pa-gefen-school-meta')?.textContent || '');
    const schoolMatch = metaText.match(/בית ספר:\s*([^|]+)/);
    const schoolName = cleanSchoolName(schoolMatch?.[1]);
    if (schoolName) return schoolName;
  }

  const forms = Array.from(documentRef?.querySelectorAll?.('[data-pa-form]') || []);
  for (const form of forms.reverse()) {
    const schoolName = cleanSchoolName(
      form.querySelector?.('[name="school_framework"]')?.value
        || form.querySelector?.('input[name="contact_source_school"]')?.value
        || ''
    );
    if (schoolName) return schoolName;
  }

  return '';
}

export function proposalPdfPreferredDownloadFileName(documentRef, fallbackFileName = '') {
  const schoolName = schoolNameFromProposalDocument(documentRef);
  if (schoolName) return cleanPdfDownloadFileName(`הצעת מחיר ${schoolName}.pdf`);

  const documentTitle = String(documentRef?.title || '').trim();
  if (documentTitle && documentTitle !== 'מפיק PDF…') {
    return cleanPdfDownloadFileName(documentTitle);
  }

  return cleanPdfDownloadFileName(fallbackFileName || 'proposal.pdf');
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
      if (closest('#pa-print-btn') || closest('[data-pa-print]')) {
        requestDownload();
        return;
      }
      if (closest('#pa-view-final-pdf-btn')) clearDownloadRequest();
    }, true);
  }

  const urlApi = scope?.URL;
  if (
    !scope?.[OBJECT_URL_PATCH_KEY]
    && urlApi
    && typeof urlApi.createObjectURL === 'function'
    && documentRef
  ) {
    const originalCreateObjectURL = urlApi.createObjectURL.bind(urlApi);
    const namedCreateObjectURL = function namedProposalPdfObjectUrl(value) {
      const objectUrl = originalCreateObjectURL(value);
      const isPdf = String(value?.type || '').toLowerCase() === 'application/pdf';
      if (!downloadRequested || !isPdf) return objectUrl;

      const fileName = proposalPdfPreferredDownloadFileName(documentRef, value?.name);
      clearDownloadRequest();

      const triggerDownload = () => {
        const anchor = documentRef.createElement?.('a');
        if (!anchor) return;
        anchor.href = objectUrl;
        anchor.download = fileName;
        anchor.style.display = 'none';
        const host = documentRef.body || documentRef.documentElement;
        host?.appendChild?.(anchor);
        try { anchor.click(); } finally { anchor.remove?.(); }
      };

      if (typeof scope?.queueMicrotask === 'function') scope.queueMicrotask(triggerDownload);
      else if (typeof scope?.setTimeout === 'function') scope.setTimeout(triggerDownload, 0);
      else triggerDownload();

      return objectUrl;
    };

    try {
      urlApi.createObjectURL = namedCreateObjectURL;
      Object.defineProperty(scope, OBJECT_URL_PATCH_KEY, {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
      });
    } catch {
      // Keep the existing signed-URL filename fix if this browser does not allow wrapping URL.createObjectURL.
    }
  }

  targetApi.getProposalFinalPdfSignedUrl = async function proposalPdfSignedDownloadUrl(...args) {
    const shouldDownload = downloadRequested;
    clearDownloadRequest();
    const result = await original.apply(this, args);
    if (!shouldDownload || !result?.signedUrl) return result;
    return {
      ...result,
      signedUrl: proposalPdfDownloadUrl(
        result.signedUrl,
        proposalPdfPreferredDownloadFileName(documentRef, result.fileName),
        scope?.location?.href
      )
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

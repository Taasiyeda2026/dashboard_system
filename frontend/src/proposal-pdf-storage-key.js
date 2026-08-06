const PATCH_KEY = Symbol.for('taasiyeda.proposalPdfStorageKeyHotfix');

function asciiProposalId(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'document';
}

export function proposalPdfSafeStorageFileName(proposalId, timestamp = Date.now()) {
  const safeId = asciiProposalId(proposalId);
  const safeTimestamp = Number.isFinite(Number(timestamp)) ? Math.trunc(Number(timestamp)) : Date.now();
  return `proposal-${safeId}-${safeTimestamp}.pdf`;
}

export function proposalPdfFileWithSafeStorageName(file, proposalId, scope = globalThis) {
  if (!file || typeof file !== 'object') return file;
  const currentName = String(file.name || '').trim();
  if (/^[a-zA-Z0-9._-]+$/.test(currentName) && currentName.toLowerCase().endsWith('.pdf')) return file;

  const safeName = proposalPdfSafeStorageFileName(proposalId);
  const options = {
    type: 'application/pdf',
    lastModified: Number(file.lastModified) || Date.now()
  };

  if (typeof scope?.File === 'function') {
    return new scope.File([file], safeName, options);
  }

  const BlobCtor = scope?.Blob;
  const safeBlob = typeof file.slice === 'function'
    ? file.slice(0, Number(file.size) || undefined, 'application/pdf')
    : (typeof BlobCtor === 'function' ? new BlobCtor([file], { type: 'application/pdf' }) : file);

  try {
    Object.defineProperty(safeBlob, 'name', {
      value: safeName,
      configurable: true,
      enumerable: true
    });
    Object.defineProperty(safeBlob, 'lastModified', {
      value: options.lastModified,
      configurable: true,
      enumerable: true
    });
  } catch {
    // The browser File path above is used in production. Keep the original object only as a last resort.
  }
  return safeBlob;
}

export function installProposalPdfStorageKeyHotfix(targetApi, scope = globalThis) {
  if (!targetApi || targetApi[PATCH_KEY]) return false;

  for (const methodName of ['uploadProposalFinalPdf', 'lockAndSendProposalAgreement']) {
    const original = targetApi[methodName];
    if (typeof original !== 'function') continue;

    targetApi[methodName] = function proposalPdfStorageKeySafeCall(id, payload = {}) {
      const sourceFile = payload?.pdfFile || payload?.file || null;
      if (!sourceFile) return original.call(this, id, payload);
      const safeFile = proposalPdfFileWithSafeStorageName(sourceFile, id, scope);
      return original.call(this, id, {
        ...payload,
        pdfFile: safeFile,
        file: safeFile
      });
    };
  }

  Object.defineProperty(targetApi, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return true;
}

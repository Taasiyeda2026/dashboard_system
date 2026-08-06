const PATCH_KEY = '__proposalPdfSvgOriginCleanInstalled';
const SVG_SOURCE = Symbol('proposalPdfSvgSource');

function svgToDataUrl(svg) {
  const bytes = new TextEncoder().encode(String(svg || ''));
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

export function installProposalPdfSvgOriginCleanHotfix(scope = globalThis) {
  if (!scope || scope[PATCH_KEY]) return false;
  const NativeBlob = scope.Blob;
  const urlApi = scope.URL;
  if (typeof NativeBlob !== 'function' || !urlApi || typeof urlApi.createObjectURL !== 'function') return false;

  const nativeCreateObjectUrl = urlApi.createObjectURL.bind(urlApi);
  const nativeRevokeObjectUrl = typeof urlApi.revokeObjectURL === 'function'
    ? urlApi.revokeObjectURL.bind(urlApi)
    : null;

  const BlobProxy = new Proxy(NativeBlob, {
    construct(target, args) {
      const parts = Array.isArray(args?.[0]) ? args[0] : [];
      const options = args?.[1] || {};
      const blob = Reflect.construct(target, [parts, options], target);
      const type = String(options?.type || blob.type || '').toLowerCase();
      if (type.startsWith('image/svg+xml') && parts.length && parts.every((part) => typeof part === 'string')) {
        try {
          Object.defineProperty(blob, SVG_SOURCE, {
            value: parts.join(''),
            configurable: false,
            enumerable: false,
            writable: false
          });
        } catch {
          // Keep native Blob behavior when metadata cannot be attached.
        }
      }
      return blob;
    },
    get(target, property, receiver) {
      if (property === Symbol.hasInstance) {
        return (instance) => instance instanceof target;
      }
      return Reflect.get(target, property, receiver);
    }
  });

  scope.Blob = BlobProxy;
  urlApi.createObjectURL = (blob) => {
    const svg = blob?.[SVG_SOURCE];
    if (typeof svg === 'string') return svgToDataUrl(svg);
    return nativeCreateObjectUrl(blob);
  };
  urlApi.revokeObjectURL = (value) => {
    if (typeof value === 'string' && value.startsWith('data:image/svg+xml')) return;
    nativeRevokeObjectUrl?.(value);
  };

  Object.defineProperty(scope, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return true;
}

if (typeof window !== 'undefined' && window === globalThis) {
  installProposalPdfSvgOriginCleanHotfix(window);
}

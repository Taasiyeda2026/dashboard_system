import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installProposalPdfSvgOriginCleanHotfix } from '../frontend/src/proposal-pdf-svg-origin-clean.js';

class FakeBlob {
  constructor(parts = [], options = {}) {
    this.parts = parts;
    this.type = String(options.type || '');
  }
}

test('generated SVG blobs use an inline data URL while other blobs keep native object URLs', () => {
  const created = [];
  const revoked = [];
  const scope = {
    Blob: FakeBlob,
    URL: {
      createObjectURL(blob) {
        created.push(blob);
        return 'blob:native-object-url';
      },
      revokeObjectURL(value) {
        revoked.push(value);
      }
    }
  };

  assert.equal(installProposalPdfSvgOriginCleanHotfix(scope), true);
  assert.equal(installProposalPdfSvgOriginCleanHotfix(scope), false);

  const svgBlob = new scope.Blob(['<svg xmlns="http://www.w3.org/2000/svg"><text>שלום</text></svg>'], {
    type: 'image/svg+xml;charset=utf-8'
  });
  const svgUrl = scope.URL.createObjectURL(svgBlob);
  assert.match(svgUrl, /^data:image\/svg\+xml;base64,/);
  assert.equal(Buffer.from(svgUrl.split(',')[1], 'base64').toString('utf8').includes('שלום'), true);
  assert.equal(created.length, 0);

  scope.URL.revokeObjectURL(svgUrl);
  assert.deepEqual(revoked, []);

  const pdfBlob = new scope.Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' });
  assert.equal(scope.URL.createObjectURL(pdfBlob), 'blob:native-object-url');
  assert.equal(created.length, 1);
  scope.URL.revokeObjectURL('blob:native-object-url');
  assert.deepEqual(revoked, ['blob:native-object-url']);
  assert.equal(pdfBlob instanceof scope.Blob, true);
});

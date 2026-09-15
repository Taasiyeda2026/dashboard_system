import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bridge = await readFile(new URL('../frontend/src/proposal-vector-pdf-bridge.js', import.meta.url), 'utf8');
const routeLoader = await readFile(new URL('../frontend/src/feature-route-loader.js', import.meta.url), 'utf8');

test('proposal PDF request is patched to the client vector generator before interaction', () => {
  assert.match(routeLoader, /proposal-vector-pdf-bridge\.js/);
  assert.match(bridge, /targetApi\.requestProposalFinalPdf = async/);
  assert.match(bridge, /saveProposalVectorPdf/);
  assert.doesNotMatch(bridge, /functions\.invoke\(['"]proposal-final-pdf/);
  assert.doesNotMatch(bridge, /BROWSERLESS/);
});

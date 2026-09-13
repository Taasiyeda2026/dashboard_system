import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DOMAIN_ROUTING_FILE = new URL('../frontend/src/proposal-domain-routing.js', import.meta.url);

test('domain E routing host cannot shrink inside the drawer flex column', async () => {
  const source = await readFile(DOMAIN_ROUTING_FILE, 'utf8');

  assert.match(
    source,
    /\[data-proposal-domain-routing-host\]\s*\{[\s\S]*?flex:\s*0\s+0\s+auto\s*!important;[\s\S]*?width:\s*100%\s*!important;/
  );
  assert.match(source, /\.proposal-israa-routing\s*\{[\s\S]*?position:\s*static\s*!important;/);
  assert.match(source, /querySelector\('\[data-proposal-domain-routing-host\]'\)/);
  assert.match(source, /host\.replaceChildren\(card\)/);
});

test('domain routing contract remains E to Israa and Y out of the Israa card', async () => {
  const source = await readFile(DOMAIN_ROUTING_FILE, 'utf8');

  assert.match(source, /create_israa_tracking_from_proposal/);
  assert.match(source, /if \(domain === 'Y'\) \{\s*clearOurRouting\(root\);\s*return;/);
  assert.match(source, /if \(domain !== 'E' \|\| !isEligible2027Proposal\(proposal\)\)/);
});

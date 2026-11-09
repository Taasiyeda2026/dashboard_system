import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../frontend/src/spin-off-session-bridge.js', import.meta.url), 'utf8');
const bridge = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const nonce = 'a'.repeat(43);
const origin = 'https://taasiyeda2026.github.io';

function storage() {
  const data = new Map();
  return { getItem: key => data.get(key), setItem: (key,value) => data.set(key,value), removeItem: key => data.delete(key) };
}

test('valid origin and nonce enforced, no attacker-controlled origin', () => {
  assert.equal(bridge.validSpinOffBridgeRequest(origin, nonce, origin), true);
  for (const other of ['https://evil.example','https://taasiyeda2026.github.io.evil.example', 'null', 'javascript:alert(1)']) {
    assert.equal(bridge.validSpinOffBridgeRequest(other, nonce, origin), false);
  }
  assert.equal(bridge.validSpinOffBridgeRequest(origin, 'short', origin), false);
  assert.equal(bridge.validSpinOffBridgeRequest('http://localhost:8000', nonce, origin), false);
});
test('pending login bridge retained for 10 minutes and expires', () => {
  const s=storage();
  assert.equal(bridge.rememberSpinOffBridge(s, {origin, state:nonce, dashboardOrigin:origin}, 1000), true);
  assert.deepEqual(bridge.readSpinOffBridge(s, origin, 2000), {origin,state:nonce,at:1000});
  assert.equal(bridge.readSpinOffBridge(s, origin, 601001), null);
});
test('after successful login return only to fixed bridge without tokens in URL', async () => {
  const s=storage();
  const l={origin,href:origin+'/dashboard_system/',replace(url){this.destination=url}};
  bridge.rememberSpinOffBridge(s, {origin,state:nonce,dashboardOrigin:origin});
  assert.equal(await bridge.resumeSpinOffBridge({client:{auth:{getUser:async()=>({data:{user:{id:'one'}}})}},location:l,storage:s}),true);
  const url=new URL(l.destination);
  assert.equal(url.pathname,'/dashboard_system/spin-off-bridge.html');
  assert.equal(url.searchParams.get('origin'),origin);
  assert.equal(url.searchParams.get('state'),nonce);
  assert.equal(url.searchParams.size,2);
});
test('bridge only postMessages access token to exact origin, no refresh tokens', () => {
  const page=readFileSync(new URL('../frontend/src/spin-off-bridge-page.js',import.meta.url),'utf8');
  assert.match(page,/window\.opener\.postMessage\(/);
  assert.match(page,/request\.origin\)/);
  assert.doesNotMatch(page,/refresh_token/);
  assert.match(page,/row\?\.is_active !== true/);
  const sw=readFileSync(new URL('../frontend/sw.js',import.meta.url),'utf8');
  assert.match(sw,/spin-off-bridge\.html/);
});
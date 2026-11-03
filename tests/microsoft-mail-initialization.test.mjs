import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('simultaneous invoice resume and another module share a fully initialized MSAL client',async()=>{
  const source=(await readFile(new URL('../frontend/src/microsoft/graph-mail.js',import.meta.url),'utf8'))
    .replace(/^import .*;\n/gm,'').replace(/export /g,'').replace(/import\.meta\.env/g,'undefined');
  let initialized=false,initializations=0;
  class Client {
    async initialize(){initializations++;await new Promise(r=>setTimeout(r,5));initialized=true;}
    async handleRedirectPromise(){assert.equal(initialized,true);}
    getAllAccounts(){assert.equal(initialized,true);return[{username:'toni@think.org.il'}];}
    async acquireTokenSilent(request){assert.deepEqual(request.scopes,['Mail.ReadWrite']);return{accessToken:'delegated'};}
  }
  const previous=globalThis.__DASHBOARD_CONFIG__;
  globalThis.__DASHBOARD_CONFIG__={microsoftClientId:'client',microsoftTenantId:'tenant'};
  try {
    const fn=new Function('PublicClientApplication','InteractionRequiredAuthError',source+'\nreturn delegatedMailToken;')(Client,Error);
    assert.deepEqual(await Promise.all([fn('toni@think.org.il',{interactive:false}),fn('toni@think.org.il',{interactive:false})]),['delegated','delegated']);
    assert.equal(initializations,1);
  } finally { if(previous===undefined)delete globalThis.__DASHBOARD_CONFIG__;else globalThis.__DASHBOARD_CONFIG__=previous; }
});

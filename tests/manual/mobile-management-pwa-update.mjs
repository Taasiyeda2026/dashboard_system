// Manual only: tests the real entry shim and worker in a temporary localhost origin.
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const implementation=await readFile('frontend/sw.js','utf8');
const shim=await readFile('sw.js','utf8');
const version=Number(/const CACHE_VERSION = (\d+)/.exec(implementation)[1]);
let phase=version-1;
const server=http.createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 res.setHeader('cache-control','no-store');
 if(path==='/sw.js'){res.setHeader('content-type','text/javascript');res.end(shim);return;}
 if(path==='/frontend/sw.js'){res.setHeader('content-type','text/javascript');res.end(implementation.replace(/const CACHE_VERSION = \d+/,`const CACHE_VERSION = ${phase}`));return;}
 if(path==='/frontend/src/mobile-responsive.js'){res.setHeader('content-type','text/javascript');res.end(`// local static asset ${phase}`);return;}
 if(path==='/api/source'){res.setHeader('content-type','application/json');res.end(JSON.stringify({phase}));return;}
 res.setHeader('content-type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local PWA acceptance</title>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true});await page.goto(origin);
 await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});
 await page.reload();
 await page.evaluate(async()=>{await fetch('/frontend/src/mobile-responsive.js');await fetch('/api/source');});
 assert.ok((await page.evaluate(()=>caches.keys())).includes('dashboard-static-v'+phase));
 phase=version;
 await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
 await page.waitForFunction(v=>caches.keys().then(keys=>keys.includes('dashboard-static-v'+v)&&!keys.includes('dashboard-static-v'+(v-1))),version);
 const text=await page.evaluate(()=>fetch('/frontend/src/mobile-responsive.js').then(r=>r.text()));assert.ok(text.includes(String(version)));
 const urls=await page.evaluate(async()=>{const result=[];for(const key of await caches.keys())for(const request of await (await caches.open(key)).keys())result.push(new URL(request.url).pathname);return result;});
 assert.ok(!urls.includes('/api/source'));
 const result={oldVersion:version-1,newVersion:version,oldCacheRemoved:true,currentAssetLoaded:true,apiNotCached:true};
 await mkdir('work',{recursive:true});await writeFile('work/mobile-pwa-update-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

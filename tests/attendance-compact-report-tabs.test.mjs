import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('report tabs stay compact and centered on wide screens',async()=>{
 const css=await readFile(new URL('../attendance/src/styles/new-report-screen.css',import.meta.url),'utf8');
 const block=css.slice(css.lastIndexOf('/* Compact report-type navigation'));
 assert.match(block,/\.av2-report__tabs\s*\{[^}]*max-width:\s*420px/);
 assert.match(block,/margin:\s*10px auto 18px/);
 assert.match(block,/\.av2-report__tabs \.av2-btn\.av2-report__tab--active/);
});

test('tab buttons remain large enough to tap on mobile without becoming page-wide',async()=>{
 const css=await readFile(new URL('../attendance/src/styles/new-report-screen.css',import.meta.url),'utf8');
 const block=css.slice(css.lastIndexOf('/* Compact report-type navigation'));
 assert.match(block,/@media \(max-width: 639px\)/);
 assert.match(block,/min-height:\s*44px !important/);
 assert.match(block,/width:\s*min\(100%, 420px\)/);
});

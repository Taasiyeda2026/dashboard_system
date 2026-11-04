import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('new report is two equal centered cards, without a phantom expenses card',async()=>{
 const runtime=await readFile(new URL('../attendance/src/new-report-three-column-layout.js',import.meta.url),'utf8');
 assert.ok(runtime.includes("form.classList.add('av2-report__form--two-sections')"));
 assert.ok(runtime.includes("grid-template-columns: repeat(2, minmax(0, 330px)) !important"));
 assert.ok(runtime.includes('margin-inline: auto !important'));
});
test('tab navigation and save/cancel pair are centered, section headings slightly larger',async()=>{
 const css=await readFile(new URL('../attendance/src/styles/new-report-screen.css',import.meta.url),'utf8');
 const start=css.indexOf('/* Clean New Report presentation');
 const block=css.slice(start);
 assert.ok(start>=0);
 assert.match(block,/\.av2-report__tabs\s*\{[^}]*align-self:center/);
 assert.match(block,/\.av2-report__actions\s*\{[^}]*justify-content:center!important/);
 assert.match(block,/\.av2-form-section__title\s*\{[^}]*font-size:1\.02rem!important/);
 assert.match(block,/@media \(max-width:767px\)/);
});
test('travel shortcut is a small icon-text secondary link and hidden travel row never paints',async()=>{
 const src=await readFile(new URL('../attendance/src/screens/new-report-screen.js',import.meta.url),'utf8');
 const css=await readFile(new URL('../attendance/src/styles/new-report-screen.css',import.meta.url),'utf8');
 assert.ok(src.includes("const travelIcon = createIcon('map-pin')"));
 assert.ok(src.includes("travelText.textContent='מילוי נסיעות'"));
 assert.ok(src.includes("hoursFollowup.append(travelShortcut)"));
 assert.ok(css.includes('.av2-report__base-training-route[hidden]'));
 assert.ok(css.includes('.av2-report__time-cancellation[hidden]'));
 assert.ok(css.includes('display:none!important'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('attendance notes remain after hours; travel entry belongs solely to separate tab',async()=>{
 const src=await readFile(new URL('../attendance/src/screens/new-report-screen.js',import.meta.url),'utf8');
 assert.match(src,/timesGrid\.append\(startPicker\.wrap, endPicker\.wrap, hoursDisplay, hoursFollowup\)/);
 assert.match(src,/hoursFollowup\.append\(notesField\.wrap\)/);
 assert.doesNotMatch(src,/hoursFollowup\.append\(travelShortcut\)/);
 assert.doesNotMatch(src,/travelShortcut\.addEventListener/);
 assert.doesNotMatch(src,/timesGrid\.append\(baseTrainingRouteRow\)/);
});

test('attendance notes match the compact three-tab design',async()=>{
 const css=await readFile(new URL('../attendance/src/styles/new-report-final-alignment.css',import.meta.url),'utf8');
 assert.match(css,/\.av2-report \.av2-report__hours-followup\{[\s\S]*?grid-column:1\/-1!important/);
 assert.match(css,/\.av2-report \.av2-report__form>\.av2-report__actions>\.av2-btn\{[\s\S]*?width:110px/);
});

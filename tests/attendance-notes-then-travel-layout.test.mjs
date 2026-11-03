import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('notes appear after work-hours total and travel shortcut directly after notes',async()=>{
  const file=await readFile(new URL('../attendance/src/screens/new-report-screen.js',import.meta.url),'utf8');
  const grid=file.indexOf('timesGrid.append(startPicker.wrap, endPicker.wrap, hoursDisplay, hoursFollowup');
  const notes=file.indexOf('hoursFollowup.append(notesField.wrap)');
  const shortcut=file.indexOf('hoursFollowup.append(travelShortcut)');
  assert.ok(grid>=0 && notes>grid && shortcut>notes);
  assert.ok(file.includes('const hoursFollowup = document.createElement'));
  assert.ok(!file.includes('dateField.wrap.append(travelShortcut)'));
  assert.ok(!file.includes('attachmentUi.section, notesField.wrap'));
});

test('notes and shortcut stack consistently on mobile and desktop',async()=>{
  const css=await readFile(new URL('../attendance/src/styles/new-report-screen.css',import.meta.url),'utf8');
  assert.match(css,/\.av2-report__hours-followup\s*\{\s*grid-column:\s*1 \/ -1/);
  assert.match(css,/\.av2-report__hours-followup \.av2-report__tiny-travel-btn\s*\{/);
});

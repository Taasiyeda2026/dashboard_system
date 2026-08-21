import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../frontend/src/manager-board-management-docs-link.js', import.meta.url), 'utf8');
const bootstrap = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');

test('manager board exposes the shared management documents folder beside management tab', () => {
  assert.match(source, /data-manager-workspace-tab=\\"management\\"/);
  assert.match(source, /data\.managerManagementDocs/);
  assert.match(source, /מסמכי ניהול/);
  assert.match(source, /sites\/taasiyeda2027\/Shared%20Documents\/Forms\/view\.aspx/);
  assert.match(source, /%D7%A0%D7%99%D7%94%D7%95%D7%9C/);
  assert.match(source, /target = '_blank'/);
  assert.match(source, /rel = 'noopener noreferrer'/);
  assert.match(source, /background:#ffad00/);
});

test('management documents shortcut runtime is loaded by the application bootstrap', () => {
  assert.match(bootstrap, /manager-board-management-docs-link\.js\?v=20260821-v1/);
});

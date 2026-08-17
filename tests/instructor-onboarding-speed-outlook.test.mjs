import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('onboarding finishes with an explicit Outlook web action', async () => {
  const client = await readFile(new URL('../frontend/src/screens/instructor-onboarding.js', import.meta.url), 'utf8');
  assert.match(client, /OUTLOOK_WEB_URL = 'https:\/\/outlook\.office\.com\/mail\/'/);
  assert.match(client, /data\.onboardingOutlook/);
  assert.match(client, /outlook\.textContent = 'OUTLOOK'/);
  assert.match(client, /המדריך נקלט בהצלחה\. המייל מוכן ומחכה לך בתיקיית הטיוטות ב-Outlook\./);
  assert.match(client, /const manualOutlook = typeof openMailClient !== 'function'/);
  assert.match(client, /if \(manualOutlook\)[\s\S]+outlook\.hidden = false/);
  assert.match(client, /window\.open\?\.\(OUTLOOK_WEB_URL, '_blank', 'noopener,noreferrer'\)/);
  assert.doesNotMatch(client, /about:blank/);
});

test('onboarding draft no longer waits for SharePoint employee-folder provisioning', async () => {
  const client = await readFile(new URL('../frontend/src/screens/instructor-onboarding.js', import.meta.url), 'utf8');
  const clickFlow = client.slice(client.indexOf("prepare.addEventListener('click'"));
  assert.match(clickFlow, /employeeFolderPromise = Promise\.resolve\(\)[\s\S]*ensureEmployeeFolder\(folderTarget\)/);
  assert.doesNotMatch(clickFlow, /employeeFolder\s*=\s*await ensureEmployeeFolder/);
  assert.ok(clickFlow.indexOf('employeeFolderPromise = Promise.resolve()') < clickFlow.indexOf('const result = await createDraft'));
});

test('draft dependencies run in parallel and onboarding documents are warmed and cached', async () => {
  const [client, filesEdge, folderEdge] = await Promise.all([
    readFile(new URL('../frontend/src/screens/instructor-onboarding.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/instructor-onboarding-files/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/instructor-onboarding-folder/index.ts', import.meta.url), 'utf8')
  ]);
  assert.match(client, /const onboardingAttachmentRequests = new Map\(\)/);
  assert.match(client, /warmOnboardingAttachments\(employment\.value\)/);
  assert.match(client, /Promise\.all\(\[filesPromise, tokenPromise\]\)/);
  assert.match(client, /Promise\.allSettled\(data\.attachments\.map/);
  assert.match(filesEdge, /Promise\.all\(files\.map/);
  assert.match(folderEdge, /Promise\.all\(levelPaths\.map/);
});

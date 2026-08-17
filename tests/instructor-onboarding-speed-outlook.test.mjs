import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('onboarding finishes with an explicit Outlook action and defaults to web', async () => {
  const client = await readFile(new URL('../frontend/src/screens/instructor-onboarding.js', import.meta.url), 'utf8');
  assert.match(client, /OUTLOOK_WEB_URL = 'https:\/\/outlook\.office\.com\/mail\/'/);
  assert.match(client, /OUTLOOK_DESKTOP_PROTOCOL = 'taasiyeda-outlook:'/);
  assert.match(client, /OUTLOOK_MODE_STORAGE_KEY = 'taasiyeda:outlook-mode'/);
  assert.match(client, /data\.onboardingOutlook/);
  assert.match(client, /outlook\.textContent = 'OUTLOOK'/);
  assert.match(client, /המדריך נקלט בהצלחה\. המייל מוכן ומחכה לך בתיקיית הטיוטות ב-Outlook\./);
  assert.match(client, /const manualOutlook = typeof openMailClient !== 'function'/);
  assert.match(client, /if \(manualOutlook\)[\s\S]+outlook\.hidden = false/);
  assert.match(client, /if \(localOutlookMode\(\) === 'desktop'\)[\s\S]+window\.location\.href = OUTLOOK_DESKTOP_PROTOCOL/);
  assert.match(client, /window\.open\?\.\(OUTLOOK_WEB_URL, '_blank', 'noopener,noreferrer'\)/);
});

test('draft and SharePoint work use parallel independent requests', async () => {
  const [client, filesEdge, folderEdge] = await Promise.all([
    readFile(new URL('../frontend/src/screens/instructor-onboarding.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/instructor-onboarding-files/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/instructor-onboarding-folder/index.ts', import.meta.url), 'utf8')
  ]);
  assert.match(client, /Promise\.all\(\[filesPromise, tokenPromise\]\)/);
  assert.match(client, /Promise\.allSettled\(data\.attachments\.map/);
  assert.match(filesEdge, /Promise\.all\(files\.map/);
  assert.match(folderEdge, /Promise\.all\(levelPaths\.map/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../supabase/functions/instructor-onboarding-files/index.ts', import.meta.url), 'utf8');

test('instructor onboarding edge function uses Supabase SDK CORS headers', () => {
  assert.match(source, /import\s+\{\s*corsHeaders\s*\}\s+from\s+["']npm:@supabase\/supabase-js@\^2\/cors["']/);
  assert.match(source, /req\.method\s*===\s*["']OPTIONS["'][\s\S]*headers:\s*corsHeaders/);
  assert.doesNotMatch(source, /Access-Control-Allow-Headers["']?:\s*["']authorization, x-client-info, apikey, content-type["']/);
});

test('instructor onboarding edge function returns attachment count with SharePoint payload', () => {
  assert.match(source, /attachment_count:\s*attachments\.length/);
  assert.match(source, /source:\s*["']sharepoint["']/);
});

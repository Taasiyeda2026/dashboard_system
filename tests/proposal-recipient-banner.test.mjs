import test from 'node:test';
import assert from 'node:assert/strict';
import { clientLockedBannerHtml } from '../frontend/src/screens/proposals-agreements.js';

test('school recipient remains a school when its name equals the authority name', () => {
  const html = clientLockedBannerHtml(
    'אבו גוש',
    'אבו גוש',
    'איש קשר',
    'מנהל',
    '0500000000',
    'school@example.invalid',
    'אבו גוש',
    { school_id: 2436, semel_mosad: '118018' },
    { clientType: 'school', schoolId: 2436 }
  );

  assert.match(html, /ds-pa-client-locked is-school/);
  assert.doesNotMatch(html, /is-authority/);
  assert.match(html, /סמל מוסד/);
  assert.match(html, /118018/);
  assert.doesNotMatch(html, /<span>רשות<\/span>/);
  assert.doesNotMatch(html, /<span>בית ספר<\/span>/);
});

test('authority and other recipients never render school or institution fields', () => {
  const authority = clientLockedBannerHtml('אבו גוש', '', '', '', '', '', 'אבו גוש', null, { clientType: 'authority' });
  const other = clientLockedBannerHtml('', '', '', '', '', '', 'חברה', null, { clientType: 'other' });

  assert.match(authority, /ds-pa-client-locked is-authority/);
  assert.match(other, /ds-pa-client-locked is-other/);
  assert.doesNotMatch(`${authority}${other}`, /סמל מוסד|<span>בית ספר<\/span>/);
});

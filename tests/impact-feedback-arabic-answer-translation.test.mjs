import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasArabicAnswerText, arabicAnswerTranslationUrl } from '../frontend/src/impact-feedback/feedback-translation.js';

const screen = readFileSync(new URL('../frontend/src/screens/impact-feedback.js', import.meta.url), 'utf8');
const answerRendererSource = screen.slice(screen.indexOf('function completeInstructorAnswerValueHtml('),
  screen.indexOf('/** Every question and its original reply', screen.indexOf('function completeInstructorAnswerValueHtml(')));
const esc = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const renderAnswer = new Function('esc', 'hasArabicAnswerText',
  answerRendererSource + '\nreturn completeInstructorAnswerValueHtml;')(esc, hasArabicAnswerText);

test('Arabic letters, including mixed Hebrew/Arabic, trigger translation; no Hebrew-only or numeric false positives', () => {
  assert.equal(hasArabicAnswerText('طريقة التدريب (كأننا طلاب)'), true);
  assert.equal(hasArabicAnswerText('ההכשרה מעולה — الشرح واضح'), true);
  assert.equal(hasArabicAnswerText('הכשרה פרונטלית בעברית'), false);
  assert.equal(hasArabicAnswerText('12345 - ٦٧٨'), false);
  assert.equal(hasArabicAnswerText(''), false);
  assert.equal(hasArabicAnswerText(null), false);
});

test('translate button appears only for submitted free-text answers containing Arabic', () => {
  const arabic = renderAnswer({ question_type: 'free_text', value_text: 'طريقة التدريب\nكل شيء واضح' });
  assert.match(arabic, /data-ifb-arabic-translate/);
  assert.match(arabic, /תרגם לעברית/);
  assert.match(arabic, /طريقة التدريب/);
  assert.match(arabic, /dir="auto"/);
  assert.doesNotMatch(renderAnswer({ question_type: 'free_text', value_text: 'הסבר מצוין' }), /data-ifb-arabic-translate/);
  assert.doesNotMatch(renderAnswer({ question_type: 'free_text', value_text: '' }), /data-ifb-arabic-translate/);
  assert.doesNotMatch(renderAnswer({ question_type: 'rating_1_5', value_number: 5 }), /data-ifb-arabic-translate/);
  assert.doesNotMatch(renderAnswer({ question_type: 'single_select', value_options: ['ar'], question_options: [
    { value: 'ar', label: 'اللغة العربية' }
  ] }), /data-ifb-arabic-translate/);
  assert.doesNotMatch(renderAnswer({ question_type: 'free_text', question_text: 'سؤال', value_text: 'תשובה בעברית' }),
    /data-ifb-arabic-translate/, 'question wording must not trigger translation of a Hebrew answer');
});

test('original answer is escaped and external translator only receives the clicked answer', () => {
  const source = 'كل شيء واضح <script>alert("x")</script> & לעברית';
  const rendered = renderAnswer({ question_type: 'free_text', value_text: source });
  assert.ok(rendered.includes('&lt;script&gt;') && !rendered.includes('<script>'));
  const url = new URL(arabicAnswerTranslationUrl(source));
  assert.equal(url.origin, 'https://translate.google.com');
  assert.equal(url.searchParams.get('sl'), 'ar');
  assert.equal(url.searchParams.get('tl'), 'iw');
  assert.equal(url.searchParams.get('text'), source);
  assert.equal(arabicAnswerTranslationUrl('אין כאן ערבית'), '');
  assert.match(screen, /const translateButton = t\.closest\('\[data-ifb-arabic-translate\]'\)/);
  assert.match(screen, /translateButton\.closest\('\.ifb-full-answer-reply'\)/);
  assert.match(screen, /window\.open\(url, '_blank', 'noopener,noreferrer'\)/);
  assert.doesNotMatch(answerRendererSource, /arabicAnswerTranslationUrl\(/,
    'external translation link must not be generated for every response on initial render');
});

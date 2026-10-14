/**
 * Raw feedback translation is opt-in. Never upload text, translate automatically,
 * or change stored answers. The external translation page opens only on click.
 */
const ARABIC_LETTERS = /[\u0621-\u064A\u066E-\u066F\u0671-\u06D3\u06D5\u06E5-\u06E6\u06EE-\u06EF\u06FA-\u06FC\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/u;

export function hasArabicAnswerText(value) {
  return ARABIC_LETTERS.test(String(value ?? ''));
}

export function arabicAnswerTranslationUrl(value) {
  const text = String(value ?? '').trim();
  if (!hasArabicAnswerText(text)) return '';
  return 'https://translate.google.com/?sl=ar&tl=iw&text=' +
    encodeURIComponent(text) + '&op=translate';
}

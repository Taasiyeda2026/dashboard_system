export function conciseSchedulingReason(value) {
  const reason = String(value ?? '').trim();
  if (!reason) return '';
  if (reason === 'ניתן לבחור ידנית') return reason;

  const homeDistanceMatch = reason.match(/(\d+(?:\.\d+)?)\s*ק[״"]?מ/);
  if (/מרחק הנסיעה לבית הספר|מרחק מהבית|מגבלה של\s*40\s*ק[״"]?מ/.test(reason) && homeDistanceMatch) {
    return `מרחק מהבית ${Math.round(Number(homeDistanceMatch[1]))} ק״מ`;
  }
  if (/זמינות|לא זמין|אינו זמין|מכסה את שעות/.test(reason)) return 'לא זמין בשעות הקורס';
  if (/חסרים נתוני התאמה/.test(reason)) return 'חסרים נתוני התאמה';
  if (/שפ(?:ת|ה)|עברית|ערבית/.test(reason)) return 'שפה לא מתאימה';
  if (/מגדר|דורש מדריכ|דרישת.*מדריכ/.test(reason)) return 'לא מתאים לדרישת המגדר';
  if (/חפיפה/.test(reason)) return 'חפיפה עם פעילות אחרת';
  if (/אין זמן מעבר מספיק|זמן מעבר.*(?:אינו|לא).*מספיק/.test(reason)) return 'אין מספיק זמן מעבר בין הפעילויות';

  return reason
    .replace(/\s*-\s*משפיע על (?:מפגש אחד|\d+ מפגשים).*$/, '')
    .replace(/(\d{2}:\d{2}):\d{2}/g, '$1')
    .trim();
}

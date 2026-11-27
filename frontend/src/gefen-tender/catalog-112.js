/**
 * Central basket-112 question catalog metadata.
 * Labels/wording stay owned by stored questions (STEM.docx / submission template);
 * this module supplies verified answer shapes, limits from תבנית הגשה.xlsx,
 * attachments and thresholds. Never invents limits absent from sources.
 */

import { enrichQuestion112, mergeQuestionsPreservingAnswers } from './questionnaire-112.js';
import { THRESHOLDS_112, CRITERIA_112 } from './thresholds-112.js';

const STEM_SOURCE =
  'https://think365orgil.sharepoint.com/sites/taasiyeda2027/_layouts/15/Doc.aspx?sourcedoc=%7B93CC8521-CFD1-443D-B35A-C474A35551CC%7D&file=%D7%A9%D7%90%D7%9C%D7%95%D7%AA%20STEM.docx&action=default&mobileredirect=true';

const TEMPLATE_SOURCE =
  'https://think365orgil.sharepoint.com/sites/taasiyeda2027/_layouts/15/Doc.aspx?sourcedoc=%7BE2FA4007-C220-46B0-9FE8-37451C750845%7D';

const YES_NO = ['כן', 'לא'];
const OUTDOOR = ['לא', 'סיור בטבע', 'סיור במוזיאון', 'אחר'];

/** Character limits from תבנית הגשה.xlsx (verified in production). */
export const CHAR_LIMITS_112 = {
  2: 250, 3: 250, 4: 250, 5: 250, 6: 250,
  7: 1000, 8: 1000, 9: 1000, 10: 100, 11: 1000,
  13: 1000, 14: 1000, 16: 500,
  17: 1000, 18: 1000, 19: 1000, 20: 500, 21: 700,
  22: 1000, 23: 1000, 24: 500, 25: 500, 26: 1000, 28: 1000, 29: 500,
  31: 500, 33: 500, 36: 500, 37: 500, 38: 500, 39: 500, 40: 1000, 41: 500
};

/** Questions where the character limit applies to complementary text, not the choice. */
export const EXTRA_TEXT_LIMIT_QUESTIONS = new Set([
  2, 3, 4, 5, 7, 10, 31, 33, 36, 37, 38, 39, 40, 41
]);

function lim(n) {
  return CHAR_LIMITS_112[n] ?? null;
}

function withExtra(n, overlay) {
  const limit = lim(n);
  return {
    ...overlay,
    extra_text: true,
    limit,
    limit_applies_to: 'extra',
    source: overlay.source || TEMPLATE_SOURCE
  };
}

/**
 * Per-question overlays keyed by id.
 * Only fields that appear in STEM labels/requirements, תבנית הגשה.xlsx,
 * existing DB attachments, historical choice strings, or the thresholds registry.
 */
export const CATALOG_112_OVERLAYS = {
  '112.1': {
    answer_type: 'single_choice',
    choices: ['חדשנות פדגוגית ארגונית', 'יזמות פדגוגית ארגונית', 'יזמות טכנולוגית'],
    requirements: 'בחירת אפיק',
    threshold_conditions: 'בחירת אפיק מדויק לתת־הסל',
    mapping_note: 'אפשרויות מתוך השאלה המאוחסנת / STEM'
  },
  '112.2': withExtra(2, {
    answer_type: 'yes_no_text', choices: YES_NO,
    requirements: 'כן/לא + טקסט נוסף',
    threshold_conditions: 'הלימה ליעדי המשרד'
  }),
  '112.3': withExtra(3, {
    answer_type: 'yes_no_text', choices: YES_NO,
    requirements: 'כן/לא + טקסט נוסף',
    threshold_conditions: 'הנגשה על פי החוק'
  }),
  '112.4': withExtra(4, {
    answer_type: 'yes_no_text', choices: YES_NO,
    requirements: 'כן/לא + טקסט נוסף',
    threshold_conditions: 'תקני בטיחות'
  }),
  '112.5': withExtra(5, {
    answer_type: 'yes_no_text', choices: YES_NO,
    requirements: 'כן/לא + טקסט נוסף',
    threshold_conditions: 'איסור פרסום מסחרי'
  }),
  '112.6': {
    answer_type: 'text', limit: lim(6),
    requirements: 'מענה וקובץ',
    attachments: 'קובץ תומך – חובה לפי דרישת מענה וקובץ',
    professional_criteria: 'מידת ההתאמה והרלוונטיות לתת הסל',
    source: TEMPLATE_SOURCE
  },
  '112.7': withExtra(7, {
    answer_type: 'yes_no_text', choices: YES_NO,
    requirements: 'כן/לא + פירוט'
  }),
  '112.8': {
    answer_type: 'text', limit: lim(8),
    requirements: 'חובת צירוף קובץ',
    attachments: 'אישור/תיעוד כלי דיגיטלי מאושר במשרד החינוך',
    threshold_conditions: 'תוכן/כלים דיגיטליים מאושרים במשרד החינוך',
    source: TEMPLATE_SOURCE
  },
  '112.9': {
    answer_type: 'text', limit: lim(9),
    requirements: 'מענה וקובץ',
    attachments: 'קובץ תומך – לפי דרישת מענה וקובץ',
    source: TEMPLATE_SOURCE
  },
  '112.10': withExtra(10, {
    answer_type: 'yes_no_text', choices: YES_NO,
    requirements: 'כן/לא + טקסט נוסף'
  }),
  '112.11': {
    answer_type: 'text', limit: lim(11),
    requirements: 'קובץ – רשות',
    attachments: 'מסמכים נוספים – רשות',
    required: false,
    source: TEMPLATE_SOURCE
  },
  '112.12': {
    answer_type: 'single_choice', choices: YES_NO,
    requirements: 'אישור'
  },
  '112.13': { answer_type: 'text', limit: lim(13), requirements: 'טקסט', source: TEMPLATE_SOURCE },
  '112.14': { answer_type: 'text', limit: lim(14), requirements: 'טקסט', source: TEMPLATE_SOURCE },
  '112.15': { answer_type: 'number', requirements: 'מספר מפגשים' },
  '112.16': {
    answer_type: 'text', limit: lim(16),
    requirements: 'חובת צירוף סילבוס',
    attachments: '174',
    threshold_conditions: 'סילבוס רשמי (טופס 174) לפי שלבי גיל',
    source: TEMPLATE_SOURCE
  },
  '112.17': { answer_type: 'text', limit: lim(17), requirements: 'שני פרטי ידע', source: TEMPLATE_SOURCE },
  '112.18': { answer_type: 'text', limit: lim(18), requirements: 'שני ערכים', source: TEMPLATE_SOURCE },
  '112.19': { answer_type: 'text', limit: lim(19), requirements: 'שתי מיומנויות', source: TEMPLATE_SOURCE },
  '112.20': {
    answer_type: 'text', limit: lim(20), limit_words: 70,
    requirements: 'עד 70 מילים ו־5 מקורות מוסמכים',
    professional_criteria: 'רקע תיאורטי ואמפירי (עד 70 מילים, 5 מקורות)',
    mapping_note: 'מגבלת מילים מ־STEM; מגבלת תווים מ־תבנית הגשה.xlsx',
    source: TEMPLATE_SOURCE
  },
  '112.21': {
    answer_type: 'text', limit: lim(21),
    requirements: 'מענה וקובץ',
    attachments: 'קובץ מדדי הערכה',
    professional_criteria: 'מדדי הערכה ומדד תוצאה',
    source: TEMPLATE_SOURCE
  },
  '112.22': {
    answer_type: 'text', limit: lim(22),
    requirements: 'טקסט',
    professional_criteria: 'מדדי הערכה ומדד תוצאה',
    source: TEMPLATE_SOURCE
  },
  '112.23': {
    answer_type: 'text', limit: lim(23),
    requirements: 'טקסט – רשות',
    required: false,
    source: TEMPLATE_SOURCE
  },
  '112.24': {
    answer_type: 'text', limit: lim(24),
    requirements: 'חובת קובץ וקורות חיים',
    attachments: '159 וקורות חיים',
    threshold_conditions: 'ניסיון מפתחים + קורות חיים (טופס 159)',
    source: TEMPLATE_SOURCE
  },
  '112.25': {
    answer_type: 'text', limit: lim(25),
    requirements: 'חובת קובץ וקורות חיים',
    attachments: '160 וקורות חיים',
    threshold_conditions: 'ניסיון מפעילים + קורות חיים (טופס 160)',
    source: TEMPLATE_SOURCE
  },
  '112.26': { answer_type: 'text', limit: lim(26), requirements: 'טקסט', source: TEMPLATE_SOURCE },
  '112.27': { answer_type: 'number', requirements: 'מספר שנים' },
  '112.28': {
    answer_type: 'text', limit: lim(28),
    requirements: 'פירוט וקובץ',
    attachments: 'פירוט מוסדות / אנשי קשר',
    source: TEMPLATE_SOURCE
  },
  '112.29': {
    answer_type: 'text', limit: lim(29),
    requirements: 'חובת צירוף המלצות',
    attachments: '3 המלצות חתומות',
    threshold_conditions: '3 המלצות מארגונים שונים מ־4 השנים האחרונות',
    source: TEMPLATE_SOURCE
  },
  '112.30': {
    answer_type: 'single_choice', choices: YES_NO,
    requirements: 'בחירה',
    mapping_note: 'בחירה כן/לא לפי ניסוח «סמן את האפשרות»'
  },
  '112.31': withExtra(31, {
    answer_type: 'yes_no_text', choices: OUTDOOR,
    requirements: 'בחירה + טקסט משלים',
    mapping_note: 'אפשרויות מתוך תשובות היסטוריות (לא / סיור בטבע / סיור במוזיאון / אחר)'
  }),
  '112.32': { answer_type: 'single_choice', choices: YES_NO, requirements: 'בחירה' },
  '112.33': withExtra(33, {
    answer_type: 'yes_no_text', choices: YES_NO,
    requirements: 'כן/לא + טקסט משלים'
  }),
  '112.34': { answer_type: 'single_choice', choices: YES_NO, requirements: 'בחירה' },
  '112.35': { answer_type: 'single_choice', choices: YES_NO, requirements: 'בחירה' },
  '112.36': withExtra(36, {
    answer_type: 'yes_no_text', choices: YES_NO,
    requirements: 'כן/לא + טקסט משלים'
  }),
  '112.37': withExtra(37, {
    answer_type: 'yes_no_text', choices: YES_NO,
    requirements: 'כן/לא + טקסט משלים'
  }),
  '112.38': withExtra(38, {
    answer_type: 'yes_no_text', choices: YES_NO,
    requirements: 'כן/לא + פירוט מיקום אם כן',
    mapping_note: '«אם כן, פרט היכן» מתוך נוסח השאלה'
  }),
  '112.39': withExtra(39, {
    answer_type: 'yes_no_text', choices: YES_NO,
    requirements: 'כן/לא + טקסט משלים'
  }),
  '112.40': withExtra(40, {
    answer_type: 'yes_no_text', choices: YES_NO,
    requirements: 'כן/לא + פירוט רישיון אם כן',
    mapping_note: 'שדה משלים לפי «אם כן, איזה?»'
  }),
  '112.41': withExtra(41, {
    answer_type: 'yes_no_text', choices: YES_NO,
    requirements: 'כן/לא + טקסט משלים'
  })
};

function prefer(a, b) {
  return a !== undefined && a !== null && a !== '' ? a : b;
}

/** Apply overlays onto stored questions; preserve answers/labels; never wipe stored limits with null. */
export function applyCatalog112(existingQuestions = []) {
  const withOverlay = (existingQuestions || []).map((q) => {
    const id = String(q.id || `112.${q.number}`);
    const overlay = CATALOG_112_OVERLAYS[id] || {};
    const number = Number(q.number || String(id).split('.')[1] || 0);
    const merged = {
      ...q,
      ...overlay,
      id,
      number: number || q.number,
      label: q.label, // never invent / replace wording
      source: prefer(q.source, overlay.source) || STEM_SOURCE,
      limit: prefer(overlay.limit, prefer(q.limit, q.character_limit)),
      limit_words: prefer(overlay.limit_words, q.limit_words),
      limit_applies_to: prefer(
        overlay.limit_applies_to,
        EXTRA_TEXT_LIMIT_QUESTIONS.has(number) ? 'extra' : (q.limit_applies_to || 'answer')
      ),
      extra_text: overlay.extra_text === true || q.extra_text === true || EXTRA_TEXT_LIMIT_QUESTIONS.has(number),
      answer_type: prefer(overlay.answer_type, q.answer_type),
      choices: prefer(overlay.choices, q.choices),
      mapping_verified: q.mapping_verified === true ? true : false,
      catalog_applied_at: new Date().toISOString()
    };
    return enrichQuestion112(merged);
  });
  return mergeQuestionsPreservingAnswers(withOverlay, existingQuestions);
}

export function catalog112Meta() {
  return {
    basket: 112,
    source: STEM_SOURCE,
    template_source: TEMPLATE_SOURCE,
    overlays: Object.keys(CATALOG_112_OVERLAYS).length,
    thresholds: THRESHOLDS_112.length,
    criteria: CRITERIA_112.length,
    character_limits_status: 'מ־תבנית הגשה.xlsx — 33 שאלות עם מגבלת תווים; 8 ללא מגבלה במקור',
    word_limits_verified: ['112.20'],
    extra_text_limit_questions: [...EXTRA_TEXT_LIMIT_QUESTIONS]
  };
}

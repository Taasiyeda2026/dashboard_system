/**
 * Central basket-112 question catalog metadata.
 * Labels/wording stay owned by stored questions (STEM.docx); this module supplies
 * verified answer shapes, limits found in sources, attachments and thresholds.
 * Never invents character limits that are absent from tender documents.
 */

import { enrichQuestion112, mergeQuestionsPreservingAnswers } from './questionnaire-112.js';
import { THRESHOLDS_112, CRITERIA_112 } from './thresholds-112.js';

const STEM_SOURCE =
  'https://think365orgil.sharepoint.com/sites/taasiyeda2027/_layouts/15/Doc.aspx?sourcedoc=%7B93CC8521-CFD1-443D-B35A-C474A35551CC%7D&file=%D7%A9%D7%90%D7%9C%D7%95%D7%AA%20STEM.docx&action=default&mobileredirect=true';

const YES_NO = ['כן', 'לא'];
const OUTDOOR = ['לא', 'סיור בטבע', 'סיור במוזיאון', 'אחר'];

/**
 * Per-question overlays keyed by id.
 * Only fields that appear in STEM labels/requirements, existing DB attachments,
 * historical choice strings from prior tenders, or the thresholds registry.
 */
export const CATALOG_112_OVERLAYS = {
  '112.1': {
    answer_type: 'single_choice',
    choices: ['חדשנות פדגוגית ארגונית', 'יזמות פדגוגית ארגונית', 'יזמות טכנולוגית'],
    requirements: 'בחירת אפיק',
    threshold_conditions: 'בחירת אפיק מדויק לתת־הסל',
    mapping_note: 'אפשרויות מתוך השאלה המאוחסנת / STEM'
  },
  '112.2': {
    answer_type: 'yes_no_text', choices: YES_NO, extra_text: true,
    requirements: 'כן/לא + טקסט נוסף',
    threshold_conditions: 'הלימה ליעדי המשרד'
  },
  '112.3': {
    answer_type: 'yes_no_text', choices: YES_NO, extra_text: true,
    requirements: 'כן/לא + טקסט נוסף',
    threshold_conditions: 'הנגשה על פי החוק'
  },
  '112.4': {
    answer_type: 'yes_no_text', choices: YES_NO, extra_text: true,
    requirements: 'כן/לא + טקסט נוסף',
    threshold_conditions: 'תקני בטיחות'
  },
  '112.5': {
    answer_type: 'yes_no_text', choices: YES_NO, extra_text: true,
    requirements: 'כן/לא + טקסט נוסף',
    threshold_conditions: 'איסור פרסום מסחרי'
  },
  '112.6': {
    answer_type: 'text',
    requirements: 'מענה וקובץ',
    attachments: 'קובץ תומך – חובה לפי דרישת מענה וקובץ',
    professional_criteria: 'מידת ההתאמה והרלוונטיות לתת הסל'
  },
  '112.7': {
    answer_type: 'yes_no_text', choices: YES_NO, extra_text: true,
    requirements: 'כן/לא + פירוט'
  },
  '112.8': {
    answer_type: 'text',
    requirements: 'חובת צירוף קובץ',
    attachments: 'אישור/תיעוד כלי דיגיטלי מאושר במשרד החינוך',
    threshold_conditions: 'תוכן/כלים דיגיטליים מאושרים במשרד החינוך'
  },
  '112.9': {
    answer_type: 'text',
    requirements: 'מענה וקובץ',
    attachments: 'קובץ תומך – לפי דרישת מענה וקובץ'
  },
  '112.10': {
    answer_type: 'yes_no_text', choices: YES_NO, extra_text: true,
    requirements: 'כן/לא + טקסט נוסף'
  },
  '112.11': {
    answer_type: 'text',
    requirements: 'קובץ – רשות',
    attachments: 'מסמכים נוספים – רשות',
    required: false
  },
  '112.12': {
    answer_type: 'single_choice', choices: YES_NO,
    requirements: 'אישור'
  },
  '112.13': { answer_type: 'text', requirements: 'טקסט' },
  '112.14': { answer_type: 'text', requirements: 'טקסט' },
  '112.15': { answer_type: 'number', requirements: 'מספר מפגשים' },
  '112.16': {
    answer_type: 'text',
    requirements: 'חובת צירוף סילבוס',
    attachments: '174',
    threshold_conditions: 'סילבוס רשמי (טופס 174) לפי שלבי גיל'
  },
  '112.17': { answer_type: 'text', requirements: 'שני פרטי ידע' },
  '112.18': { answer_type: 'text', requirements: 'שני ערכים' },
  '112.19': { answer_type: 'text', requirements: 'שתי מיומנויות' },
  '112.20': {
    answer_type: 'text',
    requirements: 'עד 70 מילים ו־5 מקורות מוסמכים',
    limit_words: 70,
    professional_criteria: 'רקע תיאורטי ואמפירי (עד 70 מילים, 5 מקורות)',
    mapping_note: 'מגבלת מילים מתוך נוסח השאלה ב־STEM'
  },
  '112.21': {
    answer_type: 'text',
    requirements: 'מענה וקובץ',
    attachments: 'קובץ מדדי הערכה',
    professional_criteria: 'מדדי הערכה ומדד תוצאה'
  },
  '112.22': {
    answer_type: 'text',
    requirements: 'טקסט',
    professional_criteria: 'מדדי הערכה ומדד תוצאה'
  },
  '112.23': {
    answer_type: 'text',
    requirements: 'טקסט – רשות',
    required: false
  },
  '112.24': {
    answer_type: 'text',
    requirements: 'חובת קובץ וקורות חיים',
    attachments: '159 וקורות חיים',
    threshold_conditions: 'ניסיון מפתחים + קורות חיים (טופס 159)'
  },
  '112.25': {
    answer_type: 'text',
    requirements: 'חובת קובץ וקורות חיים',
    attachments: '160 וקורות חיים',
    threshold_conditions: 'ניסיון מפעילים + קורות חיים (טופס 160)'
  },
  '112.26': { answer_type: 'text', requirements: 'טקסט' },
  '112.27': { answer_type: 'number', requirements: 'מספר שנים' },
  '112.28': {
    answer_type: 'text',
    requirements: 'פירוט וקובץ',
    attachments: 'פירוט מוסדות / אנשי קשר'
  },
  '112.29': {
    answer_type: 'text',
    requirements: 'חובת צירוף המלצות',
    attachments: '3 המלצות חתומות',
    threshold_conditions: '3 המלצות מארגונים שונים מ־4 השנים האחרונות'
  },
  // Safety: choices from historical tender answers where available; כן/לא for
  // "סמן את האפשרות המתאימה" yes/no-style items. Character limits not in sources.
  '112.30': {
    answer_type: 'single_choice', choices: YES_NO,
    requirements: 'בחירה',
    mapping_note: 'בחירה כן/לא לפי ניסוח «סמן את האפשרות»; מגבלת תווים טרם אומתה במקור'
  },
  '112.31': {
    answer_type: 'single_choice', choices: OUTDOOR,
    requirements: 'בחירה',
    mapping_note: 'אפשרויות מתוך תשובות היסטוריות במאגר (לא / סיור בטבע / סיור במוזיאון / אחר)'
  },
  '112.32': { answer_type: 'single_choice', choices: YES_NO, requirements: 'בחירה' },
  '112.33': { answer_type: 'single_choice', choices: YES_NO, requirements: 'בחירה' },
  '112.34': { answer_type: 'single_choice', choices: YES_NO, requirements: 'בחירה' },
  '112.35': { answer_type: 'single_choice', choices: YES_NO, requirements: 'בחירה' },
  '112.36': { answer_type: 'single_choice', choices: YES_NO, requirements: 'בחירה' },
  '112.37': { answer_type: 'single_choice', choices: YES_NO, requirements: 'בחירה' },
  '112.38': {
    answer_type: 'yes_no_text', choices: YES_NO, extra_text: true,
    requirements: 'כן/לא + פירוט מיקום אם כן',
    mapping_note: '«אם כן, פרט היכן» מתוך נוסח השאלה'
  },
  '112.39': { answer_type: 'single_choice', choices: YES_NO, requirements: 'בחירה' },
  '112.40': {
    answer_type: 'yes_no_text', choices: YES_NO, extra_text: true,
    requirements: 'כן/לא + פירוט רישיון אם כן',
    mapping_note: 'אפשרויות כן/לא מתוך תשובות היסטוריות; שדה משלים לפי «אם כן, איזה?»'
  },
  '112.41': {
    answer_type: 'single_choice', choices: YES_NO,
    requirements: 'בחירה',
    mapping_note: 'אפשרויות כן/לא מתוך תשובות היסטוריות במאגר'
  }
};

/** Apply overlays onto stored questions; preserve answers; do not rewrite labels. */
export function applyCatalog112(existingQuestions = []) {
  const withOverlay = (existingQuestions || []).map((q) => {
    const id = String(q.id || `112.${q.number}`);
    const overlay = CATALOG_112_OVERLAYS[id] || {};
    const merged = {
      ...q,
      ...overlay,
      id,
      label: q.label, // never invent / replace wording
      source: q.source || STEM_SOURCE,
      // Character limits stay null unless overlay or stored value provides them
      limit: overlay.limit ?? q.limit ?? q.character_limit ?? null,
      limit_words: overlay.limit_words ?? q.limit_words ?? null,
      mapping_verified: overlay.mapping_verified === true
        ? true
        : Boolean(overlay.limit_words || overlay.choices || overlay.attachments || overlay.answer_type)
          ? false
          : q.mapping_verified === true,
      catalog_applied_at: new Date().toISOString()
    };
    // Word limit from label/requirements if still missing
    return enrichQuestion112(merged);
  });
  return mergeQuestionsPreservingAnswers(withOverlay, existingQuestions);
}

export function catalog112Meta() {
  return {
    basket: 112,
    source: STEM_SOURCE,
    overlays: Object.keys(CATALOG_112_OVERLAYS).length,
    thresholds: THRESHOLDS_112.length,
    criteria: CRITERIA_112.length,
    character_limits_status: 'לא הוזנו — לא נמצאו במקורות הנגישים; אין להמציא',
    word_limits_verified: ['112.20']
  };
}

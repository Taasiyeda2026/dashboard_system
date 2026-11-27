/** Structured threshold / criteria registry for basket 112 — status only, no pass/fail judgements. */

export const THRESHOLDS_112 = [
  {
    id: 'th-112-track',
    kind: 'threshold',
    title: 'בחירת אפיק מדויק לתת־הסל',
    related_questions: ['112.1'],
    status: 'טרם נבדק',
    source: 'שאלות STEM.docx / מסמכי תת־סל 112'
  },
  {
    id: 'th-112-law',
    kind: 'threshold',
    title: 'הלימה ליעדי המשרד, הנגשה, בטיחות ואיסור פרסום מסחרי',
    related_questions: ['112.2', '112.3', '112.4', '112.5'],
    status: 'טרם נבדק',
    source: 'שאלות STEM.docx'
  },
  {
    id: 'th-112-digital',
    kind: 'threshold',
    title: 'תוכן/כלים דיגיטליים מאושרים במשרד החינוך',
    related_questions: ['112.8'],
    status: 'טרם נבדק',
    source: 'שאלות STEM.docx'
  },
  {
    id: 'th-112-syllabus',
    kind: 'document',
    title: 'סילבוס רשמי (טופס 174) לפי שלבי גיל',
    related_questions: ['112.16'],
    status: 'טרם נבדק',
    source: 'טופס 174'
  },
  {
    id: 'th-112-developers',
    kind: 'document',
    title: 'ניסיון מפתחים + קורות חיים (טופס 159)',
    related_questions: ['112.24'],
    status: 'טרם נבדק',
    source: 'טופס 159'
  },
  {
    id: 'th-112-operators',
    kind: 'document',
    title: 'ניסיון מפעילים + קורות חיים (טופס 160)',
    related_questions: ['112.25'],
    status: 'טרם נבדק',
    source: 'טופס 160'
  },
  {
    id: 'th-112-recs',
    kind: 'document',
    title: '3 המלצות מארגונים שונים מ־4 השנים האחרונות',
    related_questions: ['112.29'],
    status: 'טרם נבדק',
    source: 'שאלות STEM.docx'
  }
];

export const CRITERIA_112 = [
  {
    id: 'cr-112-relevance',
    kind: 'criteria',
    title: 'מידת ההתאמה והרלוונטיות לתת הסל',
    related_questions: ['112.6'],
    status: 'טרם נבדק'
  },
  {
    id: 'cr-112-theory',
    kind: 'criteria',
    title: 'רקע תיאורטי ואמפירי (עד 70 מילים, 5 מקורות)',
    related_questions: ['112.20'],
    status: 'טרם נבדק'
  },
  {
    id: 'cr-112-evaluation',
    kind: 'criteria',
    title: 'מדדי הערכה ומדד תוצאה',
    related_questions: ['112.21', '112.22'],
    status: 'טרם נבדק'
  }
];

export function thresholdsPayload(existing) {
  const prev = Array.isArray(existing) ? existing : [];
  const byId = new Map(prev.map((x) => [x.id, x]));
  return [...THRESHOLDS_112, ...CRITERIA_112].map((item) => ({
    ...item,
    status: byId.get(item.id)?.status || item.status,
    notes: byId.get(item.id)?.notes || ''
  }));
}

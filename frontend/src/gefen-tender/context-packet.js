import { GOOGLE_DRIVE_PROGRAMS, SHAREPOINT_BASE } from './constants.js';
import { answerText, isFinalAnswer } from './final-answers.js';
import { summarizeGaps } from './knowledge.js';
import { historicalForQuestion } from './historical-answers.js';
import { buildSubmissionAnswers } from './questionnaires.js';
import { BASKET_112, BASKET_112_TITLE, countWords } from './questionnaire-112.js';

export const CHATGPT_SYSTEM_PROMPT_112 = `עליך להכין תשובה מקצועית לשאלה המצורפת במסגרת מכרז גפ״ן 2027, תת סל 112 – חדשנות ויזמות טכנולוגית, עבור תוכנית של תעשיידע.

התבסס על נוסח השאלה, דרישות המענה, מגבלות התווים והמילים, תנאי המכרז והמידע המצטבר במערכת.

בחן תשובות היסטוריות ופריטי מאגר ידע מצטבר, ככל שקיימים, והתאם אותם לדרישות המכרז הנוכחי.
מאגר הידע הוא בסיס לניסוח בלבד — אינו תשובה סופית ואינו אסמכתה מאומתת למכרז 2027.

השתמש במידע הקיים ב־Supabase, בחומרי התוכנית ב־Google Drive ובמסמכים הרלוונטיים ב־SharePoint, בהתאם להרשאות הגישה הזמינות.

בדוק את תוכן המקורות בפועל כאשר ניתן לגשת אליהם.

המטרה היא לגבש תשובה איכותית, מדויקת, מקצועית ומשכנעת, המשקפת את התוכנית ואת יכולותיה בפועל וממקסמת את סיכויי אישורה.

אין להמציא מידע, ניסיון, המלצות, השכלה, הכשרות, אסמכתאות או תוצאות מדידה.

אין להרחיב את מהות התוכנית לצורך התאמה מלאכותית למכרז.

כאשר מידע חסר, ציין זאת בנפרד.

התוצר הנדרש:
1. תשובה מוצעת בהתאם לדרישות ולמגבלות השאלה.
2. ספירת תווים או מילים, ככל שנדרש.
3. מקורות שעליהם התבססה התשובה.
4. מידע חסר או תנאים שטרם אומתו.
5. מידע חדש שניתן להוסיף למאגר הידע, בצירוף מקור.

יש להפריד בין נוסח התשובה המיועד למערכת גפ״ן לבין ההערות, המקורות והחוסרים.

אין לשנות תשובה מאושרת ללא אישור מפורש.`;

/** @deprecated kept for non-112 fallback */
export const CHATGPT_SYSTEM_PROMPT = CHATGPT_SYSTEM_PROMPT_112;

function filled(v) {
  return v != null && v !== '' && (!Array.isArray(v) || v.length > 0);
}

function show(v) {
  if (!filled(v)) return 'לא נאסף / לא אומת';
  if (typeof v === 'string') return v;
  return JSON.stringify(v, null, 2);
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => filled(obj?.[k])).map((k) => [k, obj[k]]));
}

function knowledgeCard(item) {
  return {
    id: item.id,
    title: item.title,
    topic: item.topic || '',
    type: item.type,
    info_kind: item.info_kind || '',
    original_question: item.original_question || '',
    content: item.content,
    source: item.source,
    related_questions: item.related_questions || [],
    verification_status: item.verification_status,
    note: 'מידע מצטבר ממקורות קודמים — אינו תשובה מאושרת למכרז 2027'
  };
}

/**
 * Prefer items linked to the question, then same-topic, then other program knowledge.
 * Never mixes programs; never treats knowledge as final answers.
 */
function relevantKnowledge(items, answer) {
  // Never include inactive / out-of-stage knowledge in ChatGPT packets.
  const list = (Array.isArray(items) ? items : []).filter((item) => item && item.assignment_status !== 'inactive');
  const qid = answer.question_id || answer.key;
  const related = [];
  const sameTopic = [];
  const rest = [];
  for (const item of list) {
    const linked = Array.isArray(item.related_questions)
      && item.related_questions.some((r) => r === qid || r === answer.key || r === String(answer.number));
    if (linked) related.push(item);
    else if (item.topic && answer.chapter_label && item.topic.includes(answer.chapter_label.slice(0, 4))) {
      sameTopic.push(item);
    } else rest.push(item);
  }
  // Also pull items whose original_question strongly overlaps current label
  const label = String(answer.label || '').slice(0, 40);
  for (const item of rest.slice()) {
    if (label && item.original_question && String(item.original_question).includes(label)) {
      related.push(item);
      const i = rest.indexOf(item);
      if (i >= 0) rest.splice(i, 1);
    }
  }
  const ordered = [...related, ...sameTopic, ...rest];
  return {
    linked_to_question: related.slice(0, 30).map(knowledgeCard),
    additional_program_knowledge: ordered.filter((x) => !related.includes(x)).slice(0, 40).map(knowledgeCard),
    total_in_program: list.length
  };
}

function peopleForProgram(row, latestRows) {
  const p = row.payload || {};
  const ids = [
    ...(Array.isArray(p.developer_ids) ? p.developer_ids : []),
    ...(Array.isArray(p.operator_ids) ? p.operator_ids : [])
  ];
  const named = [p.developers, p.operators].flatMap((v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') return v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    return [];
  });
  return (latestRows || [])
    .filter((r) => r.kind === 'operator')
    .filter((r) => ids.includes(r.id) || named.some((v) =>
      (typeof v === 'string' && (v === r.id || v === r.title)) ||
      (v && (v.id === r.id || v.name === r.title))
    ))
    .map((r) => ({
      id: r.id,
      name: r.title,
      ...pick(r.payload || {}, [
        'roles', 'education', 'degrees', 'training', 'training_hours',
        'experience', 'teaching_experience', 'development_experience',
        'eligibility', 'verified_sources', 'verification_status'
      ])
    }));
}

export function buildContextPacket(row, answer, latestRows = []) {
  const p = row.payload || {};
  const parts = String(answer.key).split('.');
  const association = parts[0] === 'association' ? p.associations?.[Number(parts[1])] : null;
  const q = association?.questions?.[Number(parts[2])] || {};
  const meta = p.question_context?.[answer.key] || {};
  const history = [
    ...historicalForQuestion(p.historical_answers, answer.question_id, answer.label),
    q.previous_answers,
    meta.previous_answers,
    p.previous_answers?.[answer.key],
    p.historical_answers_legacy?.[answer.key]
  ].filter(filled);
  const allAnswers = buildSubmissionAnswers(row);
  const gaps = summarizeGaps(p, [answer]);
  const for112 = Number(answer.code) === BASKET_112 || String(answer.question_id || '').startsWith('112.');

  const sections = [
    ['זיהוי', {
      program: row.title,
      number: p.number,
      record_id: row.id,
      revision: row.revision,
      basket: for112 ? `${BASKET_112} – ${BASKET_112_TITLE}` : (association?.code || answer.group),
      question_id: answer.question_id || answer.key,
      question_key: answer.key,
      question_number: answer.number || q.number,
      section: answer.group,
      association: association ? pick(association, ['code', 'status', 'validity']) : null
    }],
    ['השאלה — נוסח רשמי', answer.label],
    ['מה נדרש לכלול בתשובה', q.requirements ?? meta.requirements ?? answer.requirements],
    ['מגבלות ופורמט', {
      character_limit: answer.limit || 'לא אומתה מגבלה',
      word_limit: answer.limit_words || q.limit_words || null,
      current_words: countWords(answer.value),
      choices: answer.choices || 'לא הוגדרו אפשרויות',
      multiple: Boolean(answer.multi),
      extra_text: Boolean(answer.extra_text || q.extra_text),
      instructions: q.instructions ?? meta.instructions
    }],
    ['תנאים, קריטריונים ומסמכים נדרשים', {
      question: q.threshold_conditions ?? meta.conditions ?? answer.conditions,
      association: association?.conditions,
      criteria: q.professional_criteria ?? meta.criteria ?? answer.criteria,
      attachments: q.attachments ?? answer.attachments,
      source: q.source ?? meta.source ?? answer.source,
      mapping_verified: answer.mapping_verified === true,
      thresholds: (p.thresholds_112 || []).filter((t) =>
        Array.isArray(t.related_questions) && t.related_questions.includes(answer.question_id)
      )
    }],
    ['תשובות היסטוריות (אינן מאושרות אוטומטית ל־2027)', history.length ? history : undefined],
    ['טיוטה נוכחית', answer.value],
    ['מאגר ידע מצטבר של התוכנית בלבד (אינו תשובה מאושרת ל־2027)', relevantKnowledge(p.knowledge_items, answer)],
    ['הערות ידע חופשיות', pick(p, ['knowledge_notes', 'source_notes', 'historical_notes', 'details', 'syllabus', 'experience', 'recommendations'])],
    ['מפתחים ומפעילים משויכים — ללא פרטי קשר אישיים', peopleForProgram(row, latestRows)],
    ['תשובות קשורות מאותה הגשה', allAnswers
      .filter((x) => x.key !== answer.key && answerText(x.value).trim())
      .filter((x) => !for112 || x.code === BASKET_112 || String(x.question_id || '').startsWith('112.') || String(x.key).startsWith('details.') || !x.code)
      .map((x) => ({
        question: x.label,
        answer: x.value,
        approved: isFinalAnswer(p.final_answers, x.key, x.value)
      }))],
    ['SharePoint — מסמכי מקור', SHAREPOINT_BASE],
    ['Google Drive — תוכניות תעשיידע', GOOGLE_DRIVE_PROGRAMS],
    ['תיקיית Google Drive של התוכנית', p.drive_folder_url || 'לא שויכה עדיין'],
    ['מסמכי SharePoint של התוכנית', p.sharepoint_urls || p.sharepoint_notes || 'לא תועדו'],
    ['מידע חסר או שטרם אומת', gaps]
  ];

  const prompt = for112 ? CHATGPT_SYSTEM_PROMPT_112 : CHATGPT_SYSTEM_PROMPT_112;
  return [
    prompt,
    '---',
    'נתונים דינמיים לעדכון מבוקר ב־Supabase:',
    `record_id=${row.id}; revision=${row.revision}; question_id=${answer.question_id || answer.key}`,
    'עדכון מידע עובדתי: RPC gefen_tender_2027_save במצב append_knowledge. תשובות היסטוריות: append_historical. אין לדרוס final_answers.',
    ...sections.map(([label, value]) => `### ${label}\n${show(value)}`)
  ].join('\n\n');
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(
  new URL('../frontend/public/summer-feedback/index.html', import.meta.url),
  'utf8'
);
const app = readFileSync(
  new URL('../frontend/public/summer-feedback/app.js', import.meta.url),
  'utf8'
);
const refinements = readFileSync(
  new URL('../frontend/public/summer-feedback/questionnaire-refinements.js', import.meta.url),
  'utf8'
);
const css = readFileSync(
  new URL('../frontend/public/summer-feedback/questionnaire-v4.css', import.meta.url),
  'utf8'
);
const migration = readFileSync(
  new URL('../supabase/migrations/20260726011500_update_summer_feedback_questionnaire_v4.sql', import.meta.url),
  'utf8'
);

test('questionnaire v4 contains the approved 18 support statements', () => {
  const requiredStatements = [
    'מטרות הפעילויות ודרך ההעברה המצופה היו ברורות לי',
    'פרטי הפעילות, הכתובת, השעות והקבוצה נמסרו בצורה ברורה',
    'היה לי ברור למי לפנות בכל שאלה, תקלה או צורך',
    'לפני הפעילויות וידאו איתי שיש ברשותי את המידע, הציוד והחומרים הנדרשים',
    'במידת הצורך ניתנו השלמות לציוד ולחומרים בהתאם לדרישה',
    'התמיכה שקיבלתי אפשרה לי להתמקד בהדרכה'
  ];

  requiredStatements.forEach(statement => assert.match(app, new RegExp(statement)));
  assert.match(app, /const GENERAL_GROUPS =/);
  assert.match(app, /לא רלוונטי/);
  assert.match(app, /includeNotRelevant/);
});

test('activity evaluation uses six ratings, multi-select experience and one free note', () => {
  const metrics = [
    'הפעילות התאימה לגיל המשתתפים',
    'התוכן ורצף ההדרכה היו ברורים',
    'היקף התוכן התאים לזמן הפעילות',
    'הציוד והחומרים התאימו לפעילות',
    'הפעילות עוררה עניין והשתתפות',
    'ההערכה הכללית שלי לפעילות היא חיובית'
  ];

  metrics.forEach(metric => assert.match(app, new RegExp(metric)));
  assert.match(app, /const EXPERIENCE_OPTIONS =/);
  assert.match(app, /קלה להעברה/);
  assert.match(app, /מורכבת או מסורבלת/);
  assert.match(app, /delivery_experience/);
  assert.match(app, /מה עבד היטב בפעילות\? מה היה קשה, עמוס או מסורבל/);
  assert.doesNotMatch(app, /פעילות מוצלחת במיוחד/);
  assert.doesNotMatch(app, /פעילות שדורשת שיפור/);
});

test('summary contains the six approved open questions', () => {
  const prompts = [
    'מה חשוב לשמר בפעילויות הקיץ עצמן?',
    'מה כדאי לשנות או לשפר בפעילויות הקיץ עצמן?',
    'מה חשוב לשמר במעטפת המקצועית והתפעולית שקיבלת?',
    'מה כדאי לשנות או לשפר במעטפת המקצועית והתפעולית שקיבלת?',
    'איזו הכשרה, הכנה או תמיכה נוספת הייתה מסייעת לך?',
    'האם יש דבר נוסף שחשוב לך לשתף?'
  ];

  prompts.forEach(prompt => assert.ok(app.includes(prompt)));
});

test('v4 layout, progress and schema changes are wired', () => {
  assert.match(html, /questionnaire-v4\.css/);
  assert.match(css, /\.activity-experience/);
  assert.match(css, /\.activity-free-note textarea/);
  assert.match(refinements, /preserve_activities/);
  assert.match(refinements, /\[data-experience\]:checked/);
  assert.match(migration, /add column if not exists delivery_experience/);
  assert.match(migration, /question_version = 4/);
});

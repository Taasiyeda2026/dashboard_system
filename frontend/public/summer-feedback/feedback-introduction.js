const INTRODUCTION_PARAGRAPHS = [
  'תודה רבה על הדרכת סדנאות הקיץ, על ההשקעה ועל הזמן שהקדשת למילוי המשוב.',
  'המשוב נועד לשמוע את החוויה שלך מהשטח כפי שחווית אותה באמת — מה עבד היטב, מה היה חסר ומה לדעתך ניתן לשפר. הוא מתייחס למעטפת, לליווי ולכלים שקיבלת וכן לפעילויות שהדרכת.',
  'חשוב לנו להדגיש כי המשוב אינו מהווה הערכה של עבודתך או של תפקודך. אין תשובות נכונות או לא נכונות ואנו מזמינים אותך לשתף בכנות ובפתיחות, הן בדברים החיוביים והן בנקודות הדורשות שיפור.',
  'המשוב שלך יסייע לנו ללמוד מהניסיון בשטח, לדייק את הפעילות ולשפר את המענה הניתן למדריכים בהמשך.',
  'תודה על ההשקעה, על הכנות ועל שיתוף הפעולה.'
];

function currentInstructorName() {
  const label = document.querySelector('.head-actions small')?.textContent?.trim() || '';
  if (label) {
    const cleaned = label.replace(/^תצוגה מקדימה\s*·\s*/, '').trim();
    if (cleaned && cleaned !== 'תצוגת ניהול') return cleaned;
  }

  const heroText = document.querySelector('.hero p')?.textContent?.trim() || '';
  const match = heroText.match(/^שלום\s+(.+?)\./);
  return match?.[1]?.trim() || 'מדריך/ה';
}

function applyFeedbackIntroduction() {
  const form = document.querySelector('#feedbackForm');
  const hero = document.querySelector('.container > .hero');
  if (!form || !hero || document.querySelector('.feedback-introduction')) return;

  const section = document.createElement('section');
  section.className = 'feedback-introduction';
  section.setAttribute('aria-label', 'הקדמה למשוב');

  const greeting = document.createElement('p');
  greeting.className = 'intro-greeting';
  greeting.textContent = `שלום ${currentInstructorName()},`;
  section.append(greeting);

  INTRODUCTION_PARAGRAPHS.forEach(text => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    section.append(paragraph);
  });

  hero.insertAdjacentElement('afterend', section);

  const heroSubtitle = hero.querySelector('p');
  if (heroSubtitle) {
    heroSubtitle.textContent = 'משוב על המעטפת, הליווי, הכלים והפעילויות שהדרכת.';
  }
}

const introductionObserver = new MutationObserver(applyFeedbackIntroduction);
introductionObserver.observe(document.documentElement, { childList: true, subtree: true });
applyFeedbackIntroduction();

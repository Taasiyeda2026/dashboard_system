import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsScreenStack } from './shared/layout.js';

const REMINDER_ITEMS = [
  'לוודא שעות ומיקום 48 שעות מראש',
  'לוודא ציוד וחומרי הדרכה',
  'להגיע 15 דקות לפני תחילת הפעילות',
  'להחתים אישור ביצוע בסיום',
  'להעלות צילום חתום למערכת'
];

const SECTIONS = [
  {
    id: 'before-day',
    title: 'לפני יום הפעילות',
    open: true,
    items: [
      'יש לוודא את שעות הפעילות לפחות 48 שעות מראש.',
      'יש לוודא שקיבלתם אישור לביצוע הפעילות מעדן או מעידן לפני יום הפעילות.',
      'יש לוודא מול איש הקשר במקום את מיקום הפעילות, שעת ההגעה, גילאי הילדים, מספר המשתתפים הצפוי וכל צורך מיוחד.',
      'יש לוודא שכל הציוד הנדרש נמצא ברשותכם, שלם, תקין ומוכן לשימוש.',
      'יש לבדוק מראש שיש ברשותכם את חומרי ההדרכה הנדרשים: מצגת, סרטון, דף פעילות, דוגמה מוכנה או כל עזר אחר.',
      'במקרה של חוסר בציוד, תקלה, אי־בהירות או שינוי מצד הקייטנה — יש לעדכן בהקדם.'
    ]
  },
  {
    id: 'arrival',
    title: 'הגעה והתארגנות',
    items: [
      'יש להגיע לפחות 15 דקות לפני שעת ההתחלה.',
      'עם ההגעה יש לאתר את מנהלת הקייטנה או איש הקשר במקום.',
      'יש לוודא שסביבת הפעילות מתאימה: שולחנות, כיסאות, חשמל במידת הצורך, מקום בטוח ושטח מסודר לתוצרים.',
      'אין להתחיל פעילות לפני שהילדים נמצאים בהשגחת צוות הקייטנה.'
    ]
  },
  {
    id: 'during',
    title: 'במהלך הפעילות',
    items: [
      'יש להקפיד על יחס מכבד, סבלני ומקצועי.',
      'יש להתאים את ההסבר לגיל הילדים.',
      'יש להקפיד על כללי בטיחות לאורך כל הפעילות.',
      'אין להשאיר ילדים ללא השגחה.',
      'אין לבטל, לקצר, להחליף או לשנות פעילות ללא אישור מראש.',
      'אם מספר הילדים בפועל שונה משמעותית מהמספר שנמסר מראש, יש לעדכן בהקדם.'
    ]
  },
  {
    id: 'incidents',
    title: 'אירועים חריגים ועדכונים בזמן אמת',
    items: [
      'במקרה של אירוע חריג, בעיית משמעת, פציעה, נזק לציוד, חוסר בציוד או קושי משמעותי — יש לעדכן מיידית.',
      'בכל אי־בהירות או בקשה חריגה מצד הקייטנה יש לקבל אישור לפני החלטה.',
      'אין לצלם ילדים או לפרסם תמונות ללא אישור ובהתאם להנחיות הקייטנה.'
    ]
  },
  {
    id: 'equipment',
    title: 'ציוד ותוצרים',
    items: [
      'האחריות על הציוד והתוצרים היא של המדריך.',
      'אין למסור לילד יותר מתוצר אחד אלא אם התקבל אישור מראש.',
      'תוצרים שנותרו בסיום הפעילות יש לשמור בצורה מסודרת.',
      'בסיום הפעילות יש לוודא שכל הציוד נאסף, נספר והוחזר.',
      'אין להשאיר ציוד, חומרים או תוצרים במקום ללא תיאום ואישור.',
      'ציוד שנשבר, אבד או נפגם — יש לדווח מיידית.'
    ]
  },
  {
    id: 'approval',
    title: 'אישור ביצוע פעילות',
    items: [
      'בסיום כל פעילות יש להחתים את מנהלת הקייטנה או איש הקשר המוסמך על טופס אישור ביצוע.',
      'לאחר החתימה יש להעלות צילום ברור של הטופס החתום דרך מערכת המדריך.',
      'יש לוודא שבאישור מופיעים: מספר הילדים בפועל, שכבת הגיל, שם הסדנה, תאריך הפעילות, שם מקום הפעילות, שם המדריך וחתימת איש הקשר.'
    ],
    showApprovalLink: true
  },
  {
    id: 'report',
    title: 'דיווח בסיום יום פעילות',
    items: [
      'כיצד התנהלו הסדנאות.',
      'האם עלו קשיים.',
      'האם היה חוסר בציוד או בתוצרים.',
      'האם היו אירועים חריגים.',
      'האם נדרשת השלמת ציוד.',
      'המלצות או דגשים לפעילויות הבאות.'
    ]
  },
  {
    id: 'conduct',
    title: 'התנהלות מקצועית מול הקייטנה',
    items: [
      'יש לשמור על שיתוף פעולה מלא עם צוות הקייטנה.',
      'יש להקפיד על שפה מכבדת, סבלנית וחיובית.',
      'יש להגיע בלבוש מסודר ומתאים לעבודה עם ילדים.',
      'אין לעזוב לפני איסוף הציוד וסגירת הנושא מול איש הקשר.',
      'בכל מצב של ספק — לשאול ולעדכן בזמן אמת.'
    ]
  }
];

function sectionHtml(section) {
  const list = section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const approvalLink = section.showApprovalLink
    ? '<p class="instr-guidelines__link-row"><button type="button" class="ds-btn ds-btn--xs ds-btn--secondary" data-guidelines-go-approvals>מעבר לאישורי ביצוע</button></p>'
    : '';
  return `<details class="instr-guidelines__section" id="instr-guidelines-${escapeHtml(section.id)}"${section.open ? ' open' : ''}>
    <summary class="instr-guidelines__summary">${escapeHtml(section.title)}</summary>
    <div class="instr-guidelines__body">
      <ul class="instr-guidelines__list">${list}</ul>
      ${approvalLink}
    </div>
  </details>`;
}

export const instructorGuidelinesScreen = {
  load: async () => ({}),
  render() {
    const reminder = REMINDER_ITEMS.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    return dsScreenStack(`
      <section class="instructor-area instructor-guidelines">
        ${dsPageHeader('נהלים למדריכי הקיץ', 'נהלי עבודה להפעלה מקצועית, בטוחה ומסודרת של פעילויות הקיץ.')}
        <article class="instr-guidelines__reminder" aria-label="תזכורת לפני פעילות">
          <h2 class="instr-guidelines__reminder-title">לפני כל פעילות</h2>
          <ul class="instr-guidelines__checklist">${reminder}</ul>
        </article>
        <div class="instr-guidelines__accordion">${SECTIONS.map(sectionHtml).join('')}</div>
      </section>
    `);
  },
  bind({ root }) {
    root.querySelector('[data-guidelines-go-approvals]')?.addEventListener('click', () => {
      document.querySelector('.shell-nav__btn[data-route="instructor-completion-approvals"]')?.click();
    });
  }
};

import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsScreenStack } from './shared/layout.js';

const PAGE_SUBTITLE = 'כללי עבודה קצרים להפעלה מקצועית, בטוחה ומסודרת של פעילויות הקיץ.';
const DEFAULT_SECTION_ID = 'before-day';

const REMINDER_ITEMS = [
  'לוודא שעות ומיקום',
  'לוודא ציוד',
  'להגיע 15 דקות לפני',
  'להחתים אישור ביצוע',
  'להעלות צילום חתום'
];

const SECTIONS = [
  {
    id: 'before-day',
    title: 'לפני יום הפעילות',
    icon: '📋',
    summary: 'אימות שעות, מיקום, ציוד וחומרי הדרכה לפני יום הפעילות.',
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
    icon: '🚗',
    summary: 'הגעה מוקדמת, איתור איש קשר והכנת סביבת הפעילות.',
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
    icon: '🎯',
    summary: 'התנהלות מקצועית, בטיחות והתאמה לגיל הילדים.',
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
    title: 'אירועים חריגים',
    icon: '⚠️',
    summary: 'עדכון מיידי, קבלת אישור ושמירה על כללי צילום.',
    items: [
      'במקרה של אירוע חריג, בעיית משמעת, פציעה, נזק לציוד, חוסר בציוד או קושי משמעותי — יש לעדכן מיידית.',
      'בכל אי־בהירות או בקשה חריגה מצד הקייטנה יש לקבל אישור לפני החלטה.',
      'אין לצלם ילדים או לפרסם תמונות ללא אישור ובהתאם להנחיות הקייטנה.'
    ]
  },
  {
    id: 'equipment',
    title: 'ציוד ותוצרים',
    icon: '🧰',
    summary: 'אחריות על ציוד, תוצרים ואיסוף מסודר בסיום.',
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
    icon: '✍️',
    summary: 'חתימה על טופס והעלאת צילום חתום למערכת.',
    items: [
      'בסיום כל פעילות יש להחתים את מנהלת הקייטנה או איש הקשר המוסמך על טופס אישור ביצוע.',
      'לאחר החתימה יש להעלות צילום ברור של הטופס החתום דרך מערכת המדריך.',
      'יש לוודא שבאישור מופיעים: מספר הילדים בפועל, שכבת הגיל, שם הסדנה, תאריך הפעילות, שם מקום הפעילות, שם המדריך וחתימת איש הקשר.'
    ],
    showApprovalLink: true
  },
  {
    id: 'report',
    title: 'דיווח בסיום יום',
    icon: '📝',
    summary: 'סיכום יום הפעילות, קשיים והמלצות להמשך.',
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
    title: 'התנהלות מקצועית',
    icon: '🤝',
    summary: 'שיתוף פעולה, שפה מכבדת וסגירה מסודרת מול הקייטנה.',
    items: [
      'יש לשמור על שיתוף פעולה מלא עם צוות הקייטנה.',
      'יש להקפיד על שפה מכבדת, סבלנית וחיובית.',
      'יש להגיע בלבוש מסודר ומתאים לעבודה עם ילדים.',
      'אין לעזוב לפני איסוף הציוד וסגירת הנושא מול איש הקשר.',
      'בכל מצב של ספק — לשאול ולעדכן בזמן אמת.'
    ]
  }
];

function sectionById(id) {
  return SECTIONS.find((section) => section.id === id) || SECTIONS[0];
}

function detailHtml(section) {
  const list = section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const approvalLink = section.showApprovalLink
    ? '<p class="instr-guidelines__link-row"><button type="button" class="ds-btn ds-btn--xs ds-btn--primary" data-guidelines-go-approvals>מעבר לאישורי ביצוע</button></p>'
    : '';
  return `<h3 class="instr-guidelines__detail-title">${escapeHtml(section.title)}</h3>
    <ul class="instr-guidelines__list">${list}</ul>
    ${approvalLink}`;
}

function cardHtml(section, activeId) {
  const active = section.id === activeId;
  return `<button type="button" class="instr-guidelines__card${active ? ' is-active' : ''}" data-guideline-id="${escapeHtml(section.id)}" aria-pressed="${active ? 'true' : 'false'}">
    <span class="instr-guidelines__card-icon" aria-hidden="true">${section.icon}</span>
    <span class="instr-guidelines__card-body">
      <strong class="instr-guidelines__card-title">${escapeHtml(section.title)}</strong>
      <span class="instr-guidelines__card-summary">${escapeHtml(section.summary)}</span>
    </span>
    <span class="instr-guidelines__card-open">פתח</span>
  </button>`;
}

function bindApprovalLink(root) {
  root.querySelector('[data-guidelines-go-approvals]')?.addEventListener('click', () => {
    document.querySelector('.shell-nav__btn[data-route="instructor-completion-approvals"]')?.click();
  }, { once: true });
}

export const instructorGuidelinesScreen = {
  load: async () => ({}),
  render() {
    const reminder = REMINDER_ITEMS.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    const defaultSection = sectionById(DEFAULT_SECTION_ID);
    return dsScreenStack(`
      <section class="instructor-area instructor-guidelines">
        ${dsPageHeader('נהלים למדריכי הקיץ', PAGE_SUBTITLE)}
        <div class="instr-guidelines__strip" aria-label="תזכורת לפני פעילות">
          <p class="instr-guidelines__strip-title">לפני כל פעילות</p>
          <ul class="instr-guidelines__checklist">${reminder}</ul>
        </div>
        <div class="instr-guidelines__grid" role="tablist" aria-label="נושאי נהלים">${SECTIONS.map((section) => cardHtml(section, DEFAULT_SECTION_ID)).join('')}</div>
        <div class="instr-guidelines__detail" data-guideline-detail role="tabpanel" aria-live="polite">${detailHtml(defaultSection)}</div>
      </section>
    `);
  },
  bind({ root }) {
    const detail = root.querySelector('[data-guideline-detail]');
    const cards = [...root.querySelectorAll('[data-guideline-id]')];

    function showSection(id) {
      const section = sectionById(id);
      if (!section || !detail) return;
      cards.forEach((card) => {
        const active = card.getAttribute('data-guideline-id') === id;
        card.classList.toggle('is-active', active);
        card.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      detail.innerHTML = detailHtml(section);
      bindApprovalLink(root);
    }

    cards.forEach((card) => {
      card.addEventListener('click', () => {
        showSection(card.getAttribute('data-guideline-id'));
      });
    });

    bindApprovalLink(root);
  }
};

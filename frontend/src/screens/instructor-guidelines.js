import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsScreenStack } from './shared/layout.js';

const PAGE_TITLE = 'נהלי עבודה חשובים – קיץ 2026';

const REMINDER_ITEMS = [
  'לוודא שעות ומיקום',
  'לוודא איש קשר',
  'לוודא ציוד נדרש',
  'לבדוק תקינות ציוד',
  'להגיע 15 דקות לפני',
  'להתארגן לפני התחלה',
  'להנחות בצורה ברורה',
  'להתנהל בכבוד ובסבלנות',
  'להחתים ולהעלות אישור חתום'
];

const SECTIONS = [
  {
    id: 'before-day',
    number: 1,
    title: 'לפני יום הפעילות',
    icon: '📋',
    items: [
      'יש לוודא קיום פעילות מול איש הקשר עד 48 שעות מראש.',
      'יש לוודא מול איש הקשר שעה, מיקום ומספר משתתפים צפוי.',
      'יש להוריד מראש את אישור הביצוע ממערכת הדשבורד.',
      'יש לוודא שהציוד הנדרש שלם, תקין ומוכן לשימוש.',
      'יש להכין מראש מצגת, סרטון, דף פעילות או דוגמה.',
      'בכל חוסר, תקלה או שינוי יש לעדכן את מנהל הפעילות.'
    ]
  },
  {
    id: 'arrival',
    number: 2,
    title: 'הגעה, התארגנות ואיחורים',
    icon: '🚗',
    items: [
      'יש להגיע למקום 15 דקות לפחות לפני ההתחלה.',
      'יש להקפיד להגיע בזמן ואין לאחר לפעילות.',
      'עם ההגעה יש לאתר את איש הקשר במקום.',
      'יש לוודא שולחנות, כיסאות, חשמל ואינטרנט.',
      'יש לוודא שהמרחב בטוח ומסודר לפעילות.',
      'אין להתחיל לפני שהילדים בהשגחת צוות הקייטנה.',
      'בכל עיכוב או איחור יש לעדכן מיידית.',
      'במקרה של היעדרות יש לעדכן ולקבל אישור מראש.',
      'אין לבטל הגעה לפעילות ללא אישור מנהל הפעילות.'
    ]
  },
  {
    id: 'during',
    number: 3,
    title: 'במהלך הפעילות',
    icon: '🎯',
    items: [
      'יש לשמור על יחס מכבד, סבלני ומקצועי.',
      'יש להתאים את ההסבר לגיל הילדים בקבוצה.',
      'יש להקפיד על כללי בטיחות לאורך הפעילות.',
      'אין להשאיר ילדים ללא השגחת צוות הקייטנה.',
      'אין לבטל, לקצר או לשנות פעילות ללא אישור.',
      'בשינוי משמעותי במספר הילדים יש לעדכן בהקדם.'
    ]
  },
  {
    id: 'incidents',
    number: 4,
    title: 'אירועים חריגים ואישורים',
    icon: '⚠️',
    items: [
      'בכל אירוע חריג יש לעדכן את מנהל הפעילות.',
      'במקרה של פציעה יש לעדכן מיידית את מנהל הפעילות.',
      'במקרה של נזק או חוסר בציוד יש לעדכן בהקדם.',
      'בקשה חריגה מצד הקייטנה מחייבת אישור מראש.',
      'בכל מצב של אי־בהירות יש להתייעץ לפני החלטה.',
      'צילום ילדים מותר רק באישור צילום ובהתאם להנחיות.'
    ]
  },
  {
    id: 'equipment',
    number: 5,
    title: 'ציוד ותוצרים',
    icon: '🧰',
    items: [
      'יש לנהוג באחריות ולשמור על הציוד והתוצרים.',
      'יש להשתמש בציוד בצורה מסודרת וזהירה.',
      'אין למסור יותר מתוצר אחד לילד ללא אישור.',
      'תוצרים שנותרו יש לשמור בצורה מסודרת.',
      'בסיום יש לאסוף, לספור ולהחזיר את הציוד.',
      'אין להשאיר ציוד או תוצרים ללא תיאום ואישור.',
      'ציוד שנשבר, אבד או נפגם יש לדווח בהקדם.'
    ]
  },
  {
    id: 'approval',
    number: 6,
    title: 'אישור ביצוע פעילות',
    icon: '✍️',
    items: [
      'יש להשתמש באישור שהורד מראש ממערכת הדשבורד.',
      'בסיום הפעילות יש להחתים את איש הקשר במקום.',
      'יש לוודא שהפרטים תואמים לפעילות שבוצעה.',
      'יש להעלות צילום ברור של האישור החתום לדשבורד.'
    ],
    showApprovalLink: true
  },
  {
    id: 'report',
    number: 7,
    title: 'דיווח בסיום יום',
    icon: '📝',
    items: [
      'יש לדווח כיצד התנהלו הסדנאות באותו יום.',
      'יש לציין אם עלו קשיים במהלך הפעילות.',
      'יש לציין אם היה חוסר בציוד או בתוצרים.',
      'יש לדווח על אירועים חריגים אם התרחשו.',
      'יש לציין אם נדרשת השלמת ציוד להמשך.',
      'יש להוסיף המלצות ודגשים לפעילות הבאה.'
    ]
  },
  {
    id: 'conduct',
    number: 8,
    title: 'התנהלות מקצועית',
    icon: '🤝',
    items: [
      'יש לשמור על שיתוף פעולה עם צוות הקייטנה.',
      'יש להקפיד על שפה מכבדת, סבלנית וחיובית.',
      'יש להגיע בלבוש מסודר ומתאים לפעילות.',
      'אין לעזוב לפני איסוף הציוד וסגירה במקום.',
      'בכל מצב של ספק יש לשאול ולעדכן בזמן אמת.'
    ]
  }
];

function sectionById(id) {
  return SECTIONS.find((section) => section.id === id) || SECTIONS[0];
}

function modalContentHtml(section) {
  const list = section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  return `<ul class="instr-guidelines__list">${list}</ul>`;
}

function modalActionsHtml(section) {
  const approvalLink = section.showApprovalLink
    ? '<button type="button" class="ds-btn ds-btn--xs ds-btn--primary" data-guidelines-go-approvals>מעבר לאישורי ביצוע</button>'
    : '';
  return `${approvalLink}<button type="button" class="ds-btn ds-btn--xs ds-btn--secondary" data-ui-close-modal>סגור</button>`;
}

function modalTitle(section) {
  return `${section.number}. ${section.icon} ${section.title}`;
}

function cardHtml(section) {
  return `<button type="button" class="instr-guidelines__card" data-guideline-id="${escapeHtml(section.id)}" aria-haspopup="dialog">
    <span class="instr-guidelines__card-num" aria-hidden="true">${section.number}</span>
    <span class="instr-guidelines__card-center">
      <span class="instr-guidelines__card-icon" aria-hidden="true">${section.icon}</span>
      <span class="instr-guidelines__card-body">
        <strong class="instr-guidelines__card-title">${escapeHtml(section.title)}</strong>
      </span>
    </span>
    <span class="instr-guidelines__card-open">פתח</span>
  </button>`;
}

function bindModalActions(ui) {
  document.querySelector('[data-guidelines-go-approvals]')?.addEventListener('click', () => {
    ui?.closeModal?.();
    document.querySelector('.shell-nav__btn[data-route="instructor-completion-approvals"]')?.click();
  }, { once: true });
}

export const instructorGuidelinesScreen = {
  load: async () => ({}),
  render() {
    const reminder = REMINDER_ITEMS.map((item) => `<div class="procedures-intro-item">${escapeHtml(item)}</div>`).join('');
    return dsScreenStack(`
      <section class="instructor-area instructor-guidelines">
        ${dsPageHeader(PAGE_TITLE)}
        <div class="instr-guidelines__strip" aria-label="תזכורת לפני פעילות">
          <p class="instr-guidelines__strip-title">לפני כל פעילות</p>
          <div class="procedures-intro-grid" role="list">${reminder}</div>
          <a
            href="./forms/photo-consent-form.pdf"
            download
            class="instr-guidelines__pdf-download"
          >
            📄 הורדת אישור צילום ופרסום
          </a>
        </div>
        <div class="instr-guidelines__grid" role="list" aria-label="נושאי נהלים">${SECTIONS.map(cardHtml).join('')}</div>
      </section>
    `);
  },
  bind({ root, ui }) {
    if (!ui) return;

    function openGuidelineModal(id) {
      const section = sectionById(id);
      if (!section) return;
      ui.openModal({
        title: modalTitle(section),
        content: modalContentHtml(section),
        actions: modalActionsHtml(section),
        modalClass: 'ds-modal--guidelines'
      });
      bindModalActions(ui);
    }

    root.querySelectorAll('[data-guideline-id]').forEach((card) => {
      card.addEventListener('click', () => {
        openGuidelineModal(card.getAttribute('data-guideline-id'));
      });
    });
  }
};

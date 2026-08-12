import './styles/birthday-instructor-caption.css';

const ROOT_SELECTOR = '[data-birthday-popup-root]';
const GREETING_SELECTOR = '[data-instructor-birthday-greeting]';

function instructorGreetingText(image) {
  const src = String(image?.getAttribute('src') || image?.src || '');
  if (!src.includes('birthdays/instructors.png')) return '';
  const alt = String(image?.alt || '').trim();
  return alt.startsWith('מזל טוב ל') ? alt : '';
}

function decorateBirthdayPopup(root) {
  if (!root || root.querySelector(GREETING_SELECTOR)) return;
  const image = root.querySelector('.birthday-popup-image');
  const greetingText = instructorGreetingText(image);
  if (!greetingText) return;

  const actions = root.querySelector('.birthday-popup-actions');
  if (!actions?.parentElement) return;

  const greeting = document.createElement('p');
  greeting.className = 'birthday-popup-instructor-greeting';
  greeting.dataset.instructorBirthdayGreeting = 'true';
  greeting.textContent = greetingText;
  actions.parentElement.insertBefore(greeting, actions);
}

function decorateExisting() {
  document.querySelectorAll(ROOT_SELECTOR).forEach((root) => decorateBirthdayPopup(root));
}

function startInstructorBirthdayCaption() {
  if (globalThis.__INSTRUCTOR_BIRTHDAY_CAPTION_STARTED__) return;
  globalThis.__INSTRUCTOR_BIRTHDAY_CAPTION_STARTED__ = true;

  decorateExisting();
  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.matches?.(ROOT_SELECTOR)) decorateBirthdayPopup(node);
        node.querySelectorAll?.(ROOT_SELECTOR).forEach((root) => decorateBirthdayPopup(root));
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
}

startInstructorBirthdayCaption();

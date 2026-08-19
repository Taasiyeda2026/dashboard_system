import { createIcon } from './icon.js';

const ITEMS = [
  { key: 'home',       label: 'בית',          icon: 'home' },
  { key: 'new-report', label: 'דיווח חדש',    icon: 'plus', desktopOnly: true },
  { key: 'my-reports', label: 'הדיווחים שלי', icon: 'list' },
];

export function createBottomNav({ active, desktopActive = active, instructor = {}, onNavigate, onLogout } = {}) {
  const nav = document.createElement('div');
  nav.className = 'av2-bottom-nav';
  nav.setAttribute('role', 'navigation');
  nav.setAttribute('aria-label', 'ניווט ראשי');

  const brand = document.createElement('div');
  brand.className = 'av2-bottom-nav__brand';
  const logo = document.createElement('img');
  logo.src = './assets/logo.png';
  logo.alt = 'תעשיידע';
  const brandText = document.createElement('span');
  brandText.textContent = 'מערכת נוכחות';
  brand.append(logo, brandText);

  const user = document.createElement('div');
  user.className = 'av2-bottom-nav__user';
  user.append(createIcon('user', { size: 18 }));
  const userText = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = instructor.name || 'מדריך';
  const empId = document.createElement('span');
  empId.textContent = instructor.empId ? `מס׳ עובד ${instructor.empId}` : 'אזור אישי';
  userText.append(name, empId);
  user.append(userText);

  const menu = document.createElement('div');
  menu.className = 'av2-bottom-nav__menu';
  for (const item of ITEMS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'av2-bottom-nav__item';
    if (item.desktopOnly) btn.classList.add('av2-bottom-nav__item--desktop-only');
    if (item.key === active) btn.classList.add('is-mobile-active');
    if (item.key === desktopActive) btn.classList.add('is-active');
    btn.append(createIcon(item.icon, { size: 20 }));
    const label = document.createElement('span');
    label.textContent = item.label;
    btn.append(label);
    btn.addEventListener('click', () => onNavigate?.(item.key));
    menu.append(btn);
  }

  const footer = document.createElement('div');
  footer.className = 'av2-bottom-nav__footer';
  const logout = document.createElement('button');
  logout.type = 'button';
  logout.className = 'av2-bottom-nav__logout';
  logout.append(createIcon('log-out', { size: 18 }));
  const logoutLabel = document.createElement('span');
  logoutLabel.textContent = 'התנתקות';
  logout.append(logoutLabel);
  logout.addEventListener('click', () => onLogout?.());
  footer.append(logout);

  nav.append(brand, user, menu, footer);
  return nav;
}

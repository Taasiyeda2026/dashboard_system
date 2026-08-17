import { createIcon } from './icon.js';

const ITEMS = [
  { key: 'home',       label: 'בית',          icon: 'home' },
  { key: 'my-reports', label: 'הדיווחים שלי', icon: 'list' },
];

export function createBottomNav({ active, onNavigate } = {}) {
  const nav = document.createElement('div');
  nav.className = 'av2-bottom-nav';
  nav.setAttribute('role', 'navigation');
  nav.setAttribute('aria-label', 'ניווט ראשי');

  for (const item of ITEMS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'av2-bottom-nav__item';
    if (item.key === active) btn.classList.add('is-active');
    btn.append(createIcon(item.icon, { size: 20 }));
    const label = document.createElement('span');
    label.textContent = item.label;
    btn.append(label);
    btn.addEventListener('click', () => onNavigate?.(item.key));
    nav.append(btn);
  }

  return nav;
}

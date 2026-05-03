import { dsPageHeader, dsCard, dsScreenStack } from './shared/layout.js';

export const adminHomeScreen = {
  load: () => Promise.resolve({}),
  render() {
    return dsScreenStack(`
      ${dsPageHeader('בית — ניהול', 'מרכז הניהול של המערכת')}
      ${dsCard({
        title: 'ניהול מערכת',
        body: `
          <p style="padding: var(--space-3, 12px) 0; color: var(--color-text-secondary)">
            ברוכים הבאים לממשק הניהול. בחרו פעולה מהסרגל הצדדי.
          </p>
        `
      })}
    `);
  },
  bind() {}
};

import { dsPageHeader, dsScreenStack, dsCard, dsEmptyState } from '../shared/layout.js';
export const instructorReportsScreen = {
  load: async () => ({}),
  render: () => dsScreenStack(`<section class="instructor-area">${dsPageHeader('דיווחים')}${dsCard({ title: 'דיווחים', body: dsEmptyState('האזור ייפתח בהמשך') })}</section>`)
};

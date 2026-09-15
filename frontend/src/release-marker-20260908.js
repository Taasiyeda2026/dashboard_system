import { config } from './config.js';

const MARKERS = [
  'attendance-manager-ux-system-dialog-20260908-v4-manager-team-strip-stable',
  'instructor-presentations-link-20260915-v1',
  'ui-drawer-close-20260915-v1'
];

for (const marker of MARKERS) {
  if (!String(config.HOTFIX_VERSION || '').includes(marker)) {
    config.HOTFIX_VERSION = `${marker}-${String(config.HOTFIX_VERSION || '')}`;
  }
}

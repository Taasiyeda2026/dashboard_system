import { config } from './config.js';

const MARKER = 'attendance-manager-ux-system-dialog-20260908-v3-manager-workshop-milestones';
if (!String(config.HOTFIX_VERSION || '').includes(MARKER)) {
  config.HOTFIX_VERSION = `${MARKER}-${String(config.HOTFIX_VERSION || '')}`;
}

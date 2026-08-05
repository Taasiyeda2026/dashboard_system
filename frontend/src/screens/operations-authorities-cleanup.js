import './operations-authorities-cleanup-base.js';
import './operations-2027-remaining-fix.js';
import './operations-2027-loading-controller.js';
import './operations-2027-root-bind-hotfix.js';

// The base cleanup module keeps the existing 2026 layout rules.
// Operations 2027 custom tabs are owned by one loading controller without DOM-driven refetches.
// The root-bind hotfix passes the nested 2027 screen node to that controller.

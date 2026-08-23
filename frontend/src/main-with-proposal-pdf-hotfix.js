/**
 * Minimal application bootstrap.
 * Screen/feature modules load on demand via feature-route-loader.
 */
import './network-request-dedupe.js';
import './activity-performance-runtime.js';
import './completion-approval-performance-runtime.js';
import './interaction-performance.js';
import './auth-session-isolation-hotfix.js';
import './session-security-runtime.js';
import './activity-period-selector-access-hotfix.js?v=20260821-dashboard-period-sync-v2';
import './dashboard-drilldown-runtime.js?v=20260821-v1';
import './manager-board-management-docs-link.js?v=20260821-v1';
import './admin-data-tool.js?v=20260823-v2';
import './admin-data-activity-number-hotfix.js?v=20260823-v1';
import './admin-data-admin-guard.js?v=20260823-v1';
import './admin-permissions-management-v2.js?v=20260823-v8';
import './operations-home-navigation-hotfix.js?v=20260823-v1';
import './progressive-route-warmup.js';
import './main.js';
import './feature-route-loader.js';

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
import './activity-period-selector-access-hotfix.js?v=20260801-school-2027-cutover-v1';
import './progressive-route-warmup.js';
import './main.js';
import './feature-route-loader.js';

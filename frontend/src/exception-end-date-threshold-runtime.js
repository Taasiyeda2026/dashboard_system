import { api } from './api.js';
import { state } from './state.js';
import { applyEndDateExceptionThresholdByPeriod } from './exception-end-date-threshold-by-period.js';

const flag = '__dsExceptionThresholdByPeriodInstalled';
const originalExceptions = api?.exceptions?.bind(api);
if (typeof originalExceptions === 'function' && !globalThis[flag]) {
  globalThis[flag] = true;
  api.exceptions = async (...args) => {
    const payload = await originalExceptions(...args);
    const filters = args?.[0] && typeof args[0] === 'object' ? args[0] : {};
    return applyEndDateExceptionThresholdByPeriod(payload, filters?.activity_period || state?.activityPeriodTab);
  };
}

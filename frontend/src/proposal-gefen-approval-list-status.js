import { api } from './api.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalGefenApprovalListStatus');

export function gefenApprovalListOptions(options = {}) {
  const source = options && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {};
  return {
    ...source,
    includeLinkedDocuments: true
  };
}

export function installGefenApprovalListStatus(targetApi = api) {
  if (!targetApi || targetApi[PATCH_KEY]) return false;

  const originalLoader = targetApi.proposalsAgreements;
  if (typeof originalLoader !== 'function') return false;

  targetApi.proposalsAgreements = function proposalsWithGefenApprovalStatus(options = {}) {
    return originalLoader.call(this, gefenApprovalListOptions(options));
  };

  Object.defineProperty(targetApi, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return true;
}

installGefenApprovalListStatus(api);

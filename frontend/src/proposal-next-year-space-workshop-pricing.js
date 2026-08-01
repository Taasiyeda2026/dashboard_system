import { api } from './api.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalNextYearSpaceWorkshopPricing');
const NEXT_YEAR_WORKSHOPS_GROUP = 'next_year_workshops';
const SPACE_WORKSHOP_KEY = 'space_workshop';
const SPACE_WORKSHOP_PRICE = 500;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function isNextYearSpaceWorkshop(row = {}) {
  const group = text(row.group_key || row.proposal_group || row.activity_type_group);
  if (group !== NEXT_YEAR_WORKSHOPS_GROUP) return false;
  return text(row.pricing_key) === SPACE_WORKSHOP_KEY
    || text(row.parent_pricing_key) === SPACE_WORKSHOP_KEY;
}

export function applyNextYearSpaceWorkshopPrice(rows = []) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!isNextYearSpaceWorkshop(row)) return row;
    return {
      ...row,
      unit_price: SPACE_WORKSHOP_PRICE,
      hourly_price: SPACE_WORKSHOP_PRICE
    };
  });
}

export function normalizeNextYearSpaceWorkshopPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  if (!Array.isArray(payload.proposalActivityPricing)) return payload;
  return {
    ...payload,
    proposalActivityPricing: applyNextYearSpaceWorkshopPrice(payload.proposalActivityPricing)
  };
}

function wrapRowsMethod(targetApi, methodName) {
  const original = targetApi?.[methodName];
  if (typeof original !== 'function') return;
  targetApi[methodName] = async function nextYearSpaceWorkshopPriceRows(...args) {
    return applyNextYearSpaceWorkshopPrice(await original.apply(this, args));
  };
}

export function installNextYearSpaceWorkshopPricing(targetApi = api) {
  if (!targetApi || targetApi[PATCH_KEY]) return false;

  const originalLoader = targetApi.proposalsAgreements;
  if (typeof originalLoader === 'function') {
    targetApi.proposalsAgreements = async function nextYearSpaceWorkshopPriceLoader(...args) {
      return normalizeNextYearSpaceWorkshopPayload(await originalLoader.apply(this, args));
    };
  }

  const originalEditorDeps = targetApi.proposalsAgreementsEditorDeps;
  if (typeof originalEditorDeps === 'function') {
    targetApi.proposalsAgreementsEditorDeps = async function nextYearSpaceWorkshopPriceEditorDeps(...args) {
      return normalizeNextYearSpaceWorkshopPayload(await originalEditorDeps.apply(this, args));
    };
  }

  wrapRowsMethod(targetApi, 'readProposalActivityPricing');

  Object.defineProperty(targetApi, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return true;
}

installNextYearSpaceWorkshopPricing(api);

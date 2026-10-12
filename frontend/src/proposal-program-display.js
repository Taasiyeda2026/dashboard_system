/** Customer document presentation only. Never feed this result back into items or forms. */
export const PROPOSAL_PROGRAM_DISPLAY_VERSION = 'portzot-v1';

const text = (value) => String(value ?? '').trim();

export function proposalProgramDisplay(item = {}, context = {}) {
  const gefenNumber = text(item.gefen_number ?? item.gefenNumber);
  const original = {
    name: context.name ?? text(item.item_name ?? item.itemName),
    gefenNumber: context.gefenNumber ?? gefenNumber
  };
  const activityNo = text(item.activity_no ?? item.activityNo);
  const pricingKey = text(item.source_pricing_key ?? item.sourcePricingKey);
  if (context.enabled !== true || context.isCourse !== true
    || item.is_manual_course === true || item.manual_course === true) return original;
  // This is the existing customer short name, also used by the pricing-table
  // normalizer. Keep it identical in render paths that do not run a DOM pass.
  if (gefenNumber === '52279'
    && (!activityNo || activityNo === '52279')
    && (!pricingKey || ['52279', 'gefen:52279'].includes(pricingKey))) {
    return { ...original, name: 'אופק פרימיום' };
  }
  if (gefenNumber !== '3604'
    || (activityNo && activityNo !== '3604')
    || (pricingKey && !['3604', 'gefen:3604'].includes(pricingKey))) return original;
  return { name: 'אופק פרימיום (פורצות דרך)', gefenNumber: '52279' };
}

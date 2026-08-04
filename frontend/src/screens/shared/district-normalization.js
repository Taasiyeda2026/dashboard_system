const normalizeText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

const DISTRICT_ALIASES = new Map([
  ['צפון', 'צפון'],
  ['הצפון', 'צפון'],
  ['מחוז צפון', 'צפון'],
  ['דרום', 'דרום'],
  ['הדרום', 'דרום'],
  ['מחוז דרום', 'דרום'],
  ['מרכז', 'מרכז'],
  ['המרכז', 'מרכז'],
  ['מחוז מרכז', 'מרכז'],
  ['ירושלים', 'מרכז'],
  ['אזור יהודה והשומרון', 'מרכז']
]);

export const OPERATIONAL_DISTRICTS = ['צפון', 'מרכז', 'דרום'];

export function normalizeOperationalDistrict(value) {
  return DISTRICT_ALIASES.get(normalizeText(value)) || '';
}

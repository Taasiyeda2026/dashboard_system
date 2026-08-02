import fs from 'node:fs';

const target = 'frontend/src/screens/exceptions.js';
const workflow = '.github/workflows/apply-exception-district-normalization.yml';
const script = 'scripts/apply_exception_district_normalization.mjs';

let source = fs.readFileSync(target, 'utf8');

const oldDistrictBlock = `function exceptionDistrictKey(row = {}) {
  const district = String(row?.district || '').trim();
  if (!district || district === 'ממתין לשיוך מחוזי') return 'ללא מחוז / לא משויך';
  return district;
}`;

const newDistrictBlock = `const EXCEPTION_DISTRICT_ORDER = ['מחוז צפון', 'מחוז דרום', 'מחוז מרכז'];
const EXCEPTION_DISTRICT_ALIASES = new Map([
  ['צפון', 'מחוז צפון'],
  ['הצפון', 'מחוז צפון'],
  ['מחוז צפון', 'מחוז צפון'],
  ['מחוז הצפון', 'מחוז צפון'],
  ['דרום', 'מחוז דרום'],
  ['הדרום', 'מחוז דרום'],
  ['מחוז דרום', 'מחוז דרום'],
  ['מחוז הדרום', 'מחוז דרום'],
  ['מרכז', 'מחוז מרכז'],
  ['המרכז', 'מחוז מרכז'],
  ['מחוז מרכז', 'מחוז מרכז'],
  ['מחוז המרכז', 'מחוז מרכז']
]);

function exceptionDistrictKey(row = {}) {
  const district = String(row?.district || '').trim();
  if (!district || district === 'ממתין לשיוך מחוזי') return 'ללא מחוז / לא משויך';
  return EXCEPTION_DISTRICT_ALIASES.get(district) || district;
}

function exceptionDistrictSortIndex(district) {
  const index = EXCEPTION_DISTRICT_ORDER.indexOf(district);
  return index === -1 ? EXCEPTION_DISTRICT_ORDER.length : index;
}`;

if (!source.includes(oldDistrictBlock)) {
  throw new Error('Could not find exceptionDistrictKey block');
}
source = source.replace(oldDistrictBlock, newDistrictBlock);

const oldSort = `.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'he'))`;
const newSort = `.sort((a, b) => {
      const orderDiff = exceptionDistrictSortIndex(a[0]) - exceptionDistrictSortIndex(b[0]);
      if (orderDiff !== 0) return orderDiff;
      return b[1] - a[1] || a[0].localeCompare(b[0], 'he');
    })`;

if (!source.includes(oldSort)) {
  throw new Error('Could not find district summary sort');
}
source = source.replace(oldSort, newSort);

fs.writeFileSync(target, source);
for (const path of [workflow, script]) {
  if (fs.existsSync(path)) fs.unlinkSync(path);
}

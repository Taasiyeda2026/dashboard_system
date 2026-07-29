import { readFile, writeFile } from 'node:fs/promises';

const fileUrl = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);
let source = await readFile(fileUrl, 'utf8');

function replaceExactlyOnce(before, after, label) {
  if (source.includes(after)) return;
  const matches = source.split(before).length - 1;
  if (matches !== 1) {
    throw new Error(`[authority-gefen-fix] ${label}: expected one match, found ${matches}`);
  }
  source = source.replace(before, after);
}

replaceExactlyOnce(
  `function isGefenApprovalApplicable(row = {}, items = []) {\n  const group = normalizeProposalGroup(row.activity_type_group);`,
  `function isGefenApprovalApplicable(row = {}, items = []) {\n  if (inferProposalClientType(row) === 'authority') return false;\n  const group = normalizeProposalGroup(row.activity_type_group);`,
  'approval applicability'
);

replaceExactlyOnce(
  `function gefenApprovalValidationMessage(row = {}, items = []) {\n  if (!text(row.semel_mosad)) return 'חסר מספר מוסד. יש להשלים אותו לפני הפקת אישור גפ״ן.';`,
  `function gefenApprovalValidationMessage(row = {}, items = []) {\n  if (inferProposalClientType(row) === 'authority') return '';\n  if (!text(row.semel_mosad)) return 'חסר מספר מוסד. יש להשלים אותו לפני הפקת אישור גפ״ן.';`,
  'approval validation'
);

replaceExactlyOnce(
  `        if (\n          normalizeProposalGroup(freshRow.activity_type_group) === 'gefen'\n          || (freshRow.combine_gefen_approval === true && isGefenApprovalApplicable(freshRow, mergedItems))\n        ) {`,
  `        if (\n          isGefenApprovalApplicable(freshRow, mergedItems)\n          && (\n            normalizeProposalGroup(freshRow.activity_type_group) === 'gefen'\n            || freshRow.combine_gefen_approval === true\n          )\n        ) {`,
  'PDF validation guard'
);

replaceExactlyOnce(
  `        const generatedCombinedGefen = normalizeProposalGroup(freshRow.activity_type_group) === 'gefen'\n          || (freshRow.combine_gefen_approval === true && isGefenApprovalApplicable(freshRow, mergedItems));`,
  `        const generatedCombinedGefen = isGefenApprovalApplicable(freshRow, mergedItems)\n          && (\n            normalizeProposalGroup(freshRow.activity_type_group) === 'gefen'\n            || freshRow.combine_gefen_approval === true\n          );`,
  'generated approval status'
);

await writeFile(fileUrl, source, 'utf8');
console.log('[authority-gefen-fix] source is up to date');

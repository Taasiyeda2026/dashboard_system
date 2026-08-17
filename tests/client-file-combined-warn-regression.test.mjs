/**
 * Regression: clientFacingProposalTypeLabel must NOT emit console.warn
 * for 'combined' or known combined aliases (e.g. 'הצעה משולבת').
 *
 * 'combined' is an internal multi-group key — not a user-facing proposal type.
 * It intentionally resolves to '—' with no warning.
 *
 * A truly unknown value (e.g. 'weird_unknown_type') must still warn.
 *
 * Verified by static source analysis only (no browser globals required).
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('frontend/src/screens/proposals-agreements.js', 'utf8');

/** Extract the body of a top-level named function or exported function by name. */
function extractFunctionBody(src, name) {
  // Match `function name(` or `export function name(`
  const pattern = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`);
  const matchIdx = src.search(pattern);
  if (matchIdx === -1) return null;

  // Skip past the parameter list (tracking only parens so default `= {}` don't confuse us).
  let parenDepth = 0;
  let paramsDone = false;
  let bodyStart = -1;
  for (let i = matchIdx; i < src.length; i++) {
    const ch = src[i];
    if (!paramsDone) {
      if (ch === '(') parenDepth++;
      else if (ch === ')') { parenDepth--; if (parenDepth === 0) paramsDone = true; }
    } else {
      if (ch === '{') { bodyStart = i; break; }
    }
  }
  if (bodyStart === -1) return null;

  // Extract from the opening brace of the body to its matching closing brace.
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(matchIdx, i + 1); }
  }
  return null;
}

function stripLineComments(src) {
  return src
    .split('\n')
    .map((line) => {
      const ci = line.indexOf('//');
      return ci === -1 ? line : line.slice(0, ci);
    })
    .join('\n');
}

test('clientFacingProposalTypeLabel function exists in proposals-agreements.js', () => {
  const body = extractFunctionBody(SRC, 'clientFacingProposalTypeLabel');
  assert.ok(body !== null, 'clientFacingProposalTypeLabel function not found');
  assert.ok(body.length > 0, 'function body is empty');
});

test('combined guard appears before console.warn in clientFacingProposalTypeLabel', () => {
  const body = extractFunctionBody(SRC, 'clientFacingProposalTypeLabel');
  assert.ok(body !== null, 'clientFacingProposalTypeLabel function not found');
  const clean = stripLineComments(body);

  // Guard must reference COMBINED_INTERNAL_KEY or 'combined'
  const guardPattern = /COMBINED_INTERNAL_KEY|['"]combined['"]/;
  const warnPattern = /console\.warn/;

  const guardIdx = clean.search(guardPattern);
  const warnIdx = clean.search(warnPattern);

  assert.ok(guardIdx !== -1, 'combined guard not found in clientFacingProposalTypeLabel');
  assert.ok(warnIdx !== -1, 'console.warn not found in clientFacingProposalTypeLabel (should still warn for unknown values)');
  assert.ok(
    guardIdx < warnIdx,
    `combined guard (pos ${guardIdx}) must appear BEFORE console.warn (pos ${warnIdx})`
  );
});

test('combined guard uses early return before console.warn', () => {
  const body = extractFunctionBody(SRC, 'clientFacingProposalTypeLabel');
  assert.ok(body !== null, 'clientFacingProposalTypeLabel function not found');
  const clean = stripLineComments(body);

  // Between the guard and the warn there must be a 'return' statement
  const guardIdx = clean.search(/COMBINED_INTERNAL_KEY|['"]combined['"]/);
  const warnIdx = clean.search(/console\.warn/);
  assert.ok(guardIdx !== -1 && warnIdx !== -1, 'guard or warn not found');

  const between = clean.slice(guardIdx, warnIdx);
  assert.ok(
    /\breturn\b/.test(between),
    'expected a return statement between the combined guard and console.warn'
  );
});

test('COMBINED_INTERNAL_KEY is defined as the string "combined"', () => {
  assert.ok(
    /const\s+COMBINED_INTERNAL_KEY\s*=\s*['"]combined['"]/.test(SRC),
    'COMBINED_INTERNAL_KEY constant not found or has unexpected value'
  );
});

test('known combined aliases map to COMBINED_INTERNAL_KEY in PROPOSAL_GROUP_LEGACY_ALIASES', () => {
  // The alias 'הצעה משולבת' must be present and map to COMBINED_INTERNAL_KEY
  assert.ok(
    /'הצעה משולבת'\s*:\s*COMBINED_INTERNAL_KEY/.test(SRC),
    '"הצעה משולבת" alias → COMBINED_INTERNAL_KEY mapping not found'
  );
});

test('console.warn is still present in clientFacingProposalTypeLabel for truly unknown values', () => {
  const body = extractFunctionBody(SRC, 'clientFacingProposalTypeLabel');
  assert.ok(body !== null, 'clientFacingProposalTypeLabel function not found');
  const clean = stripLineComments(body);
  assert.ok(
    /console\.warn/.test(clean),
    'console.warn must remain for truly unknown proposal type values'
  );
});

#!/usr/bin/env node
// Adapt OR-Tools PoC plan JSON to the shape expected by new-engine-audit.mjs.
import { readFile, writeFile } from 'node:fs/promises';

const src = process.argv[2];
const dest = process.argv[3];
if (!src || !dest) throw Error('Usage: to_audit_plan.mjs <ortools-plan.json> <audit-plan.json>');
const plan = JSON.parse(await readFile(src, 'utf8'));
const rows = (plan.rows || []).map(r => ({
  courseId: r.courseId,
  kind: r.kind,
  status: r.status || '',
  instructorEmpId: r.instructorEmpId || '',
  meetings: r.meetings || [],
  reason: r.diagnostics ? JSON.stringify(r.diagnostics) : r.reason || '',
  fullDayBlocking: false,
}));
await writeFile(dest, JSON.stringify({
  engineVersion: plan.engineVersion,
  rows,
  finalPlanValidation: { valid: plan.internalValidation?.valid !== false, failures: [] },
  source: 'ortools-cpsat-poc',
}));
console.log(JSON.stringify({ rows: rows.length, assigned: rows.filter(r => r.instructorEmpId).length }));

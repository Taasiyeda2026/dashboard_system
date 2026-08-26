import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  calculateInstructorWage,
  calculatePricingGroup,
  calculateSchoolPricing
} from '../frontend/src/screens/shared/admin-pricing-logic.js';

const simulatorSource = await readFile(new URL('../frontend/src/screens/admin-pricing-simulator.js', import.meta.url), 'utf8');

const wage = calculateInstructorWage({
  hours: 3,
  hourlyRate: 80,
  wageMultiplier: 1.3,
  kilometers: 80,
  kilometerMultiplier: 1.5
});

test('instructor wage matches the workbook formula', () => {
  assert.equal(wage, 432);
});

test('group 1 matches workbook pricing and minimum price', () => {
  const result = calculatePricingGroup({
    instructorCharge: 900,
    studentCount: 28,
    transportCost: 1800,
    instructorWage: wage
  });

  assert.equal(result.finalPrice, 5808);
  assert.equal(result.minimumPrice, 5054);
  assert.equal(result.commission, 580.8000000000001);
  assert.equal(result.totalExpenses, 3612.8);
  assert.equal(result.profit, 2195.2);
  assert.equal(result.approved, true);
});

test('group 2 is below the 30 percent profitability target', () => {
  const result = calculatePricingGroup({
    instructorCharge: 800,
    studentCount: 20,
    transportCost: 1900,
    instructorWage: wage
  });

  assert.equal(result.finalPrice, 4920);
  assert.equal(result.minimumPrice, 5220);
  assert.equal(result.approved, false);
});

test('school summary matches all six workbook groups', () => {
  const inputs = [
    [900, 28, 1800],
    [800, 20, 1900],
    [500, 30, 1800],
    [700, 25, 1600],
    [500, 15, 1350],
    [800, 25, 2000]
  ];
  const school = calculateSchoolPricing(inputs.map(([instructorCharge, studentCount, transportCost]) =>
    calculatePricingGroup({ instructorCharge, studentCount, transportCost, instructorWage: wage })
  ));

  assert.equal(school.finalPrice, 30523);
  assert.equal(school.minimumPrice, 29739);
  assert.ok(Math.abs(school.totalExpenses - 20894.3) < 1e-9);
  assert.ok(Math.abs(school.profit - 9628.7) < 1e-9);
  assert.ok(Math.abs(school.margin - 0.3154571962126921) < 1e-12);
  assert.equal(school.approved, true);
});

test('custom simulation assumptions affect pricing without changing defaults', () => {
  const custom = calculatePricingGroup({
    instructorCharge: 900,
    studentCount: 28,
    transportCost: 1800,
    instructorWage: wage
  }, {
    studentPrice: 120,
    commissionRate: 0.08,
    targetMargin: 0.25,
    venueCost: 700
  });

  assert.equal(custom.studentPrice, 120);
  assert.equal(custom.finalPrice, 6060);
  assert.equal(custom.venueCost, 700);
  assert.equal(custom.minimumPrice, Math.ceil((432 + 1800 + 700) / 0.67));
});

test('tour simulator remains compact and avoids the old wide table dialog', () => {
  assert.match(simulatorSource, /admin-pricing-overlay/);
  assert.match(simulatorSource, /width:\s*min\(820px,\s*calc\(100vw - 36px\)\)/);
  assert.match(simulatorSource, /overflow-x:\s*hidden/);
  assert.doesNotMatch(simulatorSource, /min-width:\s*1570px/);
  assert.doesNotMatch(simulatorSource, /<table/);
  assert.doesNotMatch(simulatorSource, /createElement\(['"]dialog['"]\)/);
});

test('editable defaults are exposed for simulation and copy-all control is removed', () => {
  assert.match(simulatorSource, /data-config-input="studentPrice"/);
  assert.match(simulatorSource, /data-config-input="commissionRate"/);
  assert.match(simulatorSource, /data-config-input="targetMargin"/);
  assert.match(simulatorSource, /data-config-input="venueCost"/);
  assert.match(simulatorSource, /איפוס לברירת מחדל/);
  assert.doesNotMatch(simulatorSource, /העתק קבוצה 1 לכולן/);
  assert.doesNotMatch(simulatorSource, /data-pricing-copy-first/);
});

test('tour simulator does not use orange status or accent colors', () => {
  assert.doesNotMatch(simulatorSource, /orange/i);
  assert.doesNotMatch(simulatorSource, /#f59e0b/i);
  assert.doesNotMatch(simulatorSource, /#fb923c/i);
});

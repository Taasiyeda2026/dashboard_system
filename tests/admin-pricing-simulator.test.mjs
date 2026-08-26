import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ADMIN_PRICING_CONFIG,
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

test('instructor wage remains a separate internal expense', () => {
  assert.equal(wage, 432);
});

test('default assumptions include instructor and student selling prices', () => {
  assert.equal(ADMIN_PRICING_CONFIG.instructorPrice, 769.5);
  assert.equal(ADMIN_PRICING_CONFIG.studentPrice, 111);
  assert.equal(ADMIN_PRICING_CONFIG.commissionRate, 0.10);
  assert.equal(ADMIN_PRICING_CONFIG.targetMargin, 0.30);
  assert.equal(ADMIN_PRICING_CONFIG.venueCost, 800);
});

test('group price uses global instructor price plus students plus transport', () => {
  const result = calculatePricingGroup({
    studentCount: 28,
    transportCost: 1800,
    instructorWage: wage
  });

  assert.equal(result.instructorPrice, 769.5);
  assert.equal(result.finalPrice, 5677.5);
  assert.equal(result.minimumPrice, 5054);
  assert.equal(result.commission, 567.75);
  assert.equal(result.totalExpenses, 3599.75);
  assert.equal(result.profit, 2077.75);
  assert.ok(Math.abs(result.margin - 0.365962131219727) < 1e-12);
  assert.equal(result.approved, true);
});

test('a lower-margin group remains rejected under the global instructor price', () => {
  const result = calculatePricingGroup({
    studentCount: 20,
    transportCost: 1900,
    instructorWage: wage
  });

  assert.equal(result.finalPrice, 4889.5);
  assert.equal(result.minimumPrice, 5220);
  assert.equal(result.approved, false);
});

test('school summary uses the same global instructor price for every selected group', () => {
  const inputs = [
    [28, 1800],
    [20, 1900],
    [30, 1800],
    [25, 1600],
    [15, 1350],
    [25, 2000]
  ];
  const school = calculateSchoolPricing(inputs.map(([studentCount, transportCost]) =>
    calculatePricingGroup({ studentCount, transportCost, instructorWage: wage })
  ));

  assert.equal(school.finalPrice, 30940);
  assert.equal(school.minimumPrice, 29739);
  assert.equal(school.totalExpenses, 20936);
  assert.equal(school.profit, 10004);
  assert.ok(Math.abs(school.margin - 0.3233354880413704) < 1e-12);
  assert.equal(school.approved, true);
});

test('custom simulation assumptions affect all pricing components without changing defaults', () => {
  const custom = calculatePricingGroup({
    studentCount: 28,
    transportCost: 1800,
    instructorWage: wage
  }, {
    instructorPrice: 850,
    studentPrice: 120,
    commissionRate: 0.08,
    targetMargin: 0.25,
    venueCost: 700
  });

  assert.equal(custom.instructorPrice, 850);
  assert.equal(custom.studentPrice, 120);
  assert.equal(custom.finalPrice, 6010);
  assert.equal(custom.venueCost, 700);
  assert.equal(custom.minimumPrice, Math.ceil((432 + 1800 + 700) / 0.67));
  assert.equal(ADMIN_PRICING_CONFIG.instructorPrice, 769.5);
});

test('tour simulator remains compact and avoids the old wide table dialog', () => {
  assert.match(simulatorSource, /admin-pricing-overlay/);
  assert.match(simulatorSource, /width:\s*min\(820px,\s*calc\(100vw - 36px\)\)/);
  assert.match(simulatorSource, /overflow-x:\s*hidden/);
  assert.doesNotMatch(simulatorSource, /min-width:\s*1570px/);
  assert.doesNotMatch(simulatorSource, /<table/);
  assert.doesNotMatch(simulatorSource, /createElement\(['"]dialog['"]\)/);
});

test('instructor price is editable only as a simulation assumption, not per group', () => {
  assert.match(simulatorSource, /data-config-input="instructorPrice"/);
  assert.match(simulatorSource, /value="\$\{DEFAULT_PRICING_INPUTS\.instructorPrice\}"/);
  assert.match(simulatorSource, /מחיר מדריך \(₪\)/);
  assert.doesNotMatch(simulatorSource, /data-group-input="instructorCharge"/);
  assert.doesNotMatch(simulatorSource, /עלות מדריך/);
});

test('editable defaults and reset remain available without copy-all control', () => {
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

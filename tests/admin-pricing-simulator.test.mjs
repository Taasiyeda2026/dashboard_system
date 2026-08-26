import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateInstructorWage,
  calculatePricingGroup,
  calculateSchoolPricing
} from '../frontend/src/screens/shared/admin-pricing-logic.js';

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

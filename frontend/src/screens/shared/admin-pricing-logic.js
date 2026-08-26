export const ADMIN_PRICING_CONFIG = Object.freeze({
  instructorPrice: 769.5,
  studentPrice: 111,
  commissionRate: 0.10,
  targetMargin: 0.30,
  venueCost: 800
});

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function calculateInstructorWage({
  hours = 0,
  hourlyRate = 0,
  wageMultiplier = 0,
  kilometers = 0,
  kilometerMultiplier = 0
} = {}) {
  const hoursCost = nonNegativeNumber(hours)
    * nonNegativeNumber(hourlyRate)
    * nonNegativeNumber(wageMultiplier);
  const travelCost = nonNegativeNumber(kilometers)
    * nonNegativeNumber(kilometerMultiplier);

  return hoursCost + travelCost;
}

export function calculatePricingGroup({
  studentCount = 0,
  transportCost = 0,
  instructorWage = 0
} = {}, config = ADMIN_PRICING_CONFIG) {
  const instructorPrice = nonNegativeNumber(config.instructorPrice);
  const studentPrice = nonNegativeNumber(config.studentPrice);
  const commissionRate = nonNegativeNumber(config.commissionRate);
  const targetMargin = nonNegativeNumber(config.targetMargin);
  const venueCost = nonNegativeNumber(config.venueCost);
  const denominator = 1 - commissionRate - targetMargin;

  if (denominator <= 0) {
    throw new Error('Invalid pricing configuration: commission plus target margin must be below 100%.');
  }

  const normalizedStudentCount = nonNegativeNumber(studentCount);
  const normalizedTransportCost = nonNegativeNumber(transportCost);
  const normalizedInstructorWage = nonNegativeNumber(instructorWage);

  const finalPrice = instructorPrice
    + (normalizedStudentCount * studentPrice)
    + normalizedTransportCost;
  const minimumPrice = Math.ceil(
    (normalizedInstructorWage + normalizedTransportCost + venueCost) / denominator
  );
  const commission = finalPrice * commissionRate;
  const totalExpenses = commission
    + normalizedInstructorWage
    + normalizedTransportCost
    + venueCost;
  const profit = finalPrice - totalExpenses;
  const margin = finalPrice > 0 ? profit / finalPrice : 0;
  const approved = finalPrice > 0 && margin + Number.EPSILON >= targetMargin;

  return {
    instructorPrice,
    studentPrice,
    finalPrice,
    minimumPrice,
    commission,
    instructorWage: normalizedInstructorWage,
    transportCost: normalizedTransportCost,
    venueCost,
    totalExpenses,
    profit,
    margin,
    approved
  };
}

export function calculateSchoolPricing(groups = [], config = ADMIN_PRICING_CONFIG) {
  const safeGroups = Array.isArray(groups) ? groups : [];
  const totals = safeGroups.reduce((acc, group) => {
    acc.finalPrice += Number(group?.finalPrice) || 0;
    acc.minimumPrice += Number(group?.minimumPrice) || 0;
    acc.commission += Number(group?.commission) || 0;
    acc.totalExpenses += Number(group?.totalExpenses) || 0;
    acc.profit += Number(group?.profit) || 0;
    return acc;
  }, {
    finalPrice: 0,
    minimumPrice: 0,
    commission: 0,
    totalExpenses: 0,
    profit: 0
  });

  const margin = totals.finalPrice > 0 ? totals.profit / totals.finalPrice : 0;
  return {
    ...totals,
    margin,
    approved: totals.finalPrice > 0 && margin + Number.EPSILON >= nonNegativeNumber(config.targetMargin)
  };
}

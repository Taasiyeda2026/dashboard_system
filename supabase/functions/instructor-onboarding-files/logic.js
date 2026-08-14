export const ONBOARDING_FOLDER_BY_EMPLOYMENT = Object.freeze({
  taasiyeda: 'תעשיידע',
  staffing: 'כוח אדם'
});

export function onboardingFolder(employmentType) {
  return ONBOARDING_FOLDER_BY_EMPLOYMENT[String(employmentType || '').trim()] || '';
}

export function directFileItems(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) => item?.file && item?.id && item?.name);
}

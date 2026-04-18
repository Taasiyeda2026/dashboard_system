/** תואם ל־activities: מובייל צר מקבל תצוגה קומפקטית. */
export function isNarrowViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
}

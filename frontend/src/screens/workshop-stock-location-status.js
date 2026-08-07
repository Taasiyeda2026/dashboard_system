export const WORKSHOP_STOCK_LOCATION_NAMES = new Set([
  'מלאי עידן',
  'מלאי הילה',
  'מלאי גיל'
]);

export function isWorkshopStockLocationName(name) {
  return WORKSHOP_STOCK_LOCATION_NAMES.has(String(name || '').trim());
}

export function workshopHolderStatusLabel(holderName, balance) {
  const numericBalance = Number(balance);
  const value = Number.isFinite(numericBalance) ? numericBalance : 0;
  if (isWorkshopStockLocationName(holderName)) {
    if (value < 0) return 'חוסר במלאי';
    if (value > 0) return 'יתרה במלאי';
    return 'אזל מהמלאי';
  }
  if (value < 0) return 'חוסר אצל מדריך';
  if (value > 0) return 'יתרה אצל מדריך';
  return 'אין יתרה אצל מדריך';
}

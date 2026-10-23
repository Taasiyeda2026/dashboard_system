export const ISRAA_LANGUAGE_REQUIRED = 'יש לבחור שפת הדרכה: עברית או ערבית';

// Reuse the drawer field so editing and sharing cannot submit different languages.
export function mountIsraaShareLanguage(form, bar, savedLanguage) {
  let select = form.querySelector('[name="instruction_language"]');
  const label = select?.closest('label') || form.ownerDocument.createElement('label');
  if (!select) {
    select = form.ownerDocument.createElement('select');
    select.name = 'instruction_language';
    select.className = 'ds-input';
  }
  label.replaceChildren('שפת הדרכה * ', select);
  select.innerHTML = '<option value="">בחרו שפת הדרכה</option><option value="he">עברית</option><option value="ar">ערבית</option>';
  select.value = ['he', 'ar'].includes(savedLanguage) ? savedLanguage : '';
  select.setAttribute('aria-required', 'true');
  bar.prepend(label);
  return select;
}

export async function shareIsraaGroupWithLanguage(api, ref, select) {
  const language = select.value;
  if (!['he', 'ar'].includes(language)) {
    select.focus();
    throw new Error(ISRAA_LANGUAGE_REQUIRED);
  }
  await api.saveIsraaActivityGroupDraft(ref.trackingId, ref.proposalItemId, ref.groupNumber, {
    instruction_language: language
  });
  return api.shareIsraaActivityGroup(ref.trackingId, ref.proposalItemId, ref.groupNumber);
}

export function israaShareErrorMessage(error) {
  const message = String(error?.message || '');
  if (message === ISRAA_LANGUAGE_REQUIRED || /israa_instruction_language_required|activities_school_2027_explicit_language_required/.test(message)) {
    return ISRAA_LANGUAGE_REQUIRED;
  }
  if (/israa_management_forbidden/.test(message)) return 'אין הרשאה לשתף את הפעילות. יש לפנות למנהל המערכת.';
  return 'לא ניתן לשתף את הפעילות כרגע. נסו שוב ואם התקלה נמשכת פנו למנהל המערכת.';
}

const boundButtons = new WeakSet();
const pendingButtons = new WeakSet();

export function bindAnnualReviewOpenButton(button, openReview, { guarded = false } = {}) {
  if (!button || boundButtons.has(button)) return;
  boundButtons.add(button);

  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!guarded) {
      await openReview(button.dataset.ar2Open);
      return;
    }

    if (pendingButtons.has(button)) return;
    pendingButtons.add(button);
    const originalDisabled = button.disabled;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'טוען…';

    try {
      const opened = await openReview(button.dataset.ar2Open);
      if (opened === false) {
        button.disabled = originalDisabled;
        button.textContent = originalText;
      }
    } catch {
      button.disabled = originalDisabled;
      button.textContent = originalText;
    } finally {
      pendingButtons.delete(button);
    }
  });
}

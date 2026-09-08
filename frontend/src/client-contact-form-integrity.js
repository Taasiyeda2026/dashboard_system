function addLabeledInput(form, before, labelText, inputName) {
  const label = document.createElement('label');
  label.append(document.createTextNode(labelText));
  const input = document.createElement('input');
  input.className = 'ds-input';
  input.name = inputName;
  input.inputMode = 'tel';
  input.autocomplete = 'tel';
  label.append(input);
  form.insertBefore(label, before);
}

function addContactActions(form) {
  const actions = document.createElement('div');
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'ds-btn ds-btn--primary';
  submit.textContent = 'שמירה';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'ds-btn';
  cancel.dataset.paClientContactClose = '';
  cancel.textContent = 'ביטול';
  actions.append(submit, cancel);
  form.append(actions);
}

/** Completes a contact modal created by a previously cached screen renderer. */
export function ensureClientContactFormIntegrity(root = document) {
  root.querySelectorAll?.('[data-pa-client-contact-form]').forEach((form) => {
    const emailLabel = form.querySelector('[name="email"]')?.closest('label') || null;
    if (!form.querySelector('[name="phone"]')) {
      addLabeledInput(form, emailLabel, 'טלפון נוסף', 'phone');
    }
    if (!form.querySelector('[data-pa-client-contact-error]')) {
      const error = document.createElement('p');
      error.dataset.paClientContactError = '';
      error.setAttribute('role', 'alert');
      form.append(error);
    }
    if (!form.querySelector('button[type="submit"]')) addContactActions(form);
  });
}

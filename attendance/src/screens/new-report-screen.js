import { createIcon } from '../components/icon.js';
import { createInputField, createSelectField } from '../components/field.js';

export function renderNewReportScreen(container, { activityTypes = [], onBack, onSave } = {}) {
  container.innerHTML = '';

  const wrap = document.createElement('section');
  wrap.className = 'av2-report';

  const inner = document.createElement('div');
  inner.className = 'av2-container av2-report__inner';

  const header = document.createElement('div');
  header.className = 'av2-report__header';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'av2-btn av2-btn--icon';
  backBtn.setAttribute('aria-label', 'חזרה');
  backBtn.append(createIcon('chevron-right'));
  backBtn.addEventListener('click', () => onBack?.());
  const title = document.createElement('h1');
  title.className = 'av2-report__title';
  title.textContent = 'דיווח חדש';
  header.append(backBtn, title);

  const form = document.createElement('form');
  form.className = 'av2-report__form';
  form.noValidate = true;

  const typeField = createSelectField({
    id: 'av2-activity-type',
    label: 'סוג פעילות',
    options: activityTypes
  });
  const dateField = createInputField({
    id: 'av2-date',
    label: 'תאריך',
    type: 'date',
    value: new Date().toISOString().slice(0, 10)
  });
  const placeField = createInputField({
    id: 'av2-place',
    label: 'מקום',
    placeholder: 'לדוגמה: בית ספר הרצל'
  });
  const hoursField = createInputField({
    id: 'av2-hours',
    label: 'שעות',
    type: 'number',
    attrs: { min: '0', step: '0.5' }
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'av2-btn av2-btn--primary av2-report__save';
  const saveLabel = document.createElement('span');
  saveLabel.textContent = 'שמירת דיווח';
  saveBtn.append(createIcon('check'), saveLabel);

  form.append(typeField.wrap, dateField.wrap, placeField.wrap, hoursField.wrap, saveBtn);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onSave?.({
      activityType: typeField.input.value || activityTypes[0] || '',
      date: dateField.input.value || new Date().toISOString().slice(0, 10),
      place: placeField.input.value.trim() || '—',
      hours: Number(hoursField.input.value) || 0
    });
  });

  inner.append(header, form);
  wrap.append(inner);
  container.append(wrap);
}

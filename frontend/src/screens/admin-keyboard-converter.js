import { state } from '../state.js';

const STYLE_ID = 'admin-keyboard-converter-styles';
const DIALOG_SELECTOR = '[data-admin-keyboard-converter-dialog]';

const KEYBOARD_MAP = Object.freeze({
  q: '/', w: "'", e: 'ק', r: 'ר', t: 'א', y: 'ט', u: 'ו', i: 'ן', o: 'ם', p: 'פ',
  a: 'ש', s: 'ד', d: 'ג', f: 'כ', g: 'ע', h: 'י', j: 'ח', k: 'ל', l: 'ך',
  z: 'ז', x: 'ס', c: 'ב', v: 'ה', b: 'נ', n: 'מ', m: 'צ',

  Q: '/', W: "'", E: 'ק', R: 'ר', T: 'א', Y: 'ט', U: 'ו', I: 'ן', O: 'ם', P: 'פ',
  A: 'ש', S: 'ד', D: 'ג', F: 'כ', G: 'ע', H: 'י', J: 'ח', K: 'ל', L: 'ך',
  Z: 'ז', X: 'ס', C: 'ב', V: 'ה', B: 'נ', N: 'מ', M: 'צ',

  '`': ';', '~': '~',
  '1': '1', '!': '!',
  '2': '2', '@': '@',
  '3': '3', '#': '#',
  '4': '4', '$': '$',
  '5': '5', '%': '%',
  '6': '6', '^': '^',
  '7': '7', '&': '&',
  '8': '8', '*': '*',
  '9': '9', '(': '(',
  '0': '0', ')': ')',
  '-': '-', '_': '_',
  '=': '=', '+': '+',
  '[': ']', '{': '}',
  ']': '[', '}': '{',
  '\\': '\\', '|': '|',
  ';': 'ף', ':': ':',
  "'": ',', '"': '"',
  ',': 'ת', '<': '<',
  '.': 'ץ', '>': '>',
  '/': '.', '?': '?'
});

function isAdmin() {
  return String(state?.user?.role || state?.user?.display_role || '').trim() === 'admin';
}

export function convertKeyboardText(text = '') {
  return [...String(text ?? '')]
    .map((character) => (
      Object.prototype.hasOwnProperty.call(KEYBOARD_MAP, character)
        ? KEYBOARD_MAP[character]
        : character
    ))
    .join('');
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .admin-keyboard-converter {
      width: min(92vw, 620px);
      max-width: 620px;
      margin: auto;
      padding: 0;
      border: 1px solid var(--color-border, #dbe3ec);
      border-radius: 18px;
      background: var(--color-surface, #fff);
      color: var(--color-text, #172033);
      box-shadow: 0 22px 60px rgba(15, 23, 42, .22);
      overflow: hidden;
    }
    .admin-keyboard-converter::backdrop {
      background: rgba(15, 23, 42, .26);
      backdrop-filter: blur(2px);
    }
    .admin-keyboard-converter__shell {
      display: flex;
      flex-direction: column;
      max-height: min(86vh, 760px);
    }
    .admin-keyboard-converter__header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 22px 12px;
      border-bottom: 1px solid var(--color-border, #e2e8f0);
    }
    .admin-keyboard-converter__title {
      margin: 0;
      font-size: 20px;
      line-height: 1.25;
      font-weight: 850;
    }
    .admin-keyboard-converter__subtitle {
      margin: 5px 0 0;
      color: var(--color-text-secondary, #64748b);
      font-size: 13px;
      line-height: 1.45;
    }
    .admin-keyboard-converter__close {
      appearance: none;
      width: 34px;
      height: 34px;
      flex: 0 0 34px;
      display: grid;
      place-items: center;
      padding: 0;
      border: 1px solid var(--color-border, #dbe3ec);
      border-radius: 10px;
      background: var(--color-surface-muted, #f8fafc);
      color: var(--color-text-secondary, #64748b);
      cursor: pointer;
      font: inherit;
      font-size: 20px;
      line-height: 1;
    }
    .admin-keyboard-converter__body {
      padding: 14px 22px 16px;
      overflow: auto;
    }
    .admin-keyboard-converter__field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .admin-keyboard-converter__field + .admin-keyboard-converter__field {
      margin-top: 12px;
    }
    .admin-keyboard-converter__label-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .admin-keyboard-converter__label {
      font-size: 13px;
      font-weight: 800;
      color: var(--color-text, #172033);
    }
    .admin-keyboard-converter__textarea {
      width: 100%;
      height: 92px;
      min-height: 92px;
      box-sizing: border-box;
      padding: 10px 12px;
      border: 1px solid var(--color-border, #cbd5e1);
      border-radius: 12px;
      background: var(--color-surface, #fff);
      color: var(--color-text, #172033);
      font: inherit;
      font-size: 15px;
      line-height: 1.55;
      resize: vertical;
      outline: none;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    .admin-keyboard-converter__textarea:focus {
      border-color: var(--color-primary, #0ea5e9);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #0ea5e9) 14%, transparent);
    }
    .admin-keyboard-converter__textarea--input {
      direction: ltr;
      text-align: left;
    }
    .admin-keyboard-converter__textarea--output {
      direction: rtl;
      text-align: right;
      background: color-mix(in srgb, var(--color-primary, #0ea5e9) 5%, var(--color-surface, #fff));
    }
    .admin-keyboard-converter__button {
      appearance: none;
      height: 38px;
      min-width: 0;
      padding: 0 15px;
      border: 1px solid transparent;
      border-radius: 10px;
      background: var(--color-primary, #0ea5e9);
      color: #fff;
      cursor: pointer;
      font: inherit;
      font-size: 12.5px;
      font-weight: 800;
      white-space: nowrap;
      transition: opacity .15s ease, border-color .15s ease, background .15s ease;
    }
    .admin-keyboard-converter__button:hover:not(:disabled) {
      opacity: .9;
    }
    .admin-keyboard-converter__button:focus-visible,
    .admin-keyboard-converter__close:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--color-primary, #0ea5e9) 18%, transparent);
      outline-offset: 2px;
    }
    .admin-keyboard-converter__button:disabled {
      opacity: .42;
      cursor: not-allowed;
    }
    .admin-keyboard-converter__button--secondary {
      border-color: var(--color-border, #dbe3ec);
      background: var(--color-surface-muted, #f8fafc);
      color: var(--color-text, #172033);
    }
    .admin-keyboard-converter__paste {
      height: 34px;
      padding-inline: 13px;
    }
    .admin-keyboard-converter__actions {
      display: flex;
      align-items: center;
      gap: 9px;
      margin-top: 12px;
    }
    .admin-keyboard-converter__actions .admin-keyboard-converter__button {
      width: 132px;
      padding-inline: 10px;
    }
    .admin-keyboard-converter__status {
      min-height: 16px;
      margin: 8px 0 0;
      color: var(--color-text-secondary, #64748b);
      font-size: 12px;
      line-height: 1.35;
    }
    .admin-keyboard-converter__status.is-success {
      color: #15803d;
    }
    .admin-keyboard-converter__status.is-error {
      color: #b42318;
    }
    @media (max-width: 560px) {
      .admin-keyboard-converter__header,
      .admin-keyboard-converter__body {
        padding-inline: 16px;
      }
      .admin-keyboard-converter__textarea {
        height: 86px;
        min-height: 86px;
      }
      .admin-keyboard-converter__actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
      }
      .admin-keyboard-converter__actions .admin-keyboard-converter__button {
        width: 100%;
      }
    }
  `;

  document.head.appendChild(style);
}

function setStatus(statusNode, message = '', type = '') {
  if (!statusNode) return;
  statusNode.textContent = message;
  statusNode.classList.toggle('is-success', type === 'success');
  statusNode.classList.toggle('is-error', type === 'error');
}

async function copyTextToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('copy failed');
}

function bindDialog(dialog) {
  const input = dialog.querySelector('[data-keyboard-converter-input]');
  const output = dialog.querySelector('[data-keyboard-converter-output]');
  const pasteButton = dialog.querySelector('[data-keyboard-converter-paste]');
  const copyButton = dialog.querySelector('[data-keyboard-converter-copy]');
  const clearButton = dialog.querySelector('[data-keyboard-converter-clear]');
  const closeButton = dialog.querySelector('[data-keyboard-converter-close]');
  const status = dialog.querySelector('[data-keyboard-converter-status]');

  const updateOutput = () => {
    const converted = convertKeyboardText(input?.value || '');
    if (output) output.value = converted;
    if (copyButton) copyButton.disabled = converted.length === 0;
    setStatus(status);
  };

  input?.addEventListener('input', updateOutput);

  pasteButton?.addEventListener('click', async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.readText || !window.isSecureContext) {
        throw new Error('clipboard read unavailable');
      }

      const text = await navigator.clipboard.readText();
      if (input) input.value = text;
      updateOutput();
      setStatus(status, text ? 'הטקסט הודבק והומר' : 'לוח ההעתקה ריק', text ? 'success' : '');
      input?.focus();
    } catch {
      input?.focus();
      setStatus(status, 'לא ניתן להדביק אוטומטית. לחצו Ctrl+V כדי להדביק.', 'error');
    }
  });

  copyButton?.addEventListener('click', async () => {
    const text = output?.value || '';
    if (!text) return;

    try {
      await copyTextToClipboard(text);
      setStatus(status, 'התוצאה הועתקה ✓', 'success');
    } catch {
      setStatus(status, 'לא ניתן להעתיק אוטומטית.', 'error');
    }
  });

  clearButton?.addEventListener('click', () => {
    if (input) input.value = '';
    if (output) output.value = '';
    if (copyButton) copyButton.disabled = true;
    setStatus(status);
    input?.focus();
  });

  closeButton?.addEventListener('click', () => dialog.close());

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  updateOutput();
}

export function openAdminKeyboardConverter() {
  if (!isAdmin() || typeof document === 'undefined') return;

  const existing = document.querySelector(DIALOG_SELECTOR);
  if (existing) {
    if (!existing.open) existing.showModal?.();
    requestAnimationFrame(() => existing.querySelector('[data-keyboard-converter-input]')?.focus());
    return;
  }

  ensureStyles();

  const dialog = document.createElement('dialog');
  dialog.className = 'admin-keyboard-converter';
  dialog.dir = 'rtl';
  dialog.dataset.adminKeyboardConverterDialog = 'true';
  dialog.innerHTML = `
    <div class="admin-keyboard-converter__shell">
      <header class="admin-keyboard-converter__header">
        <div>
          <h2 class="admin-keyboard-converter__title">ממיר מקלדת</h2>
          <p class="admin-keyboard-converter__subtitle">שוב הקלדת בעברית כשה-CAPS LOCK היה פעיל? ⌨️</p>
        </div>
        <button type="button" class="admin-keyboard-converter__close" data-keyboard-converter-close aria-label="סגירה">×</button>
      </header>

      <div class="admin-keyboard-converter__body">
        <div class="admin-keyboard-converter__field">
          <div class="admin-keyboard-converter__label-row">
            <label class="admin-keyboard-converter__label" for="admin-keyboard-converter-input">הקלידו את הטקסט</label>
            <button type="button" class="admin-keyboard-converter__button admin-keyboard-converter__button--secondary admin-keyboard-converter__paste" data-keyboard-converter-paste>הדבק</button>
          </div>
          <textarea
            id="admin-keyboard-converter-input"
            class="admin-keyboard-converter__textarea admin-keyboard-converter__textarea--input"
            dir="ltr"
            spellcheck="false"
            autocorrect="off"
            autocapitalize="off"
            autocomplete="off"
            data-keyboard-converter-input
          ></textarea>
        </div>

        <div class="admin-keyboard-converter__field">
          <label class="admin-keyboard-converter__label" for="admin-keyboard-converter-output">הטקסט המתוקן בעברית:</label>
          <textarea
            id="admin-keyboard-converter-output"
            class="admin-keyboard-converter__textarea admin-keyboard-converter__textarea--output"
            dir="rtl"
            readonly
            spellcheck="false"
            data-keyboard-converter-output
          ></textarea>
        </div>

        <div class="admin-keyboard-converter__actions">
          <button type="button" class="admin-keyboard-converter__button" data-keyboard-converter-copy disabled>העתקת התוצאה</button>
          <button type="button" class="admin-keyboard-converter__button admin-keyboard-converter__button--secondary" data-keyboard-converter-clear>ניקוי</button>
        </div>

        <p class="admin-keyboard-converter__status" data-keyboard-converter-status role="status" aria-live="polite"></p>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);
  bindDialog(dialog);
  dialog.showModal?.();
  requestAnimationFrame(() => dialog.querySelector('[data-keyboard-converter-input]')?.focus());
}
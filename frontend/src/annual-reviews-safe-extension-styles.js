const STYLE_ID = 'annual-reviews-safe-extension-styles';

if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #app .ar-safe-extra {
      display: grid;
      gap: 12px;
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--ds-border, #d9dee7);
    }
    #app .ar-safe-extra > h3 { margin: 0; font-size: 1rem; }
    #app .ar-safe-save {
      min-height: 18px;
      color: var(--ds-text-muted, #64748b);
      font-size: .78rem;
    }
    #app .ar-safe-error { color: #b91c1c; }
  `;
  document.head.appendChild(style);
}

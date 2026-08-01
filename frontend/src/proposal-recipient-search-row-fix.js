function ensureRecipientNativeFlowStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('proposal-recipient-native-flow-style')) return;

  const style = document.createElement('style');
  style.id = 'proposal-recipient-native-flow-style';
  style.textContent = `
    /* Keep the original recipient search DOM and event handlers intact. */
    #app .pa-editor-workspace .ds-pa-form-meta-panel {
      display: grid !important;
      grid-template-columns: max-content minmax(360px, 430px) !important;
      grid-template-rows: auto auto auto !important;
      column-gap: 12px !important;
      row-gap: 8px !important;
      justify-content: start !important;
      align-items: start !important;
      inline-size: fit-content !important;
      max-inline-size: 100% !important;
      min-block-size: 0 !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace .ds-pa-form-meta-panel > .pa-sidebar-section-title {
      grid-column: 1 / -1 !important;
      grid-row: 1 !important;
      inline-size: 100% !important;
      margin: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] {
      grid-column: 1 !important;
      grid-row: 2 !important;
      align-self: end !important;
      margin: 0 !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace [data-pa-step-panel="client"] {
      display: contents !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-row]:not([hidden]) {
      grid-column: 2 !important;
      grid-row: 2 !important;
      align-self: end !important;
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) !important;
      inline-size: 430px !important;
      max-inline-size: 430px !important;
      min-block-size: 0 !important;
      gap: 6px !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-row][hidden] {
      display: none !important;
    }

    #app .pa-editor-workspace [data-pa-client-card]:not([hidden]) {
      grid-column: 2 !important;
      grid-row: 2 !important;
      align-self: end !important;
      display: block !important;
      inline-size: 430px !important;
      max-inline-size: 430px !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace [data-pa-client-card][hidden] {
      display: none !important;
    }

    #app .pa-editor-workspace [data-pa-step-panel="contact"] {
      grid-column: 1 / -1 !important;
      grid-row: 3 !important;
      inline-size: fit-content !important;
      max-inline-size: 100% !important;
      margin: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-step-panel="contact"][hidden] {
      display: none !important;
    }

    #app .pa-editor-workspace .ds-pa-client-search {
      display: block !important;
      inline-size: 430px !important;
      max-inline-size: 430px !important;
      min-block-size: 0 !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-field-wrap],
    #app .pa-editor-workspace [data-pa-school-search-field-wrap] {
      position: relative !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-field-wrap] {
      inline-size: 300px !important;
      max-inline-size: 300px !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-field-wrap] > label,
    #app .pa-editor-workspace [data-pa-client-search-field-wrap] input {
      inline-size: 300px !important;
      max-inline-size: 300px !important;
      margin: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-school-search-panel]:not([hidden]) {
      display: grid !important;
      grid-template-columns: max-content 270px !important;
      align-items: end !important;
      justify-content: start !important;
      gap: 8px !important;
      inline-size: 430px !important;
      max-inline-size: 430px !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace [data-pa-school-search-panel][hidden] {
      display: none !important;
    }

    #app .pa-editor-workspace .ds-pa-school-step-text {
      display: inline-flex !important;
      flex-flow: row nowrap !important;
      align-items: center !important;
      gap: 5px !important;
      min-block-size: 36px !important;
      margin: 0 !important;
      padding: 0 !important;
      white-space: nowrap !important;
    }

    #app .pa-editor-workspace [data-pa-school-search-field-wrap],
    #app .pa-editor-workspace [data-pa-school-search-field-wrap] > label,
    #app .pa-editor-workspace [data-pa-school-search-field-wrap] input {
      inline-size: 270px !important;
      max-inline-size: 270px !important;
      margin: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-client-results],
    #app .pa-editor-workspace [data-pa-school-results] {
      position: absolute !important;
      inset-inline: 0 !important;
      inset-block-start: calc(100% + 4px) !important;
      z-index: 2000 !important;
      inline-size: 100% !important;
      max-inline-size: none !important;
      max-block-size: 240px !important;
      overflow-x: hidden !important;
      overflow-y: auto !important;
      background: #fff !important;
      border: 1px solid var(--pa-editor-line, #dbe4ee) !important;
      border-radius: 9px !important;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16) !important;
    }

    #app .pa-editor-workspace [data-pa-client-results][hidden],
    #app .pa-editor-workspace [data-pa-school-results][hidden] {
      display: none !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked {
      inline-size: 430px !important;
      max-inline-size: 430px !important;
      overflow: visible !important;
    }

    @media (max-width: 1180px) {
      #app .pa-editor-workspace .ds-pa-form-meta-panel {
        grid-template-columns: max-content minmax(330px, 390px) !important;
      }

      #app .pa-editor-workspace [data-pa-client-search-row]:not([hidden]),
      #app .pa-editor-workspace [data-pa-client-card]:not([hidden]),
      #app .pa-editor-workspace .ds-pa-client-search,
      #app .pa-editor-workspace [data-pa-school-search-panel]:not([hidden]),
      #app .pa-editor-workspace .ds-pa-client-locked {
        inline-size: 390px !important;
        max-inline-size: 390px !important;
      }

      #app .pa-editor-workspace [data-pa-school-search-panel]:not([hidden]) {
        grid-template-columns: max-content 240px !important;
      }

      #app .pa-editor-workspace [data-pa-school-search-field-wrap],
      #app .pa-editor-workspace [data-pa-school-search-field-wrap] > label,
      #app .pa-editor-workspace [data-pa-school-search-field-wrap] input {
        inline-size: 240px !important;
        max-inline-size: 240px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

ensureRecipientNativeFlowStyles();

export { ensureRecipientNativeFlowStyles };

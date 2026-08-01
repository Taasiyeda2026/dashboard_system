function ensureRecipientFinalLayoutStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('proposal-recipient-final-layout-style')) return;

  const style = document.createElement('style');
  style.id = 'proposal-recipient-final-layout-style';
  style.textContent = `
    /* Final recipient editor layout: one outer box, one label per field, no DOM movement. */
    #app .pa-editor-workspace .ds-pa-form-meta-panel {
      --pa-recipient-control-height: 42px;
      --pa-recipient-border: #cbd5e1;
      display: grid !important;
      grid-template-columns: 180px 130px 288px minmax(360px, 430px) !important;
      grid-template-rows: auto auto auto !important;
      column-gap: 10px !important;
      row-gap: 10px !important;
      justify-content: start !important;
      align-items: end !important;
      inline-size: 100% !important;
      max-inline-size: 100% !important;
      min-block-size: 0 !important;
      padding: 12px 14px !important;
      box-sizing: border-box !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace .ds-pa-form-meta-panel > .pa-sidebar-section-title {
      grid-column: 1 / -1 !important;
      grid-row: 1 !important;
      inline-size: 100% !important;
      margin: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] {
      display: contents !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] > label:has(input[name="proposal_date"]) {
      grid-column: 1 !important;
      grid-row: 2 !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] > label:has(select[name="proposal_domain"]) {
      grid-column: 2 !important;
      grid-row: 2 !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] > .ds-pa-recipient-type-field {
      grid-column: 3 !important;
      grid-row: 2 !important;
      display: grid !important;
      gap: 4px !important;
      inline-size: 288px !important;
      max-inline-size: 288px !important;
      margin: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] > .ds-pa-recipient-type-field[hidden],
    #app .pa-editor-workspace [data-pa-recipient-meta-row] .ds-pa-recipient-type[hidden] {
      display: grid !important;
    }

    #app .pa-editor-workspace [data-pa-step-panel="client"],
    #app .pa-editor-workspace [data-pa-client-search-row] {
      display: contents !important;
    }

    #app .pa-editor-workspace .ds-pa-client-search-block > .ds-pa-recipient-type-field:not(:has(.ds-pa-recipient-type)),
    #app .pa-editor-workspace .ds-pa-client-search-block > .ds-pa-recipient-type-label {
      display: none !important;
    }

    #app .pa-editor-workspace .ds-pa-client-search,
    #app .pa-editor-workspace [data-pa-client-card]:not([hidden]),
    #app .pa-editor-workspace [data-pa-other-client-field]:not([hidden]) {
      grid-column: 4 !important;
      grid-row: 2 !important;
      align-self: end !important;
      inline-size: 430px !important;
      max-inline-size: 430px !important;
      min-block-size: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace [data-pa-client-card][hidden],
    #app .pa-editor-workspace [data-pa-other-client-field][hidden],
    #app .pa-editor-workspace [data-pa-step-panel="contact"][hidden] {
      display: none !important;
    }

    #app .pa-editor-workspace [data-pa-step-panel="contact"]:not([hidden]) {
      grid-column: 1 / -1 !important;
      grid-row: 3 !important;
      inline-size: fit-content !important;
      max-inline-size: 100% !important;
      margin: 0 !important;
      padding-block-start: 9px !important;
      border: 0 !important;
      border-block-start: 1px solid var(--pa-editor-line, #dbe4ee) !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] .ds-pa-form-field,
    #app .pa-editor-workspace [data-pa-client-search-row] .ds-pa-form-field {
      gap: 4px !important;
      margin: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] .ds-pa-form-field > span,
    #app .pa-editor-workspace [data-pa-client-search-row] .ds-pa-form-field > span,
    #app .pa-editor-workspace .ds-pa-recipient-type-label {
      min-block-size: 18px !important;
      margin: 0 !important;
      padding: 0 !important;
      font-size: 13px !important;
      line-height: 18px !important;
      font-weight: 700 !important;
      color: #475569 !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] input[name="proposal_date"],
    #app .pa-editor-workspace [data-pa-recipient-meta-row] select[name="proposal_domain"],
    #app .pa-editor-workspace [data-pa-client-search-input],
    #app .pa-editor-workspace [data-pa-school-search-input],
    #app .pa-editor-workspace [data-pa-other-client-field] input,
    #app .pa-editor-workspace .ds-pa-recipient-type-option,
    #app .pa-editor-workspace [data-pa-change-authority-step],
    #app .pa-editor-workspace .ds-pa-client-locked-actions .ds-btn {
      block-size: var(--pa-recipient-control-height) !important;
      min-block-size: var(--pa-recipient-control-height) !important;
      box-sizing: border-box !important;
      border: 1px solid var(--pa-recipient-border) !important;
      border-radius: 10px !important;
      background: #fff !important;
      box-shadow: none !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] input[name="proposal_date"] {
      inline-size: 180px !important;
      max-inline-size: 180px !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] select[name="proposal_domain"] {
      inline-size: 130px !important;
      max-inline-size: 130px !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] .ds-pa-recipient-type {
      display: grid !important;
      grid-template-columns: repeat(3, 92px) !important;
      grid-auto-rows: var(--pa-recipient-control-height) !important;
      inline-size: 288px !important;
      max-inline-size: 288px !important;
      gap: 6px !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] .ds-pa-recipient-type-option {
      inline-size: 92px !important;
      min-inline-size: 92px !important;
      padding: 0 10px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      text-align: center !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] .ds-pa-recipient-type-option:has(input:checked) {
      border-color: #64748b !important;
      background: #f8fafc !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-field-wrap],
    #app .pa-editor-workspace [data-pa-school-search-field-wrap] {
      position: relative !important;
      inline-size: 430px !important;
      max-inline-size: 430px !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-field-wrap] > label,
    #app .pa-editor-workspace [data-pa-client-search-input] {
      inline-size: 430px !important;
      max-inline-size: 430px !important;
      margin: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-school-search-panel]:not([hidden]) {
      display: grid !important;
      grid-template-columns: 150px 270px !important;
      align-items: end !important;
      justify-content: start !important;
      gap: 10px !important;
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
      align-items: end !important;
      justify-content: flex-start !important;
      gap: 5px !important;
      min-block-size: var(--pa-recipient-control-height) !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      white-space: nowrap !important;
    }

    #app .pa-editor-workspace [data-pa-change-authority-step] {
      inline-size: 72px !important;
      min-inline-size: 72px !important;
      margin: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-school-search-field-wrap],
    #app .pa-editor-workspace [data-pa-school-search-field-wrap] > label,
    #app .pa-editor-workspace [data-pa-school-search-input] {
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
      border: 1px solid var(--pa-recipient-border) !important;
      border-radius: 10px !important;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16) !important;
    }

    #app .pa-editor-workspace [data-pa-client-results][hidden],
    #app .pa-editor-workspace [data-pa-school-results][hidden] {
      display: none !important;
    }

    #app .pa-editor-workspace [data-pa-client-card]:not([hidden]) {
      display: block !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked {
      display: grid !important;
      grid-template-columns: 90px 170px 80px 72px !important;
      align-items: end !important;
      gap: 6px !important;
      inline-size: 430px !important;
      max-inline-size: 430px !important;
      min-block-size: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-body,
    #app .pa-editor-workspace .ds-pa-client-locked-actions {
      display: contents !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-type {
      display: none !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-detail {
      grid-column: 1 !important;
      grid-row: 1 !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-name {
      grid-column: 2 !important;
      grid-row: 1 !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-state {
      grid-column: 3 !important;
      grid-row: 1 !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-actions {
      grid-column: 4 !important;
      grid-row: 1 !important;
      align-self: end !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked p {
      min-inline-size: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked p > span,
    #app .pa-editor-workspace .ds-pa-client-locked p > strong {
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked.is-authority {
      grid-template-columns: 1fr 72px !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked.is-authority .ds-pa-client-locked-detail {
      grid-column: 1 !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked.is-authority .ds-pa-client-locked-name,
    #app .pa-editor-workspace .ds-pa-client-locked.is-authority .ds-pa-client-locked-state {
      display: none !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked.is-authority .ds-pa-client-locked-actions {
      grid-column: 2 !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-actions .ds-btn {
      inline-size: 72px !important;
      min-inline-size: 72px !important;
      margin: 0 !important;
      padding: 0 8px !important;
    }

    @media (max-width: 1120px) {
      #app .pa-editor-workspace .ds-pa-form-meta-panel {
        grid-template-columns: 160px 120px 276px minmax(320px, 360px) !important;
        column-gap: 8px !important;
      }

      #app .pa-editor-workspace [data-pa-recipient-meta-row] > label:has(input[name="proposal_date"]),
      #app .pa-editor-workspace [data-pa-recipient-meta-row] input[name="proposal_date"] {
        inline-size: 160px !important;
        max-inline-size: 160px !important;
      }

      #app .pa-editor-workspace [data-pa-recipient-meta-row] > label:has(select[name="proposal_domain"]),
      #app .pa-editor-workspace [data-pa-recipient-meta-row] select[name="proposal_domain"] {
        inline-size: 120px !important;
        max-inline-size: 120px !important;
      }

      #app .pa-editor-workspace [data-pa-recipient-meta-row] > .ds-pa-recipient-type-field,
      #app .pa-editor-workspace [data-pa-recipient-meta-row] .ds-pa-recipient-type {
        inline-size: 276px !important;
        max-inline-size: 276px !important;
      }

      #app .pa-editor-workspace [data-pa-recipient-meta-row] .ds-pa-recipient-type {
        grid-template-columns: repeat(3, 88px) !important;
      }

      #app .pa-editor-workspace [data-pa-recipient-meta-row] .ds-pa-recipient-type-option {
        inline-size: 88px !important;
        min-inline-size: 88px !important;
      }

      #app .pa-editor-workspace .ds-pa-client-search,
      #app .pa-editor-workspace [data-pa-client-card]:not([hidden]),
      #app .pa-editor-workspace [data-pa-other-client-field]:not([hidden]),
      #app .pa-editor-workspace [data-pa-client-search-field-wrap],
      #app .pa-editor-workspace [data-pa-client-search-field-wrap] > label,
      #app .pa-editor-workspace [data-pa-client-search-input],
      #app .pa-editor-workspace .ds-pa-client-locked {
        inline-size: 360px !important;
        max-inline-size: 360px !important;
      }

      #app .pa-editor-workspace [data-pa-school-search-panel]:not([hidden]) {
        grid-template-columns: 120px 230px !important;
        inline-size: 360px !important;
        max-inline-size: 360px !important;
      }

      #app .pa-editor-workspace [data-pa-school-search-field-wrap],
      #app .pa-editor-workspace [data-pa-school-search-field-wrap] > label,
      #app .pa-editor-workspace [data-pa-school-search-input] {
        inline-size: 230px !important;
        max-inline-size: 230px !important;
      }

      #app .pa-editor-workspace .ds-pa-client-locked {
        grid-template-columns: 75px 135px 72px 60px !important;
      }

      #app .pa-editor-workspace .ds-pa-client-locked-actions .ds-btn {
        inline-size: 60px !important;
        min-inline-size: 60px !important;
      }
    }

    @media (max-width: 900px) {
      #app .pa-editor-workspace .ds-pa-form-meta-panel {
        grid-template-columns: 160px 120px 276px !important;
        grid-template-rows: auto auto auto auto !important;
      }

      #app .pa-editor-workspace .ds-pa-client-search,
      #app .pa-editor-workspace [data-pa-client-card]:not([hidden]),
      #app .pa-editor-workspace [data-pa-other-client-field]:not([hidden]) {
        grid-column: 1 / -1 !important;
        grid-row: 3 !important;
      }

      #app .pa-editor-workspace [data-pa-step-panel="contact"]:not([hidden]) {
        grid-row: 4 !important;
      }
    }
  `;
  document.head.appendChild(style);
}

ensureRecipientFinalLayoutStyles();

export { ensureRecipientFinalLayoutStyles };

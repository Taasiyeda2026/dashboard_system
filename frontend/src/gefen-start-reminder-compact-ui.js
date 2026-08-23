const STYLE_ID = 'gefen-start-reminder-compact-ui';

function installGefenCompactUi() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .gefen-start-reminder-overlay {
      padding: 16px !important;
      background: rgba(15, 23, 42, 0.50) !important;
      backdrop-filter: blur(1px) !important;
    }

    .gefen-start-reminder-dialog {
      width: min(560px, calc(100vw - 28px)) !important;
      max-height: calc(100vh - 64px) !important;
      border-top-width: 4px !important;
      border-radius: 12px !important;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.25) !important;
    }

    .gefen-start-reminder-head {
      gap: 9px !important;
      padding: 15px 16px 11px !important;
    }

    .gefen-start-reminder-icon {
      flex-basis: 30px !important;
      width: 30px !important;
      height: 30px !important;
      font-size: 17px !important;
    }

    .gefen-start-reminder-title {
      font-size: 18px !important;
      line-height: 1.3 !important;
    }

    .gefen-start-reminder-subtitle {
      margin-top: 3px !important;
      font-size: 12.5px !important;
      line-height: 1.4 !important;
    }

    .gefen-start-reminder-body {
      padding: 12px 16px 14px !important;
    }

    .gefen-start-reminder-table-wrap {
      margin-bottom: 12px !important;
      max-height: min(34vh, 240px) !important;
      border-radius: 8px !important;
    }

    .gefen-start-reminder-table {
      min-width: 0 !important;
      table-layout: fixed !important;
      font-size: 12.5px !important;
      line-height: 1.35 !important;
    }

    .gefen-start-reminder-table th,
    .gefen-start-reminder-table td {
      padding: 7px 8px !important;
      overflow-wrap: anywhere !important;
    }

    .gefen-start-reminder-table th:nth-child(1) { width: 25%; }
    .gefen-start-reminder-table th:nth-child(2) { width: 19%; }
    .gefen-start-reminder-table th:nth-child(3) { width: 29%; }
    .gefen-start-reminder-table th:nth-child(4) { width: 27%; }

    .gefen-start-reminder-table td:last-child {
      white-space: nowrap !important;
      font-variant-numeric: tabular-nums;
    }

    .gefen-start-reminder-question {
      margin: 0 0 11px !important;
      padding: 10px 0 !important;
      font-size: 14px !important;
      line-height: 1.5 !important;
      font-weight: 750 !important;
    }

    .gefen-start-reminder-action {
      width: auto !important;
      min-width: 148px !important;
      min-height: 34px !important;
      height: 34px !important;
      padding: 0 14px !important;
      align-self: flex-start !important;
      border-radius: 7px !important;
      font-size: 12.5px !important;
      line-height: 34px !important;
      box-shadow: none !important;
    }

    .gefen-start-reminder-error {
      min-height: 0 !important;
      margin-top: 7px !important;
      font-size: 12px !important;
    }

    @media (max-width: 600px) {
      .gefen-start-reminder-overlay {
        padding: 10px !important;
        align-items: center !important;
      }

      .gefen-start-reminder-dialog {
        width: calc(100vw - 20px) !important;
        margin-top: 0 !important;
        max-height: calc(100vh - 20px) !important;
      }

      .gefen-start-reminder-head {
        padding: 13px 14px 10px !important;
      }

      .gefen-start-reminder-body {
        padding: 10px 14px 13px !important;
      }

      .gefen-start-reminder-title {
        font-size: 17px !important;
      }

      .gefen-start-reminder-subtitle {
        font-size: 12px !important;
      }

      .gefen-start-reminder-table {
        font-size: 11.5px !important;
      }

      .gefen-start-reminder-table th,
      .gefen-start-reminder-table td {
        padding: 6px !important;
      }

      .gefen-start-reminder-question {
        font-size: 13.5px !important;
      }

      .gefen-start-reminder-action {
        min-width: 140px !important;
        height: 34px !important;
      }
    }
  `;

  document.head.appendChild(style);
}

installGefenCompactUi();

export { installGefenCompactUi };

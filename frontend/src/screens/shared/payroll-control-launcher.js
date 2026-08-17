const PAYROLL_CONTROL_ROLES = new Set(['admin', 'operation_manager', 'finance']);

function canOpenPayrollControl(state = {}) {
  return PAYROLL_CONTROL_ROLES.has(String(state?.user?.role || '').trim());
}

/**
 * Open the existing payroll-control interface in a dedicated window.
 * Keep the window.open call synchronous so browsers treat it as part of the user's click,
 * then lazy-load the existing payroll-control modules to keep Node/shared-nav imports browser-safe.
 */
export function openPayrollControlWindow(state = {}) {
  if (!canOpenPayrollControl(state)) {
    throw new Error('אין הרשאה לפתוח את בקרת השכר.');
  }

  const popup = window.open('', 'dashboard-payroll-control');
  if (!popup) {
    throw new Error('הדפדפן חסם את פתיחת חלון בקרת השכר. יש לאפשר חלונות קופצים ולנסות שוב.');
  }

  popup.document.title = 'בקרת שכר';
  popup.document.documentElement.lang = 'he';
  popup.document.body.innerHTML = '<main dir="rtl" style="padding:24px;font-family:Arial,sans-serif">טוען בקרת שכר…</main>';
  popup.focus();

  void Promise.all([
    import('../../api.js'),
    import('../attendance-control.js')
  ]).then(([apiModule, attendanceModule]) => {
    const { api } = apiModule;
    const {
      attendanceControlHtml,
      attendanceControlStylesHtml,
      bindAttendanceControl
    } = attendanceModule;

    popup.document.body.innerHTML = `<main data-payroll-window>${attendanceControlStylesHtml()}${attendanceControlHtml()}</main>`;
    popup.document.head.insertAdjacentHTML(
      'beforeend',
      '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:24px;background:#f1f5f9;font-family:Arial,sans-serif}.ds-input{box-sizing:border-box;padding:9px;border:1px solid #cbd5e1;border-radius:8px}.ds-btn{padding:9px 14px;border:1px solid #94a3b8;border-radius:8px;background:#fff;cursor:pointer}.ds-btn--primary{background:#2563eb;color:#fff}.ds-btn:disabled{opacity:.55;cursor:not-allowed}</style>'
    );

    const popupRoot = popup.document.querySelector('[data-payroll-window]');
    popupRoot.querySelector('[data-attendance-control]').hidden = false;
    bindAttendanceControl(popupRoot, { api, state, standalone: true });
    popup.focus();
  }).catch((error) => {
    try { popup.close(); } catch {}
    if (typeof window !== 'undefined') {
      window.alert(error?.message || 'פתיחת בקרת השכר נכשלה.');
    }
  });
}

import { api } from '../../api.js';
import {
  attendanceControlHtml,
  attendanceControlStylesHtml,
  bindAttendanceControl
} from '../attendance-control.js';

/**
 * Open the existing payroll-control interface in a dedicated window.
 * The control UI and all comparison logic stay in attendance-control.js.
 */
export function openPayrollControlWindow(state = {}) {
  const popup = window.open('', 'dashboard-payroll-control');
  if (!popup) {
    throw new Error('הדפדפן חסם את פתיחת חלון בקרת השכר. יש לאפשר חלונות קופצים ולנסות שוב.');
  }

  popup.document.title = 'בקרת שכר';
  popup.document.documentElement.lang = 'he';
  popup.document.body.innerHTML = `<main data-payroll-window>${attendanceControlStylesHtml()}${attendanceControlHtml()}</main>`;
  popup.document.head.insertAdjacentHTML(
    'beforeend',
    '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:24px;background:#f1f5f9;font-family:Arial,sans-serif}.ds-input{box-sizing:border-box;padding:9px;border:1px solid #cbd5e1;border-radius:8px}.ds-btn{padding:9px 14px;border:1px solid #94a3b8;border-radius:8px;background:#fff;cursor:pointer}.ds-btn--primary{background:#2563eb;color:#fff}.ds-btn:disabled{opacity:.55;cursor:not-allowed}</style>'
  );

  const popupRoot = popup.document.querySelector('[data-payroll-window]');
  popupRoot.querySelector('[data-attendance-control]').hidden = false;
  bindAttendanceControl(popupRoot, { api, state, standalone: true });
  popup.focus();
}

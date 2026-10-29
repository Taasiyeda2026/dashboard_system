export function notifyWorkflowChanged() {
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('app:notifications-refresh'));
}

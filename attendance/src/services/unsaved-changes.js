const guards = new Set();
const message = 'יש שינויים שטרם נשמרו. לעזוב ללא שמירה? לחצו ביטול כדי לחזור ולשמור.';

// Only connected forms participate; discarded screens never leave stale guards.
function activeGuards() {
  return [...guards].filter(guard => {
    if (guard.root.isConnected) return true;
    guards.delete(guard);
    return false;
  });
}
export function confirmLeavingReports() {
  const active = activeGuards();
  if (active.some(guard=>guard.busy)) {
    window.alert('הפעולה עדיין מתבצעת. יש להמתין לתוצאה לפני מעבר.');
    return false;
  }
  if (active.some(guard=>guard.dirty) && !window.confirm(message)) return false;
  active.forEach(guard=>guard.markClean());
  return true;
}
if (typeof window !== 'undefined') window.addEventListener('beforeunload', event => {
  if (activeGuards().some(guard => guard.dirty || guard.busy)) {
    event.preventDefault();
    event.returnValue = '';
  }
});

export function createUnsavedChangesGuard(root, {ignore = () => false} = {}) {
  let busy = false;
  let controls = [];
  const guard = {
    root, dirty:false,
    get busy() { return busy; },
    set busy(value) {
      if (Boolean(value)===busy) return;
      busy=Boolean(value);
      if (busy) {
        controls=[...root.querySelectorAll('input,select,textarea,button')].map(control=>[control,control.disabled]);
        controls.forEach(([control])=>{control.disabled=true;});
      } else {
        controls.forEach(([control,disabled])=>{control.disabled=disabled;});
        controls=[];
      }
    },
    markClean() { guard.dirty=false; },
    markDirty() { guard.dirty=true; },
    confirmLeave() {
      if (guard.busy) {
        window.alert('הפעולה עדיין מתבצעת. יש להמתין לתוצאה לפני מעבר.');
        return false;
      }
      if (!guard.dirty) return true;
      if (!window.confirm(message)) return false;
      guard.markClean();
      return true;
    }
  };
  for (const name of ['input','change']) root.addEventListener(name, event => {
    if (!ignore(event.target)) guard.markDirty();
  });
  guards.add(guard);
  return guard;
}

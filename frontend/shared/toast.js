// ============================================================
// toast.js — Lightweight toast notifications
// ============================================================

let container = null;

function getContainer() {
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, type = "info", duration = 3500) {
  const c = getContainer();
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  c.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => toast.classList.add("toast--visible"));

  setTimeout(() => {
    toast.classList.remove("toast--visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, duration);
}

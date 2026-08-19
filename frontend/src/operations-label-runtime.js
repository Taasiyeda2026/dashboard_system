const SOURCE_LABEL = 'ניהול תפעול';
const TARGET_LABEL = 'תפעול';
const WATCHED_ATTRIBUTES = ['aria-label', 'title'];
let scheduled = false;

function replaceLabel(value) {
  const text = String(value || '');
  return text.includes(SOURCE_LABEL) ? text.split(SOURCE_LABEL).join(TARGET_LABEL) : text;
}

function updateTextNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  const current = node.nodeValue || '';
  const next = replaceLabel(current);
  if (next !== current) node.nodeValue = next;
}

function updateElement(element) {
  if (!(element instanceof Element)) return;
  WATCHED_ATTRIBUTES.forEach((attribute) => {
    if (!element.hasAttribute(attribute)) return;
    const current = element.getAttribute(attribute) || '';
    const next = replaceLabel(current);
    if (next !== current) element.setAttribute(attribute, next);
  });
}

function sync(root = document.getElementById('app') || document.body) {
  scheduled = false;
  if (!root) return;

  updateElement(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) updateTextNode(node);
    else updateElement(node);
    node = walker.nextNode();
  }
}

function scheduleSync() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => sync());
}

function start() {
  sync();
  const root = document.getElementById('app') || document.body;
  if (!root) return;

  const observer = new MutationObserver(scheduleSync);
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: WATCHED_ATTRIBUTES
  });
  document.addEventListener('app:navigate', scheduleSync);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

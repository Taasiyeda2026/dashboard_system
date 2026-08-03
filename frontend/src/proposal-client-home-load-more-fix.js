function clientHomeRoots(root) {
  if (!root) return [];
  const homes = [];
  if (root.nodeType === 1 && root.matches?.('[data-pa-client-home]')) homes.push(root);
  for (const home of root.querySelectorAll?.('[data-pa-client-home]') || []) homes.push(home);
  return homes;
}

export function removeClientHomeLoadMore(root = document) {
  let removed = 0;
  for (const home of clientHomeRoots(root)) {
    const buttons = Array.from(home.querySelectorAll?.('[data-pa-load-more-proposals]') || []);
    for (const button of buttons) {
      const wrapper = button.closest?.('[data-pa-load-more-wrap]');
      if (wrapper && home.contains(wrapper)) {
        wrapper.remove();
      } else {
        button.remove();
      }
      removed += 1;
    }
  }
  return removed;
}

export function installClientHomeLoadMoreFix(scope = globalThis) {
  if (scope.__dsClientHomeLoadMoreFixInstalled) return false;
  const documentRef = scope?.document;
  if (!documentRef) return false;
  scope.__dsClientHomeLoadMoreFixInstalled = true;

  const clean = (root = documentRef) => removeClientHomeLoadMore(root);
  if (documentRef.readyState === 'loading') {
    documentRef.addEventListener('DOMContentLoaded', () => clean(), { once: true });
  } else {
    clean();
  }

  if (typeof scope.MutationObserver === 'function') {
    const observer = new scope.MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) clean(node);
      }
    });
    observer.observe(documentRef.documentElement, { childList: true, subtree: true });
  }
  return true;
}

installClientHomeLoadMoreFix(globalThis);

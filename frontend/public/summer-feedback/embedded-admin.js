const params = new URLSearchParams(window.location.search);
const embedded = params.get('embedded') === '1';
const HEIGHT_MESSAGE_TYPE = 'summer-feedback:embedded-height';

function preserveEmbeddedLink(link) {
  if (!embedded || !link?.getAttribute('href')) return;
  try {
    const url = new URL(link.getAttribute('href'), window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;
    url.searchParams.set('embedded', '1');
    link.href = url.href;
  } catch {
    // Ignore malformed or non-navigation href values.
  }
}

function preserveEmbeddedLinks(root = document) {
  root.querySelectorAll?.('a[href]').forEach(preserveEmbeddedLink);
}

if (embedded) {
  document.documentElement.classList.add('summer-feedback-embedded');

  let scheduled = false;
  const reportHeight = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      preserveEmbeddedLinks();
      const height = Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight || 0,
        720
      );
      window.parent?.postMessage({ type: HEIGHT_MESSAGE_TYPE, height }, window.location.origin);
    });
  };

  window.addEventListener('load', reportHeight);
  window.addEventListener('resize', reportHeight);
  document.addEventListener('toggle', reportHeight, true);
  document.addEventListener('click', (event) => {
    preserveEmbeddedLink(event.target.closest?.('a[href]'));
  }, true);

  if ('ResizeObserver' in window) {
    const resizeObserver = new ResizeObserver(reportHeight);
    resizeObserver.observe(document.documentElement);
    if (document.body) resizeObserver.observe(document.body);
  }

  const mutationObserver = new MutationObserver(reportHeight);
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  reportHeight();
}

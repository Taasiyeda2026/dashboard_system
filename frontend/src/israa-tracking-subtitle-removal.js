function removeIsraaTrackingSubtitle() {
  document.querySelectorAll('.israa-v2__sub').forEach((element) => element.remove());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', removeIsraaTrackingSubtitle, { once: true });
} else {
  removeIsraaTrackingSubtitle();
}

new MutationObserver(removeIsraaTrackingSubtitle).observe(document.documentElement, {
  childList: true,
  subtree: true
});

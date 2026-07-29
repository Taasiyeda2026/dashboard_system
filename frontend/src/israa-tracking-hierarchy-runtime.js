// Compatibility entry kept for deployed bundles that still import this module.
// The Israa table hierarchy and drawer are now rendered from one source of truth in
// israa-tracking-v2-runtime.js; intentionally do not mutate its rows after render.
window.addEventListener('israa-tracking-updated', () => {});

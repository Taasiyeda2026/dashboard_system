import './operations-authorities-cleanup-base.js';

// 2027 operations tabs are now rendered by operations-management.js through the
// shared in-memory data manager. Legacy DOM repair modules remain as historical
// files but are intentionally not imported here to avoid MutationObserver or
// delayed post-render corrections on the 2027 tabs.

import { serializeSchedulingCacheEntry } from './course-scheduling-cache-serialization.js';
// Only disposable display-cache serialization runs here. No engine/DB/auth work.
self.onmessage = event => self.postMessage(serializeSchedulingCacheEntry(event.data));

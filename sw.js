/* Entry at site root: default scope is `/` so navigations and all same-origin assets are controlled. */
/* Keep the cache version in frontend/sw.js as the single manual SW version source. */
/* Query version forces browsers to re-import the updated worker immediately. */
importScripts(new URL('frontend/sw.js?v=1258', self.location).href);

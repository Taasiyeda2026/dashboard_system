/* Entry at site root: default scope is `/` so navigations and all same-origin assets are controlled. */
/* Keep the cache version in frontend/sw.js as the single manual SW version source. */
importScripts(new URL('frontend/sw.js', self.location).href);

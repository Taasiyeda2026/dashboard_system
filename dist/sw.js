/* Entry at site root: default scope is `/` so navigations and all same-origin assets are controlled. */
importScripts(new URL('frontend/sw.js', self.location).href);

/* Entry at site root: default scope is `/` so navigations and all same-origin assets are controlled. */
const SW_ENTRY_VERSION = 458;
importScripts(new URL(`frontend/sw.js?v=${SW_ENTRY_VERSION}`, self.location).href);

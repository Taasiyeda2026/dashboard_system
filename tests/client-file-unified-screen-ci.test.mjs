import { JSDOM } from 'jsdom';

const dom = new JSDOM('', { url: 'http://localhost/' });

globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;

await import('./client-file-unified-screen.test.mjs');

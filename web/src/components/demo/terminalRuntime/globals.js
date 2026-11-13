export { default as process } from './process.js';
export { Buffer } from 'buffer';
// Module-scoped timers: do not patch the host page's globals or React scheduler.
export const setImmediate = (callback, ...args) => setTimeout(callback, 0, ...args);
export const clearImmediate = (handle) => clearTimeout(handle);

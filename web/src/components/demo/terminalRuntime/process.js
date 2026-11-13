import browserProcess from 'process/browser';
import { EventEmitter } from 'events';

const events = new EventEmitter();
const unsupported = (facility) => { throw new Error(facility + ' is unavailable in the browser demo'); };
const hostStream = { write: () => unsupported('Host standard streams') };
export const env = { TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '3', KITIA_INSTALLED_VERSION: 'unknown', DEV: 'false' };
export const cwd = () => '/';
const process = {
  ...browserProcess,
  env,
  argv: [],
  platform: 'browser',
  cwd,
  stdout: hostStream,
  stderr: hostStream,
  stdin: { read: () => unsupported('Host standard input') },
  exit: () => unsupported('Process exit'),
  kill: () => unsupported('Process signals'),
};
for (const method of ['on', 'once', 'off', 'emit', 'addListener', 'removeListener', 'removeAllListeners', 'listenerCount', 'listeners']) {
  process[method] = events[method].bind(events);
}
export default process;

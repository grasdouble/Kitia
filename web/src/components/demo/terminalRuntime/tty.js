export const isatty = () => false;
export function ReadStream() { throw new Error('Host TTY input is unavailable in the browser demo'); }
export function WriteStream() { throw new Error('Host TTY output is unavailable in the browser demo'); }
export default { isatty, ReadStream, WriteStream };

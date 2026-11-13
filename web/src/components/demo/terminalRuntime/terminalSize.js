// Ink receives dimensions from xterm; probing the host terminal is not available.
export default function terminalSize() {
  throw new Error('Browser terminal dimensions must be supplied by the xterm output stream');
}

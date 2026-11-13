const write = (stream, sequence) => {
  if (stream?.isTTY) stream.write(sequence);
};
export default {
  hide: (stream) => write(stream, '\u001b[?25l'),
  show: (stream) => write(stream, '\u001b[?25h'),
  toggle: (force, stream) => write(stream, force ? '\u001b[?25h' : '\u001b[?25l'),
};

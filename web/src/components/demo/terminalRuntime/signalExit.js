// Browser lifecycle equivalent of Node's process-exit hook.
export default function onExit(callback) {
  const onPageHide = () => callback(0, null);
  window.addEventListener('pagehide', onPageHide);
  return () => window.removeEventListener('pagehide', onPageHide);
}
export { onExit };

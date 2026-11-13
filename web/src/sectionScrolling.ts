const interruptionEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown', 'resize', 'popstate', 'hashchange'] as const;

/** Scroll to a section in 800ms, respecting sticky offsets and direct user input. */
export function scrollToSection(target: HTMLElement): () => void {
  const startY = window.scrollY;
  const rootStyle = window.getComputedStyle(document.documentElement);
  const targetStyle = window.getComputedStyle(target);
  const offset = (Number.parseFloat(rootStyle.scrollPaddingTop) || 0) + (Number.parseFloat(targetStyle.scrollMarginTop) || 0);
  const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const destinationY = Math.max(0, Math.min(maxY, startY + target.getBoundingClientRect().top - offset));
  const distance = destinationY - startY;
  let frame = 0;
  let startedAt: number | undefined;
  const cancel = () => {
    window.cancelAnimationFrame(frame);
    for (const event of interruptionEvents) window.removeEventListener(event, cancel);
  };

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(distance) < 1) {
    window.scrollTo({ top: destinationY, behavior: 'instant' });
    return cancel;
  }

  const step = (timestamp: number) => {
    startedAt ??= timestamp;
    const progress = Math.min(1, (timestamp - startedAt) / 800);
    const eased = progress * progress * (3 - 2 * progress);
    // Bypass CSS smooth scrolling: each frame must use our position, not start another animation.
    window.scrollTo({ top: startY + distance * eased, behavior: 'instant' });
    if (progress < 1) frame = window.requestAnimationFrame(step);
    else cancel();
  };
  for (const event of interruptionEvents) window.addEventListener(event, cancel, { passive: true });
  frame = window.requestAnimationFrame(step);
  return cancel;
}

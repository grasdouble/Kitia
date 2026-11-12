import { useEffect } from 'react';

const measurementId = 'G-9GDELT6HDR';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function useGoogleAnalytics() {
  useEffect(() => {
    if (!measurementId) return;

    window.dataLayer = window.dataLayer ?? [];
    window.gtag = window.gtag ?? ((...args: unknown[]) => window.dataLayer?.push(args));
    window.gtag('js', new Date());
    window.gtag('config', measurementId);

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a');
      if (!link || !window.gtag) return;

      const linkText = link.textContent?.trim().replace(/\s+/g, ' ') ?? '';
      const eventName = link.dataset.gaEvent;
      if (!eventName) return;

      window.gtag('event', eventName, {
        link_text: linkText,
        link_url: link.href,
      });
    };

    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      script.remove();
    };
  }, []);
}

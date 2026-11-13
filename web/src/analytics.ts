import { useEffect } from 'react';
import { useRouter } from '@tanstack/react-router';

const measurementId = 'G-9GDELT6HDR';

const documents = new WeakMap<Document, { page?: string }>();

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function useGoogleAnalytics() {
  const router = useRouter();
  useEffect(() => {
    if (!measurementId) return;

    const existingTracking = documents.get(document);
    const tracking = existingTracking ?? {};
    if (!existingTracking) {
      documents.set(document, tracking);
      window.dataLayer = window.dataLayer ?? [];
      window.gtag = window.gtag ?? function () {
        window.dataLayer?.push(arguments);
      };
      window.gtag('js', new Date());
      window.gtag('config', measurementId, { send_page_view: false });

      const src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
      if (!document.querySelector(`script[src="${src}"]`)) {
        const script = document.createElement('script');
        script.async = true;
        script.src = src;
        document.head.appendChild(script);
      }
    }

    const trackPage = (location: NonNullable<typeof router.state.resolvedLocation>) => {
      const page = `${location.pathname}${location.searchStr}`;
      if (tracking.page === page) return;
      tracking.page = page;
      window.gtag?.('event', 'page_view', {
        page_location: new URL(location.href, window.location.href).href,
        page_title: document.title,
      });
    };

    // onResolved follows the route render commit, including HeadContent's title.
    // The initial resolved route may predate this effect (for example, on hydration).
    const unsubscribe = router.subscribe('onResolved', ({ toLocation }) => trackPage(toLocation));
    if (router.state.resolvedLocation) trackPage(router.state.resolvedLocation);

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
      unsubscribe();
      // The document owns the script and deduplication state, not this effect.
    };
  }, [router]);
}

// Registers the FreeRun service worker (client-only) for PWA installability
// and offline caching. Safe no-op during SSR or in unsupported browsers.
export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // Only register on secure origins (https or localhost).
  if (!window.isSecureContext) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[v0] Service worker registration failed:", err);
    });
  });
}

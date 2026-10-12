/** Best-effort page lifecycle flush; the fixed write window bounds unclean-exit loss. */
export function subscribeReceivePriorLifecycle(
  cache: { flush(): boolean },
  pageWindow: EventTarget = window,
  pageDocument: EventTarget & { readonly visibilityState: string } = document,
): () => void {
  const flush = () => { cache.flush(); };
  const visibilityChanged = () => { if (pageDocument.visibilityState === "hidden") flush(); };
  pageWindow.addEventListener("pagehide", flush);
  pageDocument.addEventListener("visibilitychange", visibilityChanged);
  return () => {
    pageWindow.removeEventListener("pagehide", flush);
    pageDocument.removeEventListener("visibilitychange", visibilityChanged);
    flush();
  };
}

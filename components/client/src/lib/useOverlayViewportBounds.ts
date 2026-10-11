import { useLayoutEffect } from "react";

const POPUPS = ".gryt-popover, .gryt-preview-card, .gryt-menu, .gryt-tooltip";
const POSITIONERS = ".gryt-popover-positioner, .gryt-preview-card-positioner, .gryt-menu-positioner, .gryt-context-menu-positioner, .gryt-tooltip-positioner";

/** Base UI still flips against the anchor. This final measured correction handles CSS zoom. */
export function useOverlayViewportBounds(): void {
  useLayoutEffect(() => {
    const offsets = new Map<HTMLElement, { x: number; y: number }>();
    let frame = 0;
    const measure = () => {
      frame = 0;
      const scaleValue = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gryt-ui-scale"));
      const scale = Number.isFinite(scaleValue) && scaleValue > 0 ? scaleValue : 1;
      for (const popup of document.querySelectorAll<HTMLElement>(POPUPS)) {
        const positioner = popup.closest<HTMLElement>(POSITIONERS);
        if (!positioner || !popup.getClientRects().length) continue;
        const rect = popup.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const prior = offsets.get(positioner) ?? { x: 0, y: 0 };
        const dx = rect.left < 8 ? 8 - rect.left : rect.right > innerWidth - 8 ? innerWidth - 8 - rect.right : 0;
        const dy = rect.top < 8 ? 8 - rect.top : rect.bottom > innerHeight - 8 ? innerHeight - 8 - rect.bottom : 0;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        const next = { x: prior.x + dx / scale, y: prior.y + dy / scale };
        offsets.set(positioner, next);
        positioner.style.translate = `${next.x}px ${next.y}px`;
      }
      for (const node of offsets.keys()) if (!node.isConnected) offsets.delete(node);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "data-side", "data-open"] });
    const resize = new ResizeObserver(schedule);
    resize.observe(document.documentElement);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    schedule();
    return () => {
      mutations.disconnect(); resize.disconnect(); window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true); cancelAnimationFrame(frame);
      for (const node of offsets.keys()) node.style.translate = "";
    };
  }, []);
}

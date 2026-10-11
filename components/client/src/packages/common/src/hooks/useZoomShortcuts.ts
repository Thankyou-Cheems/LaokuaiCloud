import { useEffect } from "react";

import { useTheme } from "./useTheme";

/**
 * Global Ctrl+Plus / Ctrl+Minus / Ctrl+0 shortcuts that scale the entire UI.
 * Works even when an input is focused (mirrors native browser zoom behaviour).
 */
export function useZoomShortcuts() {
  const { zoomIn, zoomOut, resetZoom } = useTheme();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.code === "Equal" || e.code === "NumpadAdd") {
        e.preventDefault();
        zoomIn();
      } else if (e.code === "Minus" || e.code === "NumpadSubtract") {
        e.preventDefault();
        zoomOut();
      } else if (e.code === "Digit0" || e.code === "Numpad0") {
        e.preventDefault();
        resetZoom();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zoomIn, zoomOut, resetZoom]);
}

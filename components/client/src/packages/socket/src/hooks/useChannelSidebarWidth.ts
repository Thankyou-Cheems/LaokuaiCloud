import type { KeyboardEvent, PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";

const KEY = "gryt.layout.channelSidebarWidth.v1";
const MIN = 220;
const MAX = 480;
const DEFAULT = 320;
const clamp = (value: number) => Math.min(MAX, Math.max(MIN, value));

/** A layout preference only. Shrinking the window does not overwrite the saved width. */
export function useChannelSidebarWidth() {
  const [preferred, setPreferred] = useState(() => {
    try {
      const stored = localStorage.getItem(KEY);
      const value = stored === null ? DEFAULT : Number(stored);
      return Number.isFinite(value) ? clamp(value) : DEFAULT;
    } catch { return DEFAULT; }
  });
  const [viewport, setViewport] = useState(window.innerWidth);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointer: number; startX: number; startWidth: number; width: number } | null>(null);
  const width = Math.min(preferred, Math.max(160, viewport - 400));
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const save = (value: number) => {
    try { localStorage.setItem(KEY, String(clamp(value))); } catch { /* Session layout still works. */ }
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, startX: event.clientX, startWidth: width, width: preferred };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    active.width = clamp(active.startWidth + event.clientX - active.startX);
    setPreferred(active.width);
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    save(drag.current.width);
    drag.current = null;
    setDragging(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const value = event.key === "ArrowLeft" ? preferred - 20 : event.key === "ArrowRight" ? preferred + 20
      : event.key === "Home" ? MIN : event.key === "End" ? MAX : undefined;
    if (value === undefined) return;
    event.preventDefault();
    setPreferred(clamp(value));
    save(value);
  };
  return { width, dragging, resizeHandle: { onPointerDown, onPointerMove, onPointerUp: finish,
    onPointerCancel: finish, onLostPointerCapture: finish, onKeyDown, "aria-valuemin": Math.min(MIN, width),
    "aria-valuemax": Math.min(MAX, Math.max(160, viewport - 400)), "aria-valuenow": width } };
}

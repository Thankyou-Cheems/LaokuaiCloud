import { Reorder, useDragControls } from "motion/react";
import type { ComponentProps, PointerEvent } from "react";

/** Start sorting in React after child controls have had a chance to consume the
 * press. Motion's default native listener otherwise starts before React's
 * member/volume pointer handlers and steals a native member drag. */
export function SidebarDragRow<V>(props: ComponentProps<typeof Reorder.Item<V, "div">>) {
  const controls = useDragControls();
  return <Reorder.Item {...props} dragListener={false} dragControls={controls}
    onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
      props.onPointerDown?.(event);
      if (props.drag === false || event.defaultPrevented || event.isPropagationStopped() || event.button !== 0) return;
      if ((event.target as HTMLElement).closest("[data-voice-member-wrapper]")) return;
      controls.start(event);
    }} />;
}

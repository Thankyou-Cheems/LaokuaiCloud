export type ConnectionTopologyKind = "direct" | "easytier-direct" | "member-relay" | "server-relay" | "local" | "connecting" | "disconnected" | "unknown";
const shapes: Record<ConnectionTopologyKind, string> = {
  direct: "M4 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm11 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM4 8h8",
  "easytier-direct": "M3.5 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm12 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM4.5 8h2m3 0h2m-4-2.5h3v5h-3z",
  "member-relay": "M3.5 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm6-3a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm6 3a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM3.3 7.4l3.4-1.8m2.6 0 3.4 1.8",
  "server-relay": "M3.5 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm12 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM5.5 3h5v10h-5ZM3.5 8h2m5 0h2M7 6h2M7 10h2",
  local: "M3 2.5h10v7H3zM6 12.5h4M8 9.5v3",
  connecting: "M13.5 8A5.5 5.5 0 1 1 8 2.5M11 2.5h2.5V5",
  disconnected: "M3.5 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm12 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM3.5 8H6m4 0h2.5M10 4l-4 8",
  unknown: "M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0ZM6.3 6a1.8 1.8 0 0 1 3.4.6C9.7 7.9 8 7.8 8 9.2M8 11.5v.1",
};
/** Presentation only: callers supply a proven semantic state, never infer transport here. */
export function ConnectionTopologyIcon({ kind }: { kind: ConnectionTopologyKind }) {
  return <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 16 16"
    data-topology-icon={kind} className={`shrink-0${kind === "connecting" ? " motion-safe:animate-spin motion-reduce:animate-none" : ""}`}
    style={kind === "connecting" ? { animationDuration: "2.8s" } : undefined}
    fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d={shapes[kind] ?? shapes.unknown} />
  </svg>;
}

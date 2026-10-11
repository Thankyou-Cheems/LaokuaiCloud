/** Speech presence is provided by the publication VAD, never inferred here. */
export function SpeakingHalo({ hue, size, active = false }: {
  /** Kept for upstream callers; input amplitude never determines activity. */
  analyser?: AnalyserNode;
  active?: boolean;
  hue: number;
  size: number;
}) {
  if (!active) return null;
  return <div aria-hidden data-gryt="speaking-halo" className="gryt-speaking-halo" style={{
    position: "absolute", width: size, height: size, borderRadius: "50%",
    background: `hsl(${hue} 60% 62%)`, opacity: 0.25,
    pointerEvents: "none", zIndex: 0,
  }} />;
}

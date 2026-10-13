/** Device availability and a running graph are required before displaying a measurement. */
export function hasLiveAudioInput(context: Pick<AudioContext, "state"> | undefined, stream: MediaStream | undefined): boolean {
  return context?.state === "running" && !!stream?.getAudioTracks().some(track =>
    track.readyState === "live" && track.enabled && !track.muted);
}

/** RMS of the actual PCM at this tap. Frequency magnitudes and the legacy 0–100
 * detector scale are not dBFS. Digital zero has no finite RMS and remains unmeasured. */
export function readAnalyserDbfs(analyser: AnalyserNode | undefined): number | null {
  if (!analyser) return null;
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let energy = 0;
  for (const value of data) {
    if (!Number.isFinite(value)) return null;
    energy += value * value;
  }
  const rms = Math.sqrt(energy / data.length);
  return rms > 0 && Number.isFinite(rms) ? 20 * Math.log10(rms) : null;
}

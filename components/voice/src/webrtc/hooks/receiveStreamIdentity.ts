/** Rewrapping the same physical tracks does not replace the Web Audio source. */
export function sameReceiveAudioTracks(a: MediaStream, b: MediaStream): boolean {
  const left = a.getAudioTracks(), right = b.getAudioTracks();
  return left.length > 0 && left.length === right.length &&
    left.every(track => right.includes(track));
}

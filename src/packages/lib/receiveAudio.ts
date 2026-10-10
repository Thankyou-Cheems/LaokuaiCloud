import type { ReceiveAudioRole, StreamSources } from "@gryt/voice";

type RemoteAudioClient = { streamID?: string; screenShareAudioStreamID?: string };

export function receiveAudioRoles(clients: RemoteAudioClient[]): Map<string, ReceiveAudioRole> {
  const roles = new Map<string, ReceiveAudioRole>();
  for (const client of clients) {
    if (client.streamID) roles.set(client.streamID, "microphone");
  }
  for (const client of clients) {
    if (client.screenShareAudioStreamID) roles.set(client.screenShareAudioStreamID, "screen");
  }
  return roles;
}

export function applyReceiveAudioRoles(sources: StreamSources, clients: RemoteAudioClient[]): void {
  const roles = receiveAudioRoles(clients);
  const controls = new Map<NonNullable<StreamSources[string]["receiveCleanup"]>, ReceiveAudioRole>();
  for (const [id, source] of Object.entries(sources)) {
    const control = source.receiveCleanup;
    if (!control) continue;
    const role = roles.get(id) || "unknown";
    const current = controls.get(control);
    // Aliases can share one audio route. Screen audio must never receive mic AGC.
    if (!current || role === "screen" || (current === "unknown" && role === "microphone")) {
      controls.set(control, role);
    }
  }
  for (const [control, role] of controls) {
    control.setRole(role);
  }
}

export function setReceiveAudioGain(source: StreamSources[string] | undefined, value: number, time: number): void {
  if (!source) return;
  const gain = Number.isFinite(value) ? Math.max(0, value) : 0;
  source.receiveCleanup?.setMuted(gain === 0);
  source.gain.gain.setValueAtTime(gain, time);
}

import type { SFUClient } from "../../sfu/client";
let sfu: Pick<SFUClient, "supportsAtomicMove"> | null = null;
export function setVoiceMoveCapabilitySource(source: Pick<SFUClient, "supportsAtomicMove">): void { sfu = source; }
export async function voiceAtomicMoveEnabled(): Promise<boolean> {
  return process.env.VOICE_ATOMIC_MOVE_ENABLED === "true" && !!sfu && await sfu.supportsAtomicMove();
}

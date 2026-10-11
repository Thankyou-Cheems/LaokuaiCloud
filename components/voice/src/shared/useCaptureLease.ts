import { useRef } from "react";
import { useVoiceMediaPolicy } from "../config";
import { CaptureLease, isAudioOnly } from "./mediaPolicy";

export function useCaptureLease() {
  const connection = useVoiceMediaPolicy() ?? {};
  const lease = useRef(new CaptureLease()).current;
  lease.setMode(connection);
  return { lease, audioOnly: isAudioOnly(connection) };
}

import { useCallback, useEffect, useState } from "react";
import { useVoiceConfig } from "../../config/index";
import { getReceiveController, type ReceiveController, type ReceiveLevelingState } from "../lib/receiveGraph";
import type { ReceiveAutoLevelBatch } from "../lib/receiveAutoLevels";
import { sliderToOutputGain } from "../../shared/audioVolume";

import { singletonHook } from "../../shared/singletonHook";

import { useSharedAudioContext } from "./useAudioContext";

interface AudioContextWithSink extends AudioContext {
  setSinkId?(sinkId: string): Promise<void>;
}

interface Speakers {
  devices: MediaDeviceInfo[];
  audioContext?: AudioContext;
  remoteBusNode?: GainNode;
  receiveLevelingState: ReceiveLevelingState;
  receiveAutoLevels: ReceiveAutoLevelBatch;
  getOutputDevices: () => void;
  applyOutputDevice: (deviceId: string) => void;
}

function useSpeakersHook(): Speakers {
  const { audioContext } = useSharedAudioContext();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const config = useVoiceConfig();
  const enabled = config.audio.receiveLevelingEnabled ?? false;
  const [receiveLevelingState, setReceiveLevelingState] = useState<ReceiveLevelingState>({ status: "disabled", latencyMs: 0 });
  const [receiveAutoLevels, setReceiveAutoLevels] = useState<ReceiveAutoLevelBatch>({ kind: "receive-auto-levels", schemaVersion: 1, snapshots: [] });

  const [controller, setController] = useState<ReceiveController>();
  const remoteBusNode = controller?.bus;

  useEffect(() => {
    if (!audioContext) {
      setReceiveAutoLevels({ kind: "receive-auto-levels", schemaVersion: 1, snapshots: [] });
      setReceiveLevelingState({ status: enabled ? "suspended" : "disabled", reason: enabled ? "awaiting-audio-context" : undefined, latencyMs: 0 });
      return;
    }
    const next = getReceiveController(audioContext, enabled);
    next.setEnabled(enabled);
    next.bus.gain.setValueAtTime(sliderToOutputGain(config.audio.outputVolume), audioContext.currentTime);
    next.setMuted(config.audio.deafened || config.audio.serverDeafened || config.audio.outputVolume === 0);
    setController(next);
    const unsubscribe = next.subscribe(setReceiveLevelingState);
    const unsubscribeAuto = next.subscribeAutoLevels(setReceiveAutoLevels);
    return () => { unsubscribe(); unsubscribeAuto(); next.dispose(); };
  }, [audioContext]);

  useEffect(() => {
    if (controller) controller.setEnabled(enabled);
    else setReceiveLevelingState({ status: enabled ? "suspended" : "disabled", reason: enabled ? "awaiting-audio-context" : undefined, latencyMs: 0 });
  }, [controller, enabled]);

  useEffect(() => {
    controller?.bus.gain.setValueAtTime(sliderToOutputGain(config.audio.outputVolume), controller.context.currentTime);
    controller?.setMuted(config.audio.deafened || config.audio.serverDeafened || config.audio.outputVolume === 0);
  }, [controller, config.audio.deafened, config.audio.serverDeafened, config.audio.outputVolume]);

  const getOutputDevices = useCallback(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((d) => setDevices(d.filter((dev) => dev.kind === "audiooutput")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    getOutputDevices();
  }, [getOutputDevices]);

  const applyOutputDevice = useCallback((deviceId: string) => {
    if (!audioContext) return;
    const ctx = audioContext as AudioContextWithSink;
    if (typeof ctx.setSinkId === "function") {
      ctx.setSinkId(deviceId).catch(() => {});
    }
  }, [audioContext]);

  useEffect(() => {
    if (!audioContext) return;
    const saved = localStorage.getItem("outputDeviceID");
    if (saved) {
      applyOutputDevice(saved);
    }
  }, [audioContext, applyOutputDevice]);

  return { devices, audioContext, remoteBusNode, receiveLevelingState, receiveAutoLevels, getOutputDevices, applyOutputDevice };
}

const init: Speakers = {
  devices: [],
  audioContext: undefined,
  remoteBusNode: undefined,
  receiveLevelingState: { status: "disabled", latencyMs: 0 },
  receiveAutoLevels: { kind: "receive-auto-levels", schemaVersion: 1, snapshots: [] },
  getOutputDevices: () => {},
  applyOutputDevice: () => {},
};

const SpeakerHook = singletonHook(init, useSpeakersHook);

export const useSpeakers = () => SpeakerHook();

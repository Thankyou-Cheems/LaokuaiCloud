import "../src/style.css";

import { useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { getReceiveController } from "../node_modules/@gryt/voice/dist/audio/lib/receiveGraph.js";
import { ReceiveCorrectionRegistry } from "../src/lib/receiveCorrectionRegistry";
import { RemoteReceiveCorrection } from "../src/packages/socket/src/components/RemoteReceiveCorrection";
import { ReceiveCorrectionProvider } from "../src/packages/webRTC/src/components/ReceiveCorrectionAdapter";

/** Actual installed SDK graph and actual client binding, synthetic oscillator only. */
export function Harness() {
  const [registry] = useState(() => new ReceiveCorrectionRegistry());
  const [runtime, setRuntime] = useState("not-started");
  const [latestBatch, setLatestBatch] = useState("{}");
  const [trackId, setTrackId] = useState("");
  const [error, setError] = useState("");
  const controls = useRef<{ screen(): void; microphone(): void; disable(): void; close(): Promise<void> } | undefined>(undefined);
  const readings = useSyncExternalStore(registry.subscribe, registry.getSnapshot);
  const start = async () => {
    try {
      const context = new AudioContext({ sampleRate: 48000 });
      const oscillator = context.createOscillator();
      const amplitude = context.createGain(); amplitude.gain.value = 0.03;
      const destination = context.createMediaStreamDestination();
      oscillator.connect(amplitude); amplitude.connect(destination);
      const source = context.createMediaStreamSource(destination.stream);
      const manual = context.createGain();
      const controller = getReceiveController(context, true);
      const route = controller.attach(source, manual);
      const sources = { microphone: { receiveCleanup: route, stream: source }, alias: { receiveCleanup: route, stream: source } };
      const members = [{ serverUserId: "synthetic-member", streamID: "microphone", screenShareAudioStreamID: undefined as string | undefined }];
      const reconcile = () => registry.reconcile({ host: "synthetic-server", channel: "synthetic-channel", connected: true, sources, clients: members });
      const unsubscribeState = controller.subscribe(state => setRuntime(`${state.status}/${state.latencyMs}`));
      const unsubscribeBatch = controller.subscribeAutoLevels(batch => {
        registry.acceptBatch(batch); setLatestBatch(JSON.stringify(batch));
      });
      reconcile(); setTrackId(destination.stream.getAudioTracks()[0].id);
      controls.current = {
        screen() { members[0].screenShareAudioStreamID = "alias"; reconcile(); },
        microphone() { members[0].screenShareAudioStreamID = undefined; reconcile(); },
        disable() { controller.setEnabled(false); },
        async close() { registry.clear(); route.dispose(); unsubscribeBatch(); unsubscribeState(); controller.dispose();
          oscillator.stop(); destination.stream.getTracks().forEach(track => track.stop()); await context.close(); setRuntime("closed"); },
      };
      oscillator.start(); await context.resume();
    } catch (caught) { setError(String(caught)); }
  };
  return <ReceiveCorrectionProvider value={readings}>
    <button onClick={() => void start()}>Start synthetic graph</button>
    <button onClick={() => controls.current?.screen()}>Screen alias</button>
    <button onClick={() => controls.current?.microphone()}>Microphone role</button>
    <button onClick={() => controls.current?.disable()}>Disable graph</button>
    <button onClick={() => void controls.current?.close()}>Dispose graph</button>
    <output data-testid="runtime">{runtime}</output><output data-testid="batch">{latestBatch}</output>
    <output data-testid="track">{trackId}</output><output data-testid="error">{error}</output>
    <div data-testid="actual-ring"><RemoteReceiveCorrection host="synthetic-server" member="synthetic-member" streamId="microphone" /></div>
  </ReceiveCorrectionProvider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);

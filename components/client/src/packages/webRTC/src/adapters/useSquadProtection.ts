import { useEffect } from "react";

import { useSettings } from "@/settings";

import { getElectronAPI } from "../../../../lib/electron";
import { squadGateRequired } from "../../../../lib/squadMode";
import { publishSquadGate, publishSquadSnapshot, useSquadGateEnabled, useSquadSnapshot } from "../../../../lib/squadRuntime";
import { useMicrophone } from "../../../../lib/voiceFacade";

/** Native events only alter the temporary reason, never user/server/PTT mute. */
export function useSquadProtection() {
  const s = useSettings();
  const state = useSquadSnapshot();
  const installed = useSquadGateEnabled();
  const { setTransmitSuppressed, transmissionState } = useMicrophone(false);
  useEffect(() => {
    if (!s.settingsLoaded) return;
    const api = getElectronAPI();
    if (!api) {
      publishSquadSnapshot({ status: s.squadConfig.enabled ? "unavailable" : "off", reason: "desktop-required",
        gateEnabled: false, suppressed: false, heldCount: 0, global: !s.squadConfig.processDetection });
      return;
    }
    let cancelled = false;
    let received = false;
    const remove = api.onSquadState(next => { received = true; publishSquadSnapshot(next); });
    api.configureSquad(s.squadConfig).then(next => {
      if (!cancelled && !received) publishSquadSnapshot(next);
    }).catch(() => {
      if (!cancelled && !received) publishSquadSnapshot({ ...state, status: "unavailable", reason: "ipc-unavailable",
        gateEnabled: state.gateEnabled, suppressed: state.gateEnabled });
    });
    return () => { cancelled = true; remove(); };
    // Snapshot changes must not restart the input broker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.squadConfig, s.settingsLoaded]);

  useEffect(() => {
    setTransmitSuppressed(state.suppressed);
  }, [state.suppressed, setTransmitSuppressed]);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;
    const update = () => {
      const el = document.activeElement;
      const typing = el instanceof HTMLElement && (el.matches("input,textarea,select") || el.isContentEditable);
      api.setSquadInputExcluded(typing || !!document.querySelector("[data-hotkey-recording=true]"));
    };
    window.addEventListener("squad-recording-change", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    update();
    return () => {
      window.removeEventListener("squad-recording-change", update);
      document.removeEventListener("focusin", update); document.removeEventListener("focusout", update);
      api.setSquadInputExcluded(false);
    };
  }, []);

  // Keep the graph installed until fresh recovery settles after a scope change.
  useEffect(() => {
    publishSquadGate(squadGateRequired(state, installed, transmissionState.status));
  }, [state, installed, transmissionState.status]);
}

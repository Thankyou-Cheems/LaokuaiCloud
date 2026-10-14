import { useCamera, useScreenShare } from "@gryt/voice";
import { useEffect, useRef, useState } from "react";

import { i18n, LocalizedText, useTranslation } from "@/i18n";

import { PiVideoCameraFill } from "../lib/icons";
import { nativeVoiceEnabled, useSFU } from "../lib/voiceFacade";
import { DebugOverlay } from "./debugOverlay";
import {
  type ConnectionDiagnostics,
  type InboundDiagnostics,
  labelForTrack,
  type OutboundDiagnostics,
  readVideoStats,
  type SenderTracks,
  type Stat,
  type VideoLabel,
} from "./videoDebugStats";

interface VideoDebugOverlayProps {
  isVisible: boolean;
}

interface SenderDiagnostics {
  label: VideoLabel;
  trackId: string | null;
  readyState: MediaStreamTrackState | null;
  enabled: boolean | null;
  muted: boolean | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  encodingActive: boolean | null;
  maxBitrateKbps: number | null;
}

interface VideoDiagnostics {
  connectionState: RTCPeerConnectionState | null;
  iceConnectionState: RTCIceConnectionState | null;
  signalingState: RTCSignalingState | null;
  connection: ConnectionDiagnostics;
  senders: SenderDiagnostics[];
  outbound: OutboundDiagnostics[];
  inbound: InboundDiagnostics[];
}

const EMPTY_DIAGNOSTICS: VideoDiagnostics = {
  connectionState: null,
  iceConnectionState: null,
  signalingState: null,
  connection: {
    rttMs: null,
    availableOutKbps: null,
    availableInKbps: null,
    bytesDiscardedOnSend: null,
    packetsDiscardedOnSend: null,
    localCandidateType: null,
    localNetworkType: null,
    remoteCandidateType: null,
    protocol: null,
  },
  senders: [],
  outbound: [],
  inbound: [],
};

const sectionTitle: React.CSSProperties = {
  color: "var(--gryt-secondary-11)",
  fontWeight: "bold",
  marginBottom: "4px",
};

const indent: React.CSSProperties = {
  marginLeft: "8px",
  fontSize: "11px",
};

/** Room left under the overlay for the call controls along the bottom of the voice panel. */
const CALL_CONTROLS_CLEARANCE = 180;

function fmt(v: number | null, decimals = 1): string {
  if (v == null) return "—";
  return v.toFixed(decimals);
}

function fmtInt(v: number | null): string {
  if (v == null) return "—";
  return String(Math.round(v));
}

function fmtBytes(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${fmt(v / 1_000_000, 1)} MB`;
  if (v >= 1_000) return `${fmt(v / 1_000, 1)} KB`;
  return `${fmtInt(v)} B`;
}

function resolution(w: number | null, h: number | null): string {
  if (w == null || h == null) return "—";
  return `${w}x${h}`;
}

function labelTitle(label: VideoLabel): string {
  if (label === "screen") return i18n.t("shellFull.videoDebugOverlay_tsx_e60de6b683");
  if (label === "camera") return i18n.t("shellFull.videoDebugOverlay_tsx_4da9c9af96");
  return i18n.t("shellFull.videoDebugOverlay_tsx_bc17c1f017");
}

function readSenders(pc: RTCPeerConnection, tracks: SenderTracks): SenderDiagnostics[] {
  return pc.getSenders()
    .filter((sender) => sender.track?.kind === "video")
    .map((sender) => {
      const track = sender.track;
      const settings = track?.getSettings();
      const encoding = sender.getParameters().encodings?.[0];

      return {
        label: labelForTrack(track?.id ?? null, tracks),
        trackId: track?.id ?? null,
        readyState: track?.readyState ?? null,
        enabled: track?.enabled ?? null,
        muted: track?.muted ?? null,
        width: settings?.width ?? null,
        height: settings?.height ?? null,
        frameRate: settings?.frameRate ?? null,
        encodingActive: typeof encoding?.active === "boolean" ? encoding.active : null,
        maxBitrateKbps:
          typeof encoding?.maxBitrate === "number" ? encoding.maxBitrate / 1000 : null,
      };
    });
}

function useVideoDebugDiagnostics(enabled: boolean): VideoDiagnostics {
  const sfu = useSFU();
  // useSFU hands out new getters every render, so the poll reads them here instead of restarting.
  const sfuRef = useRef(sfu);
  sfuRef.current = sfu;
  const [diagnostics, setDiagnostics] = useState<VideoDiagnostics>(EMPTY_DIAGNOSTICS);

  useEffect(() => {
    if (!enabled) {
      setDiagnostics(EMPTY_DIAGNOSTICS);
      return;
    }

    let cancelled = false;
    let polling = false;
    let lastPc: RTCPeerConnection | null = null;
    let samples: ReadonlyMap<string, Stat> = new Map();

    const poll = async () => {
      if (polling) return;
      const { getPeerConnection, getCameraSenderTrackId, getScreenSenderTrackId } = sfuRef.current;
      const pc = getPeerConnection?.() ?? null;
      if (pc !== lastPc) samples = new Map();
      lastPc = pc;
      if (!pc) {
        if (!cancelled) setDiagnostics(EMPTY_DIAGNOSTICS);
        return;
      }

      polling = true;
      try {
        const report = await pc.getStats();
        if (cancelled) return;
        const tracks: SenderTracks = {
          camera: getCameraSenderTrackId?.() ?? null,
          screen: getScreenSenderTrackId?.() ?? null,
        };
        const reading = readVideoStats(report.values() as Iterable<Stat>, samples, tracks);
        samples = reading.samples;
        setDiagnostics({
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          signalingState: pc.signalingState,
          connection: reading.connection,
          senders: readSenders(pc, tracks),
          outbound: reading.outbound,
          inbound: reading.inbound,
        });
      } catch {
        // getStats can race peer-connection shutdown.
      } finally {
        polling = false;
      }
    };

    void poll();
    const interval = setInterval(poll, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  return diagnostics;
}

function SenderSection({ s }: { s: SenderDiagnostics }) {
  useTranslation();
  const stateParts = [
    s.readyState ?? "—",
    s.enabled == null ? null : s.enabled ? "enabled" : "disabled",
    s.muted == null ? null : s.muted ? "muted" : "unmuted",
  ].filter(Boolean);

  return (
    <div style={{ marginBottom: "8px" }}>
      <div style={sectionTitle}>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_52b9519e4e" />}{" "}{labelTitle(s.label)}:</div>
      <div style={indent}>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_39babc1cca" />}{" "}{stateParts.join(" / ")}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_ae9f06aca3" />}{" "}{resolution(s.width, s.height)}
          {s.frameRate != null ? ` @ ${fmt(s.frameRate, 1)} fps` : ""}
        </div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_ba436524d4" />}{" "}{s.encodingActive == null ? "—" : s.encodingActive ? i18n.t("shellSecond.active") : i18n.t("shellSecond.inactive")}
          {" / "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_0706025b2b" />}{" "}{s.maxBitrateKbps != null ? `${fmtInt(s.maxBitrateKbps)} kbps` : "—"}
        </div>
      </div>
    </div>
  );
}

function OutboundSection({ s }: { s: OutboundDiagnostics }) {
  useTranslation();
  return (
    <div style={{ marginBottom: "8px" }}>
      <div style={sectionTitle}>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_670988faf3" />}{" "}{labelTitle(s.label)}:</div>
      <div style={indent}>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_d50f2c549f" />}{" "}{" "}{s.codec ?? "—"}</div>
        {s.codecFmtp && <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_f8d1e654e0" />}{" "}{s.codecFmtp}</div>}
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_222707d269" />}{" "}{" "}{resolution(s.frameWidth, s.frameHeight)}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_3a2a5b74ed" />}{" "}{" "}{fmt(s.framesPerSecond, 0)}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_fa1da0b1bf" />}{" "}{" "}{s.bitrateKbps != null ? `${fmt(s.bitrateKbps)} kbps` : "—"}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_652ac2cbba" />}{" "}{s.targetBitrateKbps != null ? `${fmtInt(s.targetBitrateKbps)} kbps` : "—"}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_dfbd597792" />}{" "}{fmtInt(s.packetsSent)}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_f330226605" />}{" "}{fmtInt(s.retransmittedPacketsSent)}{" "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_5efad0cad2" />}{" "}
          {fmtBytes(s.retransmittedBytesSent)}
        </div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_7df9b30403" />}{" "}{s.averagePacketSendDelayMs != null
            ? i18n.t("shellSecond.packetTime", { value: fmt(s.averagePacketSendDelayMs, 2) })
            : "—"}
        </div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_80322c5744" />}{" "}{" "}{fmtInt(s.framesEncoded)}{" "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_a79b2fae15" />}{" "}{fmtInt(s.keyFramesEncoded)}{" "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_a62f2225bf" />}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_277c67720e" />}{" "}
          {s.averageEncodeTimeMs != null ? i18n.t("shellSecond.averageFrameTime", { value: fmt(s.averageEncodeTimeMs, 2) }) : "—"}
          {" / "}
          {s.totalEncodeTimeMs != null ? i18n.t("shellSecond.totalTime", { value: fmt(s.totalEncodeTimeMs) }) : "—"}
        </div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_4f77d7adeb" />}{" "}{fmt(s.averageQp, 1)}</div>
        <div>PLI: {fmtInt(s.pliCount)} / NACK: {fmtInt(s.nackCount)}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_5195594906" />}{" "}{s.remoteRttMs != null ? `${fmt(s.remoteRttMs)} ms` : "—"}
          {s.remoteRttMeasurements != null && i18n.t("shellFull.videoDebugOverlay_tsx_636c839452", { value0: fmtInt(s.remoteRttMeasurements) })}
          {" / "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_dd70fee731" />}{" "}{s.remoteJitterMs != null ? `${fmt(s.remoteJitterMs)} ms` : "—"}
        </div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_6c67842013" />}{" "}{s.remoteLossPct != null ? `${fmt(s.remoteLossPct, 2)}%` : "—"}
          {" / "}{fmtInt(s.remotePacketsLost)}{" "}{" "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_222576a654" />}</div>
        <div
          style={{
            color:
              s.qualityLimitationReason && s.qualityLimitationReason !== "none"
                ? "var(--gryt-warning-11)"
                : undefined,
          }}
        >{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_892cdbabcb" />}{" "}{s.qualityLimitationReason ?? "—"}
        </div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_f34d2d6e83" />}{" "}{fmt(s.bandwidthLimitedSeconds, 1)}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_57cb4e680f" />}{" "}
          {fmt(s.cpuLimitedSeconds, 1)}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_9103837abe" />}{" "}
          {fmt(s.otherLimitedSeconds, 1)}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_a0f1490a20" />}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_ed55cb32d7" />}{" "}{fmtInt(s.resolutionChanges)}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_c6d1e13f8e" />}{" "}{s.scalabilityMode ?? "—"}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_5028545e60" />}{" "}{s.encoderImplementation ?? "—"}</div>
      </div>
    </div>
  );
}

function InboundSection({ s, index }: { s: InboundDiagnostics; index: number }) {
  useTranslation();
  const recentDropColor =
    s.recentDropPct != null && s.recentDropPct >= 2 ? "var(--gryt-warning-11)" : undefined;
  const recentLossColor =
    s.recentLossPct != null && s.recentLossPct >= 1 ? "var(--gryt-warning-11)" : undefined;

  return (
    <div style={{ marginBottom: "8px" }}>
      <div style={sectionTitle}>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_e7c572e339" />}{index + 1}:</div>
      <div style={indent}>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_d50f2c549f" />}{s.codec ?? "—"}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_222707d269" />}{resolution(s.frameWidth, s.frameHeight)}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_3a2a5b74ed" />}{fmt(s.framesPerSecond, 0)}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_fa1da0b1bf" />}{s.bitrateKbps != null ? `${fmt(s.bitrateKbps)} kbps` : "—"}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_7d0ffb0cee" />}{" "}{s.jitterMs != null ? `${fmt(s.jitterMs)} ms` : "—"}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_b37d0350c8" />}{" "}{fmtInt(s.packetsReceived)}{" "}{" "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_d298aa9b11" />}{" "}{" "}{fmtInt(s.packetsLost)}{" "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_93538cf905" />}{" "}
          {fmtInt(s.packetsDiscarded)}{" "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_4056ef88d5" />}</div>
        <div style={{ color: recentLossColor }}>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_04a535bfc4" />}{" "}
          {s.recentLossPct != null ? `${fmt(s.recentLossPct, 2)}%` : "—"}
          {" / "}
          {fmt(s.recentPacketsReceivedPerSecond, 1)}{" "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_99027a9757" />}{" / "}
          {fmt(s.recentPacketsLostPerSecond, 1)}{" "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_bb95c9a8ce" />}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_80322c5744" />}{fmtInt(s.framesReceived)}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_d298aa9b11" />}{fmtInt(s.framesDecoded)}{" "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_ac5db5ad69" />}{" "}{fmtInt(s.framesDropped)}{" "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_ad3f9aa5e8" />}</div>
        <div style={{ color: recentDropColor }}>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_5e41ca51e0" />}{" "}
          {s.recentDropPct != null ? `${fmt(s.recentDropPct, 1)}%` : "—"}
          {" / "}
          {fmt(s.recentDecodedFps, 1)}{" "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_dc7a3355e8" />}{" / "}
          {fmt(s.recentDroppedFps, 1)}{" "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_8d3aced92a" />}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_4cb6c2cb01" />}{" "}{s.averageDecodeTimeMs != null
            ? i18n.t("shellSecond.averageFrameTime", { value: fmt(s.averageDecodeTimeMs, 2) })
            : "—"}
        </div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_88b5d234f0" />}{" "}{s.averageProcessingDelayMs != null
            ? i18n.t("shellSecond.averageFrameTime", { value: fmt(s.averageProcessingDelayMs, 2) })
            : "—"}
        </div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_327b8b5b2a" />}{" "}{s.averageJitterBufferDelayMs != null
            ? i18n.t("shellSecond.averageFrameTime", { value: fmt(s.averageJitterBufferDelayMs, 2) })
            : "—"}
        </div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_40f1fb2e0e" />}{" "}{s.averageAssemblyTimeMs != null
            ? i18n.t("shellSecond.averageFrameTime", { value: fmt(s.averageAssemblyTimeMs, 2) })
            : "—"}
          {" / "}
          {fmtInt(s.framesAssembledFromMultiplePackets)}{" "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_b552ee9549" />}</div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_010fbed2f0" />}{" "}{fmtInt(s.freezeCount)} /{" "}
          {s.totalFreezesDurationMs != null
            ? i18n.t("shellFull.videoDebugOverlay_tsx_ad015878d6", { value0: fmt(s.totalFreezesDurationMs / 1000, 1) })
            : "—"}
        </div>
        <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_bc2e745b3b" />}{" "}{s.decoderImplementation ?? "—"}</div>
        <div>
          PLI: {fmtInt(s.pliCount)} (+{fmtInt(s.recentPliCount)}) / FIR:{" "}
          {fmtInt(s.firCount)} / NACK: {fmtInt(s.nackCount)} (+
          {fmtInt(s.recentNackCount)})
        </div>
      </div>
    </div>
  );
}

export function VideoDebugOverlay({ isVisible }: VideoDebugOverlayProps) {
  return nativeVoiceEnabled ? null : <LegacyVideoDebugOverlay isVisible={isVisible}/>;
}
function LegacyVideoDebugOverlay({ isVisible }: VideoDebugOverlayProps) {
  useTranslation();
  const diagnostics = useVideoDebugDiagnostics(isVisible);
  const { cameraEnabled } = useCamera();
  const { screenShareActive } = useScreenShare();
  const { isConnected } = useSFU();

  const { connection } = diagnostics;
  const hasVideo = cameraEnabled || screenShareActive || diagnostics.inbound.length > 0;
  const localPath = [connection.localCandidateType, connection.localNetworkType].filter(Boolean).join("/");

  return (
    <DebugOverlay
      isVisible={isVisible}
      title={i18n.t("shellFull.videoDebugOverlay_tsx_75825921c6")}
      icon={<PiVideoCameraFill size={16} />}
      status={{
        active: isConnected && hasVideo,
        label: isConnected ? (hasVideo ? i18n.t("shellFull.videoDebugOverlay_tsx_1e8325521d") : i18n.t("shellFull.videoDebugOverlay_tsx_4fa77f0cff")) : i18n.t("shellFull.videoDebugOverlay_tsx_771e05f27b"),
      }}
      initialPosition={{ x: window.innerWidth - 680, y: 10 }}
    >
      <div style={{ maxHeight: `calc(100vh - ${CALL_CONTROLS_CLEARANCE}px)`, overflowY: "auto", paddingRight: "4px" }}>
        <div style={{ marginBottom: "8px" }}>
          <div style={sectionTitle}>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_eeb4784e26" />}</div>
          <div style={indent}>
            <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_086f0e76ea" />}{" "}{connection.rttMs != null ? `${fmt(connection.rttMs)} ms` : "—"}</div>
            <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_b5dcd8bb4f" />}{" "}{connection.availableOutKbps != null ? `${fmtInt(connection.availableOutKbps)} kbps` : "—"}</div>
            <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_64a25da7ca" />}{" "}{connection.availableInKbps != null ? `${fmtInt(connection.availableInKbps)} kbps` : "—"}</div>
            <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_df395b4582" />}{" "}{localPath || "—"} → {connection.remoteCandidateType ?? "—"} ({connection.protocol ?? "—"})
            </div>
            <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_d3b6fe6aa3" />}{" "}{diagnostics.connectionState ?? "—"} / ICE{" "}
              {diagnostics.iceConnectionState ?? "—"}{" "}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_10a71daa91" />}{" "}
              {diagnostics.signalingState ?? "—"}
            </div>
            <div>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_700c389b40" />}{" "}{fmtBytes(connection.bytesDiscardedOnSend)} /{" "}
              {fmtInt(connection.packetsDiscardedOnSend)}{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_222576a654" />}</div>
          </div>
        </div>

        {diagnostics.senders.length === 0 && (cameraEnabled || screenShareActive) && (
          <div style={{ marginBottom: "8px" }}>
            <div style={sectionTitle}>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_a980337e0d" />}</div>
            <div style={{ ...indent, color: "var(--gryt-warning-11)" }}>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_62c9714fa3" />}</div>
          </div>
        )}
        {diagnostics.senders.map((s, i) => (
          <SenderSection key={s.trackId ?? `sender-${i}`} s={s} />
        ))}

        {diagnostics.outbound.length === 0 && (
          <div style={{ marginBottom: "8px" }}>
            <div style={sectionTitle}>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_3b355794e7" />}</div>
            <div style={{ ...indent, color: "var(--gryt-neutral-9)" }}>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_96fee6f7d0" />}</div>
          </div>
        )}
        {diagnostics.outbound.map((s) => (
          <OutboundSection key={s.id} s={s} />
        ))}

        {diagnostics.inbound.length === 0 && (
          <div style={{ marginBottom: "8px" }}>
            <div style={sectionTitle}>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_9d2b37dc84" />}</div>
            <div style={{ ...indent, color: "var(--gryt-neutral-9)" }}>{<LocalizedText translationKey="shellFull.videoDebugOverlay_tsx_a5e67fb8f5" />}</div>
          </div>
        )}
        {diagnostics.inbound.map((s, i) => (
          <InboundSection key={s.id} s={s} index={i} />
        ))}
      </div>
    </DebugOverlay>
  );
}

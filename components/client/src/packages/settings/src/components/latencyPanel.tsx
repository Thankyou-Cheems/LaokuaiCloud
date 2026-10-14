import { Button, Chip } from "@gryt/ui";
import type { LatencyBreakdown } from "@gryt/voice";
import { useState } from "react";

import { i18n, useTranslation } from "@/i18n";

import { PiEyeFill } from "../../../../lib/icons";
import { nativeVoiceEnabled, useVoiceLatency } from "../../../../lib/voiceFacade";

function ms(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)} ms`;
}

function LatencyRow({
  label,
  value,
  color,
}: {
  label: string;
  value: number | null;
  color?: string;
}) {
  useTranslation();
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-xs text-gryt-muted">{label}</span>
      <span className="text-xs font-medium" style={{ color: color || "inherit", fontFamily: "var(--code-font-family)" }}>
        {ms(value)}
      </span>
    </div>
  );
}

function LatencyBar({ latency }: { latency: LatencyBreakdown }) {
  useTranslation();
  const segments: { label: string; ms: number; color: string }[] = [];

  if (latency.contextBaseLatencyMs !== null && latency.contextBaseLatencyMs > 0) {
    segments.push({ label: i18n.t("settingsFull.mcc11b3a28f"), ms: latency.contextBaseLatencyMs, color: "var(--gryt-secondary-9)" });
  }
  if (latency.rnnoiseBufferMs !== null && latency.rnnoiseBufferMs > 0) {
    segments.push({ label: "RNNoise", ms: latency.rnnoiseBufferMs, color: "var(--gryt-warning-9)" });
  }
  if (latency.oneWayNetworkMs !== null && latency.oneWayNetworkMs > 0) {
    segments.push({ label: i18n.t("settingsFull.m53ebc572b4"), ms: latency.oneWayNetworkMs, color: "var(--gryt-success-9)" });
  }

  const total = segments.reduce((sum, s) => sum + s.ms, 0);
  if (total === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex" style={{
          height: "20px",
          borderRadius: "var(--gryt-radius-sm)",
          overflow: "hidden",
          background: "var(--gryt-neutral-4)",
        }}>
        {segments.map((seg) => (
          <div key={seg.label} style={{
              width: `${(seg.ms / total) * 100}%`,
              minWidth: "2px",
              background: seg.color,
              transition: "width 0.3s ease",
            }} />
        ))}
      </div>
      <div className="flex gap-3 flex-wrap">
        {segments.map((seg) => (
          <div className="flex items-center gap-1" key={seg.label}>
            <div style={{
                width: "8px",
                height: "8px",
                borderRadius: "var(--gryt-radius-sm)",
                background: seg.color,
                flexShrink: 0,
              }} />
            <span className="text-xs text-gryt-muted">
              {seg.label} {seg.ms.toFixed(1)}ms
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddressRow({ label, address, shown }: { label: string; address: string; shown: boolean }) {
  useTranslation();
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-xs text-gryt-muted">{label}</span>
      {shown ? (
        <span className="text-xs font-medium" style={{ fontFamily: "var(--code-font-family)", maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>
          {address}
        </span>
      ) : (
        <span className="text-xs text-gryt-muted">{i18n.t("ui.hidden")}</span>
      )}
    </div>
  );
}

function ratingColor(estimatedMs: number | null): string {
  if (estimatedMs === null) return "var(--gryt-neutral-11)";
  if (estimatedMs < 30) return "var(--gryt-success-11)";
  if (estimatedMs < 80) return "var(--gryt-secondary-11)";
  if (estimatedMs < 150) return "var(--gryt-warning-11)";
  return "var(--gryt-danger-11)";
}

function ratingLabel(estimatedMs: number | null): string {
  if (estimatedMs === null) return i18n.t("settingsFull.md802d232a8");
  if (estimatedMs < 30) return i18n.t("settingsFull.m1aafbf548b");
  if (estimatedMs < 80) return i18n.t("settingsFull.m61dedcf053");
  if (estimatedMs < 150) return i18n.t("settingsFull.m64b985898d");
  return i18n.t("settingsFull.m4e0fa4378f");
}

export function LatencyPanel() {
  return nativeVoiceEnabled ? <p>原生 AoO / EasyTier 音频延迟尚未测量。浏览器 WebRTC / RNNoise 延迟统计不适用于此路径；本机音频组件遥测见音频设置。</p> : <LegacyLatencyPanel/>;
}
function LegacyLatencyPanel() {
  useTranslation();
  const { latency, modeLabel } = useVoiceLatency(true);

  const hasNetworkData = latency.networkRttMs !== null;
  // Settings gets opened while screen sharing. The page unmounts when you leave it, which hides these again.
  const [addressesShown, setAddressesShown] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <span className="font-medium text-sm">{i18n.t("settingsFull.m07e6721704")}</span>
        <Chip tone="neutral">{modeLabel}</Chip>
      </div>

      {/* Estimated total with rating */}
      <div className="flex p-3 flex-col gap-2" style={{
          background: "var(--gryt-neutral-3)",
          borderRadius: "var(--gryt-radius-md)",
          border: "1px solid var(--gryt-neutral-5)",
        }}>
        <div className="flex justify-between items-center">
          <span className="text-sm font-bold">{i18n.t("settingsFull.m434e5b512f")}</span>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold" style={{ color: ratingColor(latency.estimatedOneWayMs), fontFamily: "var(--code-font-family)" }}>
              {ms(latency.estimatedOneWayMs)}
            </span>
            <Chip tone="neutral"
              color={
                latency.estimatedOneWayMs === null ? "gray"
                  : latency.estimatedOneWayMs < 30 ? "green"
                    : latency.estimatedOneWayMs < 80 ? "blue"
                      : latency.estimatedOneWayMs < 150 ? "orange" : "red"
              }
            >
              {ratingLabel(latency.estimatedOneWayMs)}
            </Chip>
          </div>
        </div>

        <LatencyBar latency={latency} />
      </div>

      {/* Pipeline breakdown */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-bold text-gryt-muted">{i18n.t("settingsFull.m6c79474a23")}</span>
        <LatencyRow label={i18n.t("settingsFull.ma6a3aaec7d")} value={latency.contextBaseLatencyMs} />
        <LatencyRow label={i18n.t("settingsFull.m70d20b3e25")} value={latency.contextOutputLatencyMs} />
        <LatencyRow
          label={i18n.t("settingsFull.m2867146e76")}
          value={latency.rnnoiseBufferMs}
          color={latency.rnnoiseBufferMs !== null && latency.rnnoiseBufferMs > 50 ? "var(--gryt-warning-11)" : undefined}
        />
        <LatencyRow label={i18n.t("settingsFull.m1cc3f43676")} value={latency.localPipelineMs} />
      </div>

      {/* Network breakdown */}
      {hasNetworkData && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold text-gryt-muted">{i18n.t("settingsFull.m53ebc572b4")}</span>
          <LatencyRow label={i18n.t("settingsFull.mb78a6d1c81")} value={latency.networkRttMs} />
          <LatencyRow label={i18n.t("settingsFull.m4596fe1e8e")} value={latency.oneWayNetworkMs} />
          <LatencyRow
            label={i18n.t("settingsFull.m70a5b3c8ee")}
            value={latency.jitterMs}
            color={latency.jitterMs !== null && latency.jitterMs > 20 ? "var(--gryt-warning-11)" : undefined}
          />
          <LatencyRow
            label={i18n.t("settingsFull.m195cc0c96c")}
            value={latency.jitterBufferMs}
            color={latency.jitterBufferMs !== null && latency.jitterBufferMs > 80 ? "var(--gryt-warning-11)" : undefined}
          />
        </div>
      )}

      {/* Connection info */}
      {hasNetworkData && (latency.sfuEndpoint || latency.remoteAddress) && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-gryt-muted">{i18n.t("settingsFull.m6512ee1541")}</span>
            <Button tone="ghost" size="xsmall" aria-pressed={addressesShown} onClick={() => setAddressesShown((s) => !s)}>
              <PiEyeFill size={14} />
              {addressesShown ? i18n.t("settingsFull.m039ccd4b37") : i18n.t("settingsFull.mc192e1f085")}
            </Button>
          </div>
          {latency.sfuEndpoint && (
            <AddressRow label={i18n.t("settingsFull.mfba9578f25")} address={latency.sfuEndpoint.replace(/^wss?:\/\//, "")} shown={addressesShown} />
          )}
          {latency.remoteAddress && (
            <AddressRow label={i18n.t("settingsFull.m3363df424b")} address={latency.remoteAddress} shown={addressesShown} />
          )}
          {latency.localAddress && (
            <AddressRow label={i18n.t("settingsFull.m2825669b46")} address={latency.localAddress} shown={addressesShown} />
          )}
          {latency.candidateType && (
            <div className="flex justify-between items-center py-1">
              <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m5b4c7385b2")}</span>
              <span className="text-xs font-medium" style={{ fontFamily: "var(--code-font-family)" }}>
                {latency.candidateType}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Transport stats */}
      {hasNetworkData && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold text-gryt-muted">{i18n.t("settingsFull.mc10d76c9a4")}</span>
          <div className="flex justify-between items-center py-1">
            <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.ma336769a99")}</span>
            <span className="text-xs font-medium" style={{ fontFamily: "var(--code-font-family)" }}>
              {latency.codec || "—"}
            </span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.md153e75080")}</span>
            <span className="text-xs font-medium" style={{ fontFamily: "var(--code-font-family)" }}>
              {latency.bitrateKbps !== null ? `${latency.bitrateKbps.toFixed(1)} kbps` : "—"}
            </span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m1795330406")}</span>
            <span className="text-xs font-medium" style={{ fontFamily: "var(--code-font-family)" }}>
              {latency.availableOutKbps !== null ? `${Math.round(latency.availableOutKbps)} kbps` : "—"}
            </span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m2050934de9")}</span>
            <span className="text-xs font-medium" style={{ fontFamily: "var(--code-font-family)" }}>
              {latency.packetsSent ?? "—"} / {latency.packetsReceived ?? "—"}
            </span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.m530423de22")}</span>
            <span className="text-xs font-medium" style={{
                fontFamily: "var(--code-font-family)",
                color: latency.packetsLost !== null && latency.packetsLost > 0 ? "var(--gryt-danger-11)" : undefined,
              }}>
              {latency.packetsLost ?? "—"}
            </span>
          </div>
        </div>
      )}

      {!hasNetworkData && (
        <span className="text-xs text-gryt-muted">{i18n.t("settingsFull.maffd25a7da")}</span>
      )}
    </div>
  );
}

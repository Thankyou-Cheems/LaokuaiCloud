import { Button, Checkbox, Chip, Dialog, IconButton, Select, Tooltip } from "@gryt/ui";
import type { ScreenShareFps, ScreenShareQuality } from "@gryt/voice";
import { estimateBitrate, EXPERIMENTAL_FPS_OPTIONS, STANDARD_FPS_OPTIONS } from "@gryt/voice";
import { useCallback, useEffect, useMemo, useState } from "react";

import { i18n, LocalizedText, useTranslation } from "@/i18n";
import type { ScalabilityMode, ScreenShareCodec } from "@/settings";

import { type DesktopSource, isElectron } from "../../../../lib/electron";
import { PiCaretDownFill, PiCaretUpFill, PiMonitorFill, PiScreencastFill, PiSquaresFourFill, PiX } from "../../../../lib/icons";
import { audioScopeHint, currentPlatform } from "../../../../lib/screenShareAudio";

interface ScreenSharePickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quality: ScreenShareQuality;
  onQualityChange: (q: ScreenShareQuality) => void;
  fps: number;
  onFpsChange: (fps: number) => void;
  experimentalScreenShare: boolean;
  gamingMode: boolean;
  onGamingModeChange: (enabled: boolean) => void;
  codec: ScreenShareCodec;
  onCodecChange: (codec: ScreenShareCodec) => void;
  maxBitrate: number;
  onMaxBitrateChange: (bps: number) => void;
  scalabilityMode: ScalabilityMode;
  onScalabilityModeChange: (mode: ScalabilityMode) => void;
  nativeScreenCaptureAvailable?: boolean;
  /** Switch picks a new source for a share that is already running, on the same stream. */
  mode?: "start" | "switch";
  onStart: (opts: { sourceId?: string; withAudio: boolean }) => void;
}

const ALL_QUALITY_OPTIONS: { value: ScreenShareQuality; label: string; height: number }[] = [
  { value: "4k", label: "4K (3840\u00d72160)", height: 2160 },
  { value: "1440p", label: "1440p (2560\u00d71440)", height: 1440 },
  { value: "1080p", label: "1080p (1920\u00d71080)", height: 1080 },
  { value: "720p", label: "720p (1280\u00d7720)", height: 720 },
  { value: "480p", label: "480p (854\u00d7480)", height: 480 },
  { value: "360p", label: "360p (640\u00d7360)", height: 360 },
  { value: "240p", label: "240p (426\u00d7240)", height: 240 },
  { value: "144p", label: "144p (256\u00d7144)", height: 144 },
  { value: "96p", label: "96p (170\u00d796)", height: 96 },
  { value: "64p", label: "64p (114\u00d764)", height: 64 },
  { value: "48p", label: "48p (85\u00d748)", height: 48 },
  { value: "32p", label: "32p (57\u00d732)", height: 32 },
  { value: "24p", label: "24p (43\u00d724)", height: 24 },
  { value: "16p", label: "16p (28\u00d716)", height: 16 },
  { value: "8p", label: "8p (14\u00d78)", height: 8 },
  { value: "4p", label: "4p (7\u00d74)", height: 4 },
];

const CODEC_OPTIONS: { value: ScreenShareCodec; label: string; mime: string }[] = [
  { value: "auto", get label() { return i18n.t("shellFull.ScreenSharePickerModal_tsx_f7a8abf022"); }, mime: "" },
  { value: "h264", label: "H.264", mime: "video/H264" },
  { value: "vp9", label: "VP9", mime: "video/VP9" },
  { value: "av1", label: "AV1", mime: "video/AV1" },
];

const BITRATE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, get label() { return i18n.t("shellFull.ScreenSharePickerModal_tsx_c614ba7c45"); } },
  { value: 1_000_000, label: "1 Mbps" },
  { value: 2_000_000, label: "2 Mbps" },
  { value: 4_000_000, label: "4 Mbps" },
  { value: 6_000_000, label: "6 Mbps" },
  { value: 8_000_000, label: "8 Mbps" },
  { value: 10_000_000, label: "10 Mbps" },
  { value: 15_000_000, label: "15 Mbps" },
  { value: 20_000_000, label: "20 Mbps" },
  { value: 30_000_000, label: "30 Mbps" },
  { value: 50_000_000, label: "50 Mbps" },
];

const SVC_OPTIONS: { value: ScalabilityMode; label: string }[] = [
  { value: "L1T1", get label() { return i18n.t("shellFull.ScreenSharePickerModal_tsx_ff44420ee0"); } },
  { value: "L1T2", get label() { return i18n.t("shellFull.ScreenSharePickerModal_tsx_cad292377c"); } },
  { value: "L1T3", get label() { return i18n.t("shellFull.ScreenSharePickerModal_tsx_36fae6680d"); } },
];

function getAvailableCodecs(): ScreenShareCodec[] {
  const caps = typeof RTCRtpSender !== "undefined"
    ? RTCRtpSender.getCapabilities?.("video")
    : null;
  if (!caps) return ["auto", "h264", "vp9"];
  const mimes = new Set(caps.codecs.map(c => c.mimeType.toLowerCase()));
  const available: ScreenShareCodec[] = ["auto"];
  for (const opt of CODEC_OPTIONS) {
    if (opt.value !== "auto" && mimes.has(opt.mime.toLowerCase())) {
      available.push(opt.value);
    }
  }
  return available;
}

function formatBitrate(bps: number): string {
  const mbps = bps / 1_000_000;
  return mbps >= 10 ? `${Math.round(mbps)} Mbps` : `${mbps.toFixed(1)} Mbps`;
}

function bitrateColor(bps: number): "green" | "yellow" | "red" {
  const mbps = bps / 1_000_000;
  if (mbps < 10) return "green";
  if (mbps <= 30) return "yellow";
  return "red";
}

type Tab = "screens" | "windows";

export function ScreenSharePickerModal({
  open, onOpenChange, quality, onQualityChange,
  fps, onFpsChange, experimentalScreenShare,
  gamingMode, onGamingModeChange,
  codec, onCodecChange,
  maxBitrate, onMaxBitrateChange,
  scalabilityMode, onScalabilityModeChange,
  nativeScreenCaptureAvailable = false,
  mode = "start",
  onStart,
}: ScreenSharePickerModalProps) {
  const { t: tr, i18n: languageSubscription } = useTranslation();
  const language = languageSubscription.resolvedLanguage;
  const switching = mode === "switch";
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("screens");
  const [selected, setSelected] = useState<string | null>(null);
  const [includeAudio, setIncludeAudio] = useState(false);
  const [screenAccess, setScreenAccess] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const inElectron = isElectron();
  const [availableCodecs] = useState(getAvailableCodecs);

  const loadSources = useCallback(async () => {
    if (!inElectron) return;
    const api = window.electronAPI;
    if (!api) return;
    setLoading(true);
    try {
      const s = await api.getDesktopSources();
      setSources(s);
      if (s.length > 0 && !selected) {
        const screens = s.filter((x) => x.sourceType === "screen");
        setSelected(screens[0]?.id ?? s[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [inElectron, selected]);

  useEffect(() => {
    if (open && inElectron) {
      loadSources();
      window.electronAPI?.getScreenCaptureAccess().then(setScreenAccess);
    }
    if (!open) {
      setSelected(null);
      setSources([]);
      setScreenAccess(null);
    }
  }, [open, inElectron, loadSources]);

  useEffect(() => {
    if (!open || !inElectron) return;
    const interval = setInterval(loadSources, 3000);
    return () => clearInterval(interval);
  }, [open, inElectron, loadSources]);

  const filteredSources = sources.filter((s) =>
    tab === "screens" ? s.sourceType === "screen" : s.sourceType === "window",
  );

  const selectedSource = sources.find((s) => s.id === selected);
  const qualityOptions = useMemo(() => {
    const nativeOpt: { value: ScreenShareQuality; label: string }[] = [
      { value: "native", label: selectedSource?.height ? i18n.t("shellFull.ScreenSharePickerModal_tsx_8399363604", { lng: language, value0: selectedSource.width, value1: selectedSource.height }) : i18n.t("shellFull.ScreenSharePickerModal_tsx_4fc6e7f740", { lng: language }) },
    ];
    const sourceHeight = selectedSource?.height;
    const filtered = sourceHeight
      ? ALL_QUALITY_OPTIONS.filter((o) => o.height <= sourceHeight)
      : ALL_QUALITY_OPTIONS;
    // Quality is a ceiling. A smaller source must not overwrite a saved preference.
    const selectedOption = ALL_QUALITY_OPTIONS.find(o => o.value === quality);
    if (selectedOption && !filtered.some(o => o.value === quality)) filtered.push(selectedOption);
    return [...nativeOpt, ...filtered];
  }, [selectedSource, quality, language]);

  const fpsOptions = useMemo(() => {
    const options: { value: ScreenShareFps; label: string; disabled: boolean }[] = STANDARD_FPS_OPTIONS.map(
      (f) => {
        const needsNative = f > 60;
        const disabled = needsNative && !nativeScreenCaptureAvailable;
        let label = `${f} FPS`;
        if (needsNative && nativeScreenCaptureAvailable) label += i18n.t("shellFull.ScreenSharePickerModal_tsx_7f3d7ff065", { lng: language });
        else if (needsNative && !inElectron) label += i18n.t("shellFull.ScreenSharePickerModal_tsx_776be75642", { lng: language });
        else if (needsNative) label += i18n.t("shellFull.ScreenSharePickerModal_tsx_d5fec560f2", { lng: language });
        return { value: f, label, disabled };
      },
    );
    if (experimentalScreenShare) {
      for (const f of EXPERIMENTAL_FPS_OPTIONS) {
        const needsNative = f > 60;
        const disabled = needsNative && !nativeScreenCaptureAvailable;
        let label = `${f} FPS`;
        if (needsNative && nativeScreenCaptureAvailable) label += i18n.t("shellFull.ScreenSharePickerModal_tsx_7f3d7ff065", { lng: language });
        else if (needsNative && !inElectron) label += i18n.t("shellFull.ScreenSharePickerModal_tsx_776be75642", { lng: language });
        else if (needsNative) label += i18n.t("shellFull.ScreenSharePickerModal_tsx_d5fec560f2", { lng: language });
        options.push({ value: f, label, disabled });
      }
    }
    return options;
  }, [experimentalScreenShare, nativeScreenCaptureAvailable, inElectron, language]);

  const estimatedBps = useMemo(
    () => estimateBitrate(quality, fps),
    [quality, fps],
  );

  const svcDisabled = codec === "h264" || codec === "auto";

  const handleShare = () => {
    onStart({ sourceId: selected ?? undefined, withAudio: includeAudio });
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[40rem]">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PiScreencastFill size={16} />
              <Dialog.Title>{switching ? i18n.t("shellFull.ScreenSharePickerModal_tsx_cbf3b15d27") : i18n.t("shellFull.ScreenSharePickerModal_tsx_a72f69f37a")}</Dialog.Title>
            </div>
            <Dialog.Close>
              <IconButton tone="ghost" size="xsmall" onClick={() => onOpenChange(false)}>
                <PiX size={16} />
              </IconButton>
            </Dialog.Close>
          </div>

          {inElectron && <div className="flex flex-wrap gap-2">
            <Button size="xsmall"
              onClick={() => setTab("screens")}
            >
              <PiMonitorFill size={14} />{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_ac0c7c727e" />}</Button>
            <Button size="xsmall"
              onClick={() => setTab("windows")}
            >
              <PiSquaresFourFill size={14} />{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_26d9c28d78" />}</Button>
          </div>}

          {screenAccess !== null && screenAccess !== "granted" && (
            <div className="flex items-center gap-3 px-3 py-2" style={{
                borderRadius: "var(--gryt-radius-sm)",
                background: "var(--gryt-warning-3)",
                border: "1px solid var(--gryt-warning-6)",
              }}>
              <span className="text-sm text-gryt-warning" style={{ flex: 1 }}>{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_4d91595ad9" />}{" "}
                <strong>{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_9d601e973d" />}</strong>{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_4aaa0c4cee" />}</span>
              <Button tone="neutral" size="xsmall"
                style={{ flexShrink: 0 }}
                onClick={() => window.electronAPI?.openExternal(
                  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
                )}
              >{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_134635e9a2" />}</Button>
            </div>
          )}

          {inElectron ? <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 8,
              maxHeight: 320,
              overflow: "auto",
            }}
          >
            {loading && sources.length === 0 && (
              <span className="text-sm text-gryt-muted" style={{ gridColumn: "1 / -1", textAlign: "center", padding: 24 }}>{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_2ebe7123dc" />}</span>
            )}
            {!loading && filteredSources.length === 0 && (
              <span className="text-sm text-gryt-muted" style={{ gridColumn: "1 / -1", textAlign: "center", padding: 24 }}>
                {tab === "screens" ? i18n.t("shellFull.noScreens") : i18n.t("shellFull.noWindows")}
              </span>
            )}
            {filteredSources.map((src) => (
              <div className="flex flex-col gap-1" key={src.id} onClick={() => setSelected(src.id)} style={{
                  cursor: "pointer",
                  borderRadius: "var(--gryt-radius-md)",
                  border: selected === src.id ? "2px solid var(--gryt-accent-9)" : "2px solid transparent",
                  padding: 4,
                  background: selected === src.id ? "var(--gryt-accent-3)" : "var(--gryt-neutral-3)",
                  transition: "border-color 0.15s, background 0.15s",
                }}>
                <div style={{ position: "relative", aspectRatio: "16 / 9", borderRadius: "var(--gryt-radius-sm)", overflow: "hidden", background: "#000" }}>
                  {src.thumbnail ? (
                    <img
                      src={src.thumbnail}
                      alt={src.name}
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                      draggable={false}
                    />
                  ) : (
                    <div className="flex items-center justify-center" style={{ width: "100%", height: "100%" }}>
                      {src.sourceType === "screen" ? <PiMonitorFill size={24} /> : <PiSquaresFourFill size={24} />}
                    </div>
                  )}
                  {selected === src.id && (
                    <Chip tone="secondary"
                      style={{ position: "absolute", top: 4, right: 4 }}
                     label={i18n.t("shellFull.ScreenSharePickerModal_tsx_9a976fc228")} />
                  )}
                </div>
                <div className="flex items-center gap-1 px-1">
                  {src.appIcon && src.sourceType === "window" && (
                    <img src={src.appIcon} alt="" style={{ width: 14, height: 14 }} draggable={false} />
                  )}
                  <span className="text-xs truncate" style={{ flex: 1 }}>
                    {src.name}
                  </span>
                </div>
              </div>
            ))}
          </div> : <p className="text-sm text-gryt-muted">{tr("ui.chooseScreenInBrowser")}</p>}

          <div className="flex items-center gap-4 flex-wrap">
            <Tooltip title={i18n.t("shellFull.ScreenSharePickerModal_tsx_2c8f845bfc")}>
              <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <Checkbox checked={includeAudio} onCheckedChange={(v) => setIncludeAudio(v === true)} />{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_10308c7566" />}</label>
            </Tooltip>

            <Tooltip title={i18n.t("shellFull.ScreenSharePickerModal_tsx_c2349faa69")}>
              <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <Checkbox checked={gamingMode} onCheckedChange={(v) => onGamingModeChange(v === true)} />{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_b85086dd9c" />}</label>
            </Tooltip>

            <div className="flex min-w-0 items-center gap-2 ml-auto">
              <Tooltip title={i18n.t("shellFull.ScreenSharePickerModal_tsx_b7afdfa3cb")}>
                <span className="text-sm" style={{ cursor: "help", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}>{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_a60f2c7360" />}</span>
              </Tooltip>
              <Select
                className="min-w-0"
                value={quality}
                onValueChange={(v) => onQualityChange(v as ScreenShareQuality)}
                options={qualityOptions.map((o) => ({ label: o.label, value: o.value }))}
              />
            </div>

            <div className="flex min-w-0 items-center gap-2">
              <Tooltip title={i18n.t("shellFull.ScreenSharePickerModal_tsx_6cdaa55c4e")}>
                <span className="text-sm" style={{ cursor: "help", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}>{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_fce204ae55" />}</span>
              </Tooltip>
              <Select
                className="min-w-0"
                value={String(fps)}
                onValueChange={(v) => onFpsChange(Number(v))}
                options={fpsOptions.map((o) => ({
                  label: o.label,
                  value: String(o.value),
                  disabled: o.disabled,
                }))}
              />
            </div>
          </div>

          {includeAudio && (
            <span className="text-xs text-gryt-muted">{audioScopeHint(currentPlatform(), selected, i18n)}</span>
          )}

          {/* Codec and SVC layers are fixed once the share's sender exists, so a switch can't change them. */}
          {!switching && <div className="flex flex-col gap-3">
            <Button tone="ghost" size="xsmall"
              onClick={() => setShowAdvanced(v => !v)}
              style={{ alignSelf: "flex-start", cursor: "pointer" }}
            >
              {showAdvanced ? <PiCaretUpFill size={14} /> : <PiCaretDownFill size={14} />}{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_4d06472695" />}</Button>

            {showAdvanced && (
              <div className="flex flex-col gap-3 px-3 py-3" style={{
                  borderRadius: "var(--gryt-radius-sm)",
                  background: "var(--gryt-neutral-3)",
                }}>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Tooltip title={i18n.t("shellFull.ScreenSharePickerModal_tsx_4bf87851fb")}>
                      <span className="text-sm" style={{ cursor: "help", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}>{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_a336769a99" />}</span>
                    </Tooltip>
                    <Select
                      value={codec}
                      onValueChange={(v) => onCodecChange(v as ScreenShareCodec)}
                      options={CODEC_OPTIONS.filter((o) =>
                        availableCodecs.includes(o.value),
                      ).map((o) => ({ label: o.label, value: o.value }))}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Tooltip title={i18n.t("shellFull.ScreenSharePickerModal_tsx_fb92b3710f")}>
                      <span className="text-sm" style={{ cursor: "help", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}>{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_d153e75080" />}</span>
                    </Tooltip>
                    <Select
                      value={String(maxBitrate)}
                      onValueChange={(v) => onMaxBitrateChange(Number(v))}
                      options={BITRATE_OPTIONS.map((o) => ({
                        label: o.label,
                        value: String(o.value),
                      }))}
                    />
                  </div>

                  <div className="flex items-center gap-2" style={svcDisabled ? { opacity: 0.5 } : undefined}>
                    <Tooltip title={svcDisabled
                      ? i18n.t("shellFull.ScreenSharePickerModal_tsx_fadba030f2")
                      : i18n.t("shellFull.ScreenSharePickerModal_tsx_bc289d3d61")
                    }>
                      <span className="text-sm" style={{ cursor: "help", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}>{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_139764b90d" />}</span>
                    </Tooltip>
                    <Select
                      value={scalabilityMode}
                      onValueChange={(v) =>
                        onScalabilityModeChange(v as ScalabilityMode)
                      }
                      disabled={svcDisabled}
                      options={SVC_OPTIONS.map((o) => ({
                        label: o.label,
                        value: o.value,
                      }))}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>}

          {fps > 60 && nativeScreenCaptureAvailable && (
            <div className="flex items-center gap-2 px-3 py-1" style={{
                borderRadius: "var(--gryt-radius-sm)",
                background: "var(--gryt-success-3)",
              }}>
              <Chip tone="success" label={i18n.t("shellFull.ScreenSharePickerModal_tsx_fa0682af73")} />
              <span className="text-xs text-gryt-success">
                {i18n.t("shellFull.dxgiCapture", { fps })}
              </span>
            </div>
          )}

          {(maxBitrate > 0 || estimatedBps !== null) && (
            <div className="flex items-center gap-2 px-3 py-2" style={{
                borderRadius: "var(--gryt-radius-sm)",
                background: "var(--gryt-neutral-3)",
              }}>
              <span className="text-sm font-medium">
                {maxBitrate > 0 ? i18n.t("shellFull.ScreenSharePickerModal_tsx_fa1da0b1bf") : i18n.t("shellFull.ScreenSharePickerModal_tsx_da41c3c391")}
              </span>
              <Chip tone="neutral"
                color={bitrateColor(maxBitrate > 0 ? maxBitrate : estimatedBps!)}
              >
                {formatBitrate(maxBitrate > 0 ? maxBitrate : estimatedBps!)}
              </Chip>
              {(maxBitrate > 0 ? maxBitrate : estimatedBps!) / 1_000_000 > 30 && (
                <span className="text-xs text-gryt-danger">{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_0c6f5894cd" />}</span>
              )}
            </div>
          )}
          {maxBitrate === 0 && estimatedBps === null && (
            <div className="flex items-center gap-2 px-3 py-2" style={{
                borderRadius: "var(--gryt-radius-sm)",
                background: "var(--gryt-neutral-3)",
              }}>
              <span className="text-sm text-gryt-muted">{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_28b4743693" />}</span>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button tone="neutral" size="small" onClick={() => onOpenChange(false)}>{<LocalizedText translationKey="shellFull.ScreenSharePickerModal_tsx_77dfd2135f" />}</Button>
            <Button size="small" onClick={handleShare} disabled={inElectron && !selected}>
              {switching ? i18n.t("shellFull.ScreenSharePickerModal_tsx_3e44c92042") : i18n.t("shellFull.ScreenSharePickerModal_tsx_09ca55ca52")}
            </Button>
          </div>
        </div>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

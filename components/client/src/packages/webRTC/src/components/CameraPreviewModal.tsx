import { Button, Checkbox, Chip, Dialog, IconButton, Select } from "@gryt/ui";
import { CAMERA_FPS_OPTIONS, type CameraQuality, QUALITY_CONSTRAINTS } from "@gryt/voice";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { i18n, LocalizedText, useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { PiArrowsClockwiseFill, PiVideoCameraFill, PiX } from "../../../../lib/icons";

interface CameraPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cameraID: string;
  onCameraIDChange: (id: string) => void;
  quality: string;
  onQualityChange: (q: string) => void;
  fps: number;
  onFpsChange: (fps: number) => void;
  mirrored: boolean;
  onMirroredChange: (m: boolean) => void;
  flipped: boolean;
  onFlippedChange: (f: boolean) => void;
  onStart: () => void;
}

const QUALITY_OPTIONS: { value: CameraQuality; label: string }[] = [
  { value: "native", get label() { return i18n.t("shellFull.CameraPreviewModal_tsx_4fc6e7f740"); } },
  { value: "4k", label: "4K" },
  { value: "1440p", label: "1440p" },
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
  { value: "480p", label: "480p" },
  { value: "360p", label: "360p" },
  { value: "240p", label: "240p" },
  { value: "144p", label: "144p" },
  { value: "96p", label: "96p" },
  { value: "64p", label: "64p" },
  { value: "48p", label: "48p" },
  { value: "32p", label: "32p" },
  { value: "24p", label: "24p" },
  { value: "16p", label: "16p" },
  { value: "8p", label: "8p" },
  { value: "4p", label: "4p" },
];


export function CameraPreviewModal({
  open,
  onOpenChange,
  cameraID,
  onCameraIDChange,
  quality,
  onQualityChange,
  fps,
  onFpsChange,
  mirrored,
  onMirroredChange,
  flipped,
  onFlippedChange,
  onStart,
}: CameraPreviewModalProps) {
  useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [localCameraID, setLocalCameraID] = useState(cameraID);
  const [localQuality, setLocalQuality] = useState(quality);
  const [localFps, setLocalFps] = useState(fps);
  const [localMirrored, setLocalMirrored] = useState(mirrored);
  const { faceFramingEnabled, setFaceFramingEnabled } = useSettings();
  const [localFlipped, setLocalFlipped] = useState(flipped);
  const [retryCount, setRetryCount] = useState(0);
  const [maxCameraHeight, setMaxCameraHeight] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setLocalCameraID(cameraID);
      setLocalQuality(quality);
      setLocalFps(fps);
      setLocalMirrored(mirrored);
      setLocalFlipped(flipped);
    }
  }, [open, cameraID, quality, fps, mirrored, flipped]);

  const startPreview = useCallback(async (deviceId: string, q: string, fpsVal: number) => {
    const qc = QUALITY_CONSTRAINTS[q as CameraQuality] ?? QUALITY_CONSTRAINTS.native;
    const videoConstraints: MediaTrackConstraints = {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      frameRate: { ideal: fpsVal || 30 },
    };
    if (qc.width) {
      videoConstraints.width = { ideal: qc.width };
      videoConstraints.height = { ideal: qc.height };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });
      return stream;
    } catch {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { ideal: deviceId } } : true,
        audio: false,
      });
      return stream;
    }
  }, []);

  function friendlyPreviewError(err: unknown): string {
    const name = err instanceof DOMException ? err.name : "";
    switch (name) {
      case "NotReadableError":
      case "AbortError":
        return i18n.t("shellFull.CameraPreviewModal_tsx_d3a459e832");
      case "NotAllowedError":
        return i18n.t("shellFull.CameraPreviewModal_tsx_943c71580e");
      case "NotFoundError":
        return i18n.t("shellFull.CameraPreviewModal_tsx_c565276577");
      case "OverconstrainedError":
        return i18n.t("shellFull.CameraPreviewModal_tsx_8ca1b13b17");
      default:
        return i18n.t("shellFull.CameraPreviewModal_tsx_fbd6338b57");
    }
  }

  const loadDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    const video = all.filter((d) => d.kind === "videoinput");
    setDevices(video);
    if (video.length > 0 && !localCameraID) {
      setLocalCameraID(video[0].deviceId);
    }
  }, [localCameraID]);

  useEffect(() => {
    if (!open) {
      if (previewStream) {
        previewStream.getTracks().forEach((t) => t.stop());
        setPreviewStream(null);
      }
      return;
    }

    let cancelled = false;
    setPreviewError(null);

    (async () => {
      await loadDevices();

      try {
        const stream = await startPreview(localCameraID, localQuality, localFps);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setPreviewStream((prev) => {
          if (prev) prev.getTracks().forEach((t) => t.stop());
          return stream;
        });
        setPreviewError(null);

        const all = await navigator.mediaDevices.enumerateDevices();
        const video = all.filter((d) => d.kind === "videoinput");
        setDevices(video);

        const actual = stream.getVideoTracks()[0]?.getSettings().deviceId;
        if (actual && actual !== localCameraID) {
          setLocalCameraID(actual);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[Camera] Preview failed:", err);
          setPreviewError(friendlyPreviewError(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, localCameraID, localQuality, localFps, retryCount]);

  const [actualRes, setActualRes] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (videoRef.current && previewStream) {
      videoRef.current.srcObject = previewStream;
    }
  }, [previewStream]);

  useEffect(() => {
    if (!previewStream) {
      setActualRes(null);
      return;
    }
    const track = previewStream.getVideoTracks()[0];
    if (!track) return;
    const readRes = () => {
      const { width, height } = track.getSettings();
      if (width && height) setActualRes({ w: width, h: height });
    };
    readRes();
    const id = window.setInterval(readRes, 1000);
    return () => window.clearInterval(id);
  }, [previewStream]);

  useEffect(() => {
    if (!previewStream) {
      setMaxCameraHeight(null);
      return;
    }
    const track = previewStream.getVideoTracks()[0];
    if (!track) return;
    try {
      const caps = track.getCapabilities();
      setMaxCameraHeight(caps.height?.max ?? null);
    } catch {
      setMaxCameraHeight(null);
    }
  }, [previewStream]);

  const filteredOptions = useMemo(() => {
    if (!maxCameraHeight) return QUALITY_OPTIONS;
    return QUALITY_OPTIONS.filter((opt) => {
      if (opt.value === "native") return true;
      const c = QUALITY_CONSTRAINTS[opt.value];
      return !c?.height || c.height <= maxCameraHeight;
    });
  }, [maxCameraHeight]);

  useEffect(() => {
    if (!maxCameraHeight) return;
    const c = QUALITY_CONSTRAINTS[localQuality as CameraQuality];
    if (c?.height && c.height > maxCameraHeight) {
      setLocalQuality("native");
    }
  }, [maxCameraHeight, localQuality]);

  const handleClose = () => {
    if (previewStream) {
      previewStream.getTracks().forEach((t) => t.stop());
      setPreviewStream(null);
    }
    onOpenChange(false);
  };

  const handleStart = () => {
    if (previewStream) {
      previewStream.getTracks().forEach((t) => t.stop());
      setPreviewStream(null);
    }
    onCameraIDChange(localCameraID);
    onQualityChange(localQuality);
    onFpsChange(localFps);
    onMirroredChange(localMirrored);
    onFlippedChange(localFlipped);
    onStart();
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PiVideoCameraFill size={16} />
              <Dialog.Title>{<LocalizedText translationKey="shellFull.CameraPreviewModal_tsx_3005cb168c" />}</Dialog.Title>
            </div>
            <Dialog.Close>
              <IconButton tone="ghost" size="xsmall" onClick={handleClose}>
                <PiX size={16} />
              </IconButton>
            </Dialog.Close>
          </div>

          <div
            style={{
              position: "relative",
              aspectRatio: "16 / 9",
              borderRadius: "var(--gryt-radius-md)",
              overflow: "hidden",
              background: "#000",
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: (localFlipped !== localMirrored) ? "scaleX(-1)" : undefined,
              }}
            />
            {previewStream && actualRes && (
              <Chip tone="neutral"
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  background: "rgba(0,0,0,0.65)",
                  backdropFilter: "blur(4px)",
                  color: "#fff",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {actualRes.w}×{actualRes.h}
              </Chip>
            )}
            {!previewStream && (
              <div className="flex items-center justify-center flex-col gap-2" style={{ position: "absolute", inset: 0 }}>
                <span className="text-sm" color={previewError ? "red" : "gray"}>
                  {previewError ?? i18n.t("shellFull.CameraPreviewModal_tsx_1393ef466c")}
                </span>
                {previewError && (
                  <Button tone="neutral" size="xsmall" onClick={() => setRetryCount((c) => c + 1)}>
                    <PiArrowsClockwiseFill size={14} />{<LocalizedText translationKey="shellFull.CameraPreviewModal_tsx_9f5cd8a2e8" />}</Button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm" style={{ minWidth: 60 }}>{<LocalizedText translationKey="shellFull.CameraPreviewModal_tsx_4da9c9af96" />}</span>
              <Select
                className="flex-1 min-w-0"
                value={localCameraID}
                onValueChange={(v) => setLocalCameraID(String(v))}
                options={
                  devices.length === 0
                    ? [{ label: i18n.t("shellFull.CameraPreviewModal_tsx_a41e4c7080"), value: "__none__", disabled: true }]
                    : devices.map((d, i) => ({
                        label: d.label || i18n.t("shellFull.CameraPreviewModal_tsx_d935c2ee86", { value0: i + 1 }),
                        value: d.deviceId || `device-${i}`,
                      }))
                }
              />
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm" style={{ minWidth: 60 }}>{<LocalizedText translationKey="shellFull.CameraPreviewModal_tsx_a60f2c7360" />}</span>
              <Select
                className="flex-1"
                value={localQuality}
                onValueChange={(v) => setLocalQuality(String(v))}
                options={filteredOptions.map((o) => ({ label: o.label, value: o.value }))}
              />
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm" style={{ minWidth: 60 }}>{<LocalizedText translationKey="shellFull.CameraPreviewModal_tsx_fce204ae55" />}</span>
              <Select
                className="flex-1"
                value={String(localFps)}
                onValueChange={(v) => setLocalFps(Number(v))}
                options={CAMERA_FPS_OPTIONS.map((f) => ({
                  label: `${f} FPS`,
                  value: String(f),
                }))}
              />
            </div>

            <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <Checkbox checked={localFlipped} onCheckedChange={(v) => setLocalFlipped(v === true)} />{<LocalizedText translationKey="shellFull.CameraPreviewModal_tsx_707f897192" />}</label>

            <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <Checkbox checked={localMirrored} onCheckedChange={(v) => setLocalMirrored(v === true)} />{<LocalizedText translationKey="shellFull.CameraPreviewModal_tsx_a2241ff744" />}</label>

            {/* Here as well as in settings, because this is the moment you are
                looking at your own framing and can see whether it needs it. */}
            <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <Checkbox
                checked={faceFramingEnabled}
                onCheckedChange={(v) => setFaceFramingEnabled(v === true)}
              />{<LocalizedText translationKey="shellFull.CameraPreviewModal_tsx_3e18b35f2c" />}</label>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button tone="neutral" size="small" onClick={handleClose}>{<LocalizedText translationKey="shellFull.CameraPreviewModal_tsx_77dfd2135f" />}</Button>
            <Button size="small" onClick={handleStart} disabled={!previewStream}>{<LocalizedText translationKey="shellFull.CameraPreviewModal_tsx_7014243c18" />}</Button>
          </div>
        </div>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

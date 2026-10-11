import { Button, Chip, Divider, Select, Tooltip } from "@gryt/ui";
import { CAMERA_FPS_OPTIONS, type CameraQuality, QUALITY_CONSTRAINTS, useCamera, useVideoStats } from "@gryt/voice";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { i18n, useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { PiArrowsClockwiseFill } from "../../../../lib/icons";
import { SettingsContainer, ToggleSetting } from "./settingsComponents";
import { settingsMessage } from "./settingsMessage";

const QUALITY_OPTIONS = [
  { value: "native", get label() { return i18n.t("settingsFull.m8f5c232f34"); } },
  { value: "4k", label: "4K (3840×2160)" },
  { value: "1440p", label: "1440p (2560×1440)" },
  { value: "1080p", label: "1080p (1920×1080)" },
  { value: "720p", label: "720p (1280×720)" },
  { value: "480p", label: "480p (854×480)" },
  { value: "360p", label: "360p (640×360)" },
  { value: "240p", label: "240p (426×240)" },
  { value: "144p", label: "144p (256×144)" },
  { value: "96p", label: "96p (170×96)" },
  { value: "64p", label: "64p (114×64)" },
  { value: "48p", label: "48p (85×48)" },
  { value: "32p", label: "32p (57×32)" },
  { value: "24p", label: "24p (43×24)" },
  { value: "16p", label: "16p (28×16)" },
  { value: "8p", label: "8p (14×8)" },
  { value: "4p", label: "4p (7×4)" },
];

export function CameraSettings() {
  const { t: tr } = useTranslation();
  const {
    cameraID,
    setCameraID,
    cameraQuality,
    setCameraQuality,
    cameraFps,
    setCameraFps,
    cameraMirrored,
    setCameraMirrored,
    cameraFlipped,
    setCameraFlipped,
    faceFramingEnabled,
    setFaceFramingEnabled,
  } = useSettings();

  const { cameraEnabled, cameraStream: globalStream, devices, getDevices } = useCamera();

  /**
   * What peers are actually receiving. `track.getSettings()` is the raw camera
   * track, before the encoder, and is routinely a different number (GRYT-31).
   */
  const { outbound } = useVideoStats(cameraEnabled);
  const sent = outbound.find((o) => o.label === "camera") ?? null;
  const sentRes =
    sent?.frameWidth != null && sent?.frameHeight != null
      ? { w: sent.frameWidth, h: sent.frameHeight }
      : null;

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [actualRes, setActualRes] = useState<{ w: number; h: number } | null>(null);
  const [maxCameraHeight, setMaxCameraHeight] = useState<number | null>(null);

  const activeStream = cameraEnabled ? globalStream : previewStream;
  const activeError = cameraEnabled ? null : previewError;

  useEffect(() => {
    getDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPreview = useCallback(async () => {
    if (cameraEnabled) return;
    const quality = QUALITY_CONSTRAINTS[cameraQuality as CameraQuality] ?? QUALITY_CONSTRAINTS.native;
    const fps = cameraFps || 30;
    const videoConstraints: MediaTrackConstraints = {
      ...(cameraID ? { deviceId: { exact: cameraID } } : {}),
      frameRate: { ideal: fps },
    };
    if (quality.width) {
      videoConstraints.width = { ideal: quality.width };
      videoConstraints.height = { ideal: quality.height };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      previewStreamRef.current = stream;
      setPreviewStream(stream);
      setPreviewError(null);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      switch (name) {
        case "NotAllowedError":
          setPreviewError("settingsFull.mf62bc006ec");
          break;
        case "NotFoundError":
          setPreviewError("settingsFull.mc565276577");
          break;
        default:
          setPreviewError("settingsFull.m5658b040af");
      }
    }
  }, [cameraEnabled, cameraID, cameraQuality, cameraFps]);

  const stopPreview = useCallback(() => {
    if (previewStreamRef.current) {
      previewStreamRef.current.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
    }
    setPreviewStream(null);
  }, []);

  // Preview is an explicit action; opening settings never requests camera capture.
  useEffect(() => {
    return () => {
      stopPreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restart preview when device, quality, or fps changes (only when previewing locally)
  useEffect(() => {
    if (!cameraEnabled && previewStreamRef.current) {
      startPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraID, cameraQuality, cameraFps]);

  // If global camera turns on while previewing, stop the local preview
  useEffect(() => {
    if (cameraEnabled) {
      stopPreview();
    }
  }, [cameraEnabled, stopPreview]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = activeStream ?? null;
  }, [activeStream]);

  useEffect(() => {
    if (!activeStream) {
      setActualRes(null);
      return;
    }
    const track = activeStream.getVideoTracks()[0];
    if (!track) return;
    const readRes = () => {
      const { width, height } = track.getSettings();
      if (width && height) setActualRes({ w: width, h: height });
    };
    readRes();
    const id = window.setInterval(readRes, 1000);
    return () => window.clearInterval(id);
  }, [activeStream]);

  useEffect(() => {
    if (!activeStream) {
      setMaxCameraHeight(null);
      return;
    }
    const track = activeStream.getVideoTracks()[0];
    if (!track) return;
    try {
      const caps = track.getCapabilities();
      setMaxCameraHeight(caps.height?.max ?? null);
    } catch {
      setMaxCameraHeight(null);
    }
  }, [activeStream]);

  const filteredOptions = useMemo(() => {
    if (!maxCameraHeight) return QUALITY_OPTIONS;
    return QUALITY_OPTIONS.filter((opt) => {
      if (opt.value === "native") return true;
      const c = QUALITY_CONSTRAINTS[opt.value as CameraQuality];
      return !c?.height || c.height <= maxCameraHeight;
    });
  }, [maxCameraHeight]);

  useEffect(() => {
    if (!maxCameraHeight) return;
    const c = QUALITY_CONSTRAINTS[cameraQuality as CameraQuality];
    if (c?.height && c.height > maxCameraHeight) {
      setCameraQuality("native");
    }
  }, [maxCameraHeight, cameraQuality, setCameraQuality]);

  const differs =
    !!sentRes &&
    !!actualRes &&
    (sentRes.w !== actualRes.w || sentRes.h !== actualRes.h);

  // "none" is the encoder saying it is not limited, which is not worth
  // repeating back to anybody.
  const limitedBy =
    sent?.qualityLimitationReason && sent.qualityLimitationReason !== "none"
      ? sent.qualityLimitationReason
      : null;

  return (
    <SettingsContainer>
      <h2>{i18n.t("ui.camera")}</h2>

      <div className="flex flex-col gap-2">
        <span className="font-medium">{i18n.t("settingsFull.mf1fbb2b43d")}</span>
        <div className="flex items-center justify-center" style={{
            background: "var(--gryt-neutral-3)",
            borderRadius: "var(--gryt-radius-md)",
            overflow: "hidden",
            aspectRatio: "16/9",
            maxHeight: 280,
          }}>
          {activeStream ? (
            <div style={{ position: "relative", width: "100%", height: "100%" }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  transform: (cameraEnabled ? cameraMirrored : (cameraFlipped !== cameraMirrored))
                    ? "scaleX(-1)" : undefined,
                }}
              />
              {(sentRes ?? actualRes) && (
                <Tooltip
                  title={
                    sentRes
                      ? differs
                        ? i18n.t("settingsFull.md1e7a5f253", { sentWidth: sentRes.w, sentHeight: sentRes.h, actualWidth: actualRes?.w, actualHeight: actualRes?.h, limitation: limitedBy ? i18n.t("settingsFull.mc9ef84da7d", { reason: i18n.t("settingsFull.cameraLimit." + limitedBy, { defaultValue: limitedBy }) }) : "" })
                        : i18n.t("settingsFull.m0abfcf3460", { value0: sentRes.w, value1: sentRes.h })
                      : i18n.t("settingsFull.m141da5010b")
                  }
                >
                  <Chip tone="neutral"
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      background: "rgba(0,0,0,0.65)",
                      backdropFilter: "blur(4px)",
                      // The tone prop cannot carry this: the inline background
                      // overrides what a warning tone would paint.
                      color: differs ? "var(--gryt-warning-9)" : "#fff",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {sentRes
                      ? i18n.t("settingsFull.m942ec819c6", { value0: sentRes.w, value1: sentRes.h })
                      : `${actualRes?.w}×${actualRes?.h}`}
                  </Chip>
                </Tooltip>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 p-4">
              <span color={activeError ? "red" : "gray"}>
                {(settingsMessage(activeError) || undefined) ?? i18n.t("settingsFull.m0fb2c372ed")}
              </span>
              {!cameraEnabled && (
                <Button tone="neutral" size="xsmall" onClick={startPreview}>
                  <PiArrowsClockwiseFill size={14} />
                  {activeError ? tr("ui.retry") : tr("ui.startCameraPreview")}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <Divider />

      <div className="flex flex-col gap-2">
        <span className="font-medium">{i18n.t("settingsFull.mf6bb9861ed")}</span>
        <Select
          value={cameraID || ""}
          onValueChange={(value) => setCameraID(String(value))}
          placeholder={i18n.t("settingsFull.me3367f73c0")}
          options={
            devices.length === 0
              ? [{ label: i18n.t("settingsFull.ma41e4c7080"), value: "__none__", disabled: true }]
              : devices.map((device) => ({
                  label: device.label || i18n.t("settingsFull.mde2911d9b0", { value0: device.deviceId.slice(0, 8) }),
                  value: device.deviceId || `device-${device.label}`,
                }))
          }
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-medium">{i18n.t("settingsFull.m13c634ddf1")}</span>
        <Select
          value={cameraQuality}
          onValueChange={(value) => setCameraQuality(String(value))}
          options={filteredOptions.map((opt) => ({
            label: opt.label,
            value: opt.value,
          }))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-medium">{i18n.t("settingsFull.m990444a7e2")}</span>
        <Select
          value={String(cameraFps)}
          onValueChange={(v) => setCameraFps(Number(v))}
          options={CAMERA_FPS_OPTIONS.map((fps) => ({
            label: `${fps} FPS`,
            value: String(fps),
          }))}
        />
      </div>

      <ToggleSetting
        anchorId="flip-camera"
        title={i18n.t("settingsFull.med114d76bc")}
        description={i18n.t("settingsFull.md00dfd3b06")}
        checked={cameraFlipped}
        onCheckedChange={setCameraFlipped}
      />

      <ToggleSetting
        anchorId="center-my-face-automatically"
        title={i18n.t("settingsFull.m3e18b35f2c")}
        description={i18n.t("settingsFull.m44c573fd1f")}
        checked={faceFramingEnabled}
        onCheckedChange={setFaceFramingEnabled}
      />


      <ToggleSetting
        anchorId="mirror-preview"
        title={i18n.t("settingsFull.ma2241ff744")}
        description={i18n.t("settingsFull.mc768c5bd9f")}
        checked={cameraMirrored}
        onCheckedChange={setCameraMirrored}
      />
    </SettingsContainer>
  );
}

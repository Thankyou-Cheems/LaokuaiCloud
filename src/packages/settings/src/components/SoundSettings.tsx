import { Button, IconButton, Slider, Switch, Tooltip } from "@gryt/ui";
import { useEffect, useRef, useState } from "react";

import { i18n, useTranslation } from "@/i18n";
import { type NotificationPlayback, playNotificationSound } from "@/lib/notificationSound";

import { PiArrowsClockwiseFill, PiCheck, PiPlayFill, PiStopFill } from "../../../../lib/icons";

interface SoundSettingsProps {
  label: string;
  description: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  defaultVolume: number;
  customSoundFile: string | null;
  onCustomSoundFileChange: (file: string | null) => void;
  defaultSoundSrc: string;
  showAlert: (
    type: "success" | "error",
    title: string,
    message: string,
  ) => void;
}

export function SoundSettings({
  label,
  description,
  enabled,
  onEnabledChange,
  volume,
  onVolumeChange,
  defaultVolume,
  customSoundFile,
  onCustomSoundFileChange,
  defaultSoundSrc,
  showAlert,
}: SoundSettingsProps) {
  useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const playback = useRef<NotificationPlayback | null>(null);
  const stopSound = () => { playback.current?.stop(); playback.current = null; setIsPlaying(false); };
  useEffect(() => {
    playback.current?.stop(); playback.current = null; setIsPlaying(false);
    return () => { playback.current?.stop(); playback.current = null; };
  }, [customSoundFile, defaultSoundSrc, volume]);

  useEffect(() => {
    if (!customSoundFile) return;

    const isBlobUrl = (url: string) => url.startsWith("blob:");
    const isDataUrl = (url: string) => url.startsWith("data:");

    const validate = (): Promise<boolean> =>
      new Promise((resolve) => {
        if (isBlobUrl(customSoundFile)) {
          resolve(false);
          return;
        }

        if (
          !isDataUrl(customSoundFile) &&
          !customSoundFile.startsWith("/") &&
          !customSoundFile.startsWith("./")
        ) {
          resolve(false);
          return;
        }

        const audio = new Audio();
        const timeoutId = setTimeout(() => resolve(false), 5000);

        audio.oncanplaythrough = () => {
          clearTimeout(timeoutId);
          resolve(true);
        };

        audio.onerror = () => {
          clearTimeout(timeoutId);
          resolve(false);
        };

        audio.onabort = () => {
          clearTimeout(timeoutId);
          resolve(false);
        };

        try {
          audio.src = customSoundFile;
          audio.load();
        } catch (error) {
          clearTimeout(timeoutId);
          console.error("Error setting sound src:", error);
          resolve(false);
        }
      });

    validate().then((isValid) => {
      if (!isValid) onCustomSoundFileChange(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const maxSizeBytes = 1024 * 1024;
    if (file.size > maxSizeBytes) {
      showAlert(
        "error",
        i18n.t("settingsFull.mdfeb21f17d"),
        i18n.t("settingsFull.m85e1932465", { value0: (file.size / 1024 / 1024).toFixed(2) }),
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) {
        try {
          onCustomSoundFileChange(dataUrl);
          showAlert(
            "success",
            i18n.t("settingsFull.m8a34635299"),
            i18n.t("settingsFull.m2b14786b36", { value0: label }),
          );
        } catch (error) {
          console.error(`Error saving ${label} sound file:`, error);
          showAlert(
            "error",
            i18n.t("settingsFull.mcf4ec19a9d"),
            i18n.t("settingsFull.m322347d099"),
          );
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const resetSound = () => {
    if (isPlaying) stopSound();
    onCustomSoundFileChange(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const resetVolume = () => onVolumeChange(defaultVolume);

  const testSound = () => {
    playback.current?.stop();
    const current = playNotificationSound(customSoundFile || defaultSoundSrc, volume);
    playback.current = current; setIsPlaying(true);
    void current.finished.then(() => {
      if (playback.current === current) { playback.current = null; setIsPlaying(false); }
    });
  };

  const stopSoundTest = () => {
    try {
      stopSound();
    } catch (error) {
      console.error(`Error stopping ${label} sound:`, error);
      setIsPlaying(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <span className="font-medium text-base">
        {label}
      </span>

      <div className="flex items-center justify-between">
        <span className="text-sm text-gryt-muted">
          {description}
        </span>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {enabled && (
        <>
          {/* Volume */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{i18n.t("settingsFull.m3b18e8e332")}</span>
              <div className="flex gap-1">
                <Tooltip
                  title={i18n.t("settingsFull.m656b37db63", { value0: defaultVolume })}
                  side="top"
                >
                  <IconButton tone="ghost" size="xsmall"
                    onClick={resetVolume}
                    disabled={volume === defaultVolume}
                  >
                    <PiArrowsClockwiseFill size={12} />
                  </IconButton>
                </Tooltip>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Slider
                min={0}
                max={100}
                value={volume}
                onValueChange={(next) => {
                  const value = Number(next);
                  if (!Number.isNaN(value)) {
                    onVolumeChange(Math.min(100, Math.max(0, value)));
                  }
                }}
              />
              <span className="text-sm" style={{ minWidth: "36px" }}>
                {volume}%
              </span>
            </div>
          </div>

          {/* Custom Sound File */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{i18n.t("settingsFull.m7c6cd0addd")}</span>
              <Tooltip title={i18n.t("settingsFull.m5045b9154c")} side="top">
                <IconButton tone="ghost" size="xsmall"
                  onClick={resetSound}
                  disabled={!customSoundFile}
                >
                  <PiArrowsClockwiseFill size={12} />
                </IconButton>
              </Tooltip>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                style={{ display: "none" }}
              />
              <Button tone="neutral" size="small"
                onClick={() => fileInputRef.current?.click()}
                style={{ flexGrow: 1 }}
              >
                {customSoundFile ? i18n.t("settingsFull.m1062570190") : i18n.t("settingsFull.m54a2a8411d")}
              </Button>
              <Tooltip title={i18n.t("settingsFull.m95f0d73eac")} side="top">
                {isPlaying ? (
                  <Button tone="danger" size="small"
                    onClick={stopSoundTest}
                  >
                    <PiStopFill size={16} />
                  </Button>
                ) : (
                  <Button tone="ghost" size="small" onClick={testSound}>
                    <PiPlayFill size={16} />
                  </Button>
                )}
              </Tooltip>
            </div>
            {customSoundFile && (
              <span className="text-xs text-gryt-success inline-flex items-center gap-1">
                <PiCheck size={12} />{i18n.t("settingsFull.me55188b5f8")}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

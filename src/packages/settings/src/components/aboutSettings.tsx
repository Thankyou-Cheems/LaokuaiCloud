import { Button, Chip, Divider, Surface, Switch } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { Wordmark } from "@/common";
import { i18n, useTranslation } from "@/i18n";
import { requestWhatsNew } from "@/socket";

import { FaGithub } from "../../../../lib/brandIcons";
import { getElectronAPI, isElectron, isMacAppStoreBuild, isMicrosoftStoreBuild, UpdateStatus } from "../../../../lib/electron";
import { PiArrowsClockwiseFill, PiArrowSquareOutFill, PiBugFill, PiChatCircleDotsFill, PiCheckCircleFill, PiClockClockwiseFill, PiDesktopFill, PiDownloadSimpleFill, PiXCircleFill } from "../../../../lib/icons";
import { useReportForm } from "../../../../lib/reports/useReportForm";
import { ConfirmDialog } from "../../../socket/src/components/ConfirmDialog";
import { nativeUpdateMessage } from "./nativeDisplayCopy";
import { SettingsContainer } from "./settingsComponents";

const GITHUB_URL = "https://github.com/Gryt-chat/gryt";

/* Both stores want these reachable from inside the app rather than only from the
   listing, and the desktop build has no listing at all (GRYT-829). */
const TERMS_URL = "https://gryt.chat/terms";
const PRIVACY_URL = "https://gryt.chat/privacy";

/*
 * "Get the desktop app" sent people to GitHub Releases, which is a collapsed
 * Assets list. /download resolves the build and starts it; no ?os= is needed here.
 */
const DOWNLOAD_URL = "https://gryt.chat/download";

function UpdateControls() {
  useTranslation();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [appVersion, setAppVersion] = useState<string>("…");
  const [betaChannel, setBetaChannel] = useState(false);
  const [slimVariant, setSlimVariant] = useState({ preferred: false, installed: false, pending: false });
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [pendingSwitch, setPendingSwitch] = useState<boolean | null>(null);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;

    api.getAppVersion().then(setAppVersion);
    api.getBetaChannel().then(setBetaChannel);
    /* Absent on builds older than the setting, which read as the full variant
       — true of every build before this one. */
    api.getSlimVariant?.().then(setSlimVariant);
    api.getAutoUpdate().then(setAutoUpdate);
    return api.onUpdateStatus(setStatus);
  }, []);

  const handleAutoUpdateToggle = useCallback((enabled: boolean) => {
    setAutoUpdate(enabled);
    getElectronAPI()?.setAutoUpdate(enabled);
  }, []);

  const handleCheckForUpdates = useCallback(() => {
    getElectronAPI()?.checkForUpdates();
  }, []);

  const confirmChannelSwitch = useCallback(() => {
    if (pendingSwitch === null) return;
    getElectronAPI()?.switchUpdateChannel(pendingSwitch);
  }, [pendingSwitch]);

  const switchingToBeta = pendingSwitch === true;

  const handleUpdateNow = useCallback(() => {
    getElectronAPI()?.restartForUpdate();
  }, []);

  const statusText = (() => {
    if (!status) return null;
    switch (status.status) {
      case "checking":
        return i18n.t("settingsFull.m2817459eb0");
      case "available":
        return i18n.t("settingsFull.m7a0da1b4d7", { value0: status.version });
      case "downloading":
        return i18n.t("settingsFull.ma2a7eb5f41", { value0: status.version, value1: status.percent != null ? `${status.percent}%` : "" });
      case "downloaded":
        return i18n.t("settingsFull.m0a50187b9c", { value0: status.version });
      case "not-available":
        return i18n.t("settingsFull.ma41211af74");
      case "store-managed":
        return status.message === undefined ? i18n.t("settingsFull.m4dbaca0959") : nativeUpdateMessage(status.message);
      case "pending":
        return i18n.t("settingsFull.m6d6cc94126", { value0: status.version });
      case "installing":
        return i18n.t("settingsFull.m1d09e9f274", { value0: status.version });
      case "error":
        return i18n.t("settingsFull.me6a816d199", { value0: nativeUpdateMessage(status.message) });
      default:
        return null;
    }
  })();

  const statusColor = (() => {
    if (!status) return "gray" as const;
    switch (status.status) {
      case "available":
      case "downloading":
        return "blue" as const;
      case "downloaded":
      case "pending":
      case "installing":
        return "green" as const;
      case "error":
        return "red" as const;
      default:
        return "gray" as const;
    }
  })();

  const isChecking = status?.status === "checking";
  const isAvailable = status?.status === "available";
  // "downloaded" can still arrive from a check that ran before this build's
  // change landed. Treat it as "available": either way, restart.
  const isReady = status?.status === "downloaded";
  // Neither button helps while an install is running: restarting starts a second
  // cycle and destroys the first. Quitting is the whole remaining action.
  const isPending = status?.status === "pending" || status?.status === "installing";
  const isBusy = isChecking;

  return (
    <>
      <Divider />

      <h2>{i18n.t("ui.updates")}</h2>

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="font-medium">{i18n.t("settingsFull.m73989d9c59")}</span>
          <Chip tone="neutral">v{appVersion}</Chip>
          <Button tone="ghost" size="xsmall" onClick={requestWhatsNew}>{i18n.t("settingsFull.m3697024201")}</Button>
          {betaChannel && <Chip tone="warning" label={i18n.t("settingsFull.mf03b60f7e5")} />}
          {/* What is installed, not what has been asked for: a pending switch
              is described by the toggle below. */}
          {slimVariant.installed && <Chip tone="neutral" label={i18n.t("settingsFull.m5ee371a198")} />}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="font-medium">{i18n.t("settingsFull.m1e138bf814")}</span>
            <span className="text-gryt-muted">
              {autoUpdate
                ? i18n.t("settingsFull.m288b594b9a")
                : i18n.t("settingsFull.m25d5b5f8aa")}
            </span>
          </div>
          <Switch checked={autoUpdate} onCheckedChange={handleAutoUpdateToggle} />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="font-medium">{i18n.t("settingsFull.ma7e15aedeb")}</span>
            <span className="text-gryt-muted">
              {slimVariant.pending
                ? slimVariant.preferred
                  ? i18n.t("settingsFull.m6946ef7bbe")
                  : i18n.t("settingsFull.m07cbcb391d")
                : slimVariant.preferred
                  ? i18n.t("settingsFull.m8b4e29726a")
                  : i18n.t("settingsFull.m792e6724c1")}
            </span>
            <span className="text-gryt-muted">{i18n.t("settingsFull.mea6453f61e")}</span>
          </div>
          <Switch
            checked={!slimVariant.preferred}
            onCheckedChange={(enabled) => {
              window.electronAPI?.setSlimVariant?.(!enabled);
              setSlimVariant((prev) => ({ ...prev, preferred: !enabled, pending: !enabled !== prev.installed }));
            }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="font-medium">{i18n.t("settingsFull.m3c684d47d5")}</span>
            <span className="text-gryt-muted">
              {betaChannel
                ? i18n.t("settingsFull.mfdaeee7cb9")
                : i18n.t("settingsFull.mdcafa8dc54")}
            </span>
          </div>
          <Switch checked={betaChannel} onCheckedChange={(enabled) => setPendingSwitch(enabled)} />
        </div>

        {/* Something is always said here. The panel used to lead with a version
            badge and show nothing else until a check finished, so a version
            that had not moved was the only thing to read, and it reads as
            failure. It cannot move without a restart: updates install while
            Gryt starts, never from the running app. */}
        {!statusText && (
          <span className="text-gryt-muted">{i18n.t("settingsFull.m361186da5f")}</span>
        )}

        {statusText && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              {isReady && <PiClockClockwiseFill size={16} color="var(--gryt-success-9)" />}
              {(status?.status === "not-available" || status?.status === "store-managed") && (
                <PiCheckCircleFill size={16} color="var(--gryt-success-9)" />
              )}
              {status?.status === "error" && <PiXCircleFill size={16} color="var(--gryt-danger-9)" />}
              <span color={statusColor}>{statusText}</span>
            </div>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          {!isAvailable && !isReady && !isPending && (
            <Button tone="neutral" size="small"
              onClick={handleCheckForUpdates}
              disabled={isBusy}
            >
              <PiArrowsClockwiseFill size={16} />
              {isChecking ? i18n.t("settingsFull.m820d6004b0") : i18n.t("settingsFull.m8604ff8e6a")}
            </Button>
          )}

          {/* One step. Downloading and installing both happen on the next
              launch, where the installer has an empty app to work around
              instead of a loaded one. */}
          {(isAvailable || isReady) && !isPending && (
            <Button size="small"
              className="bg-gryt-success text-gryt-bg hover:not-data-disabled:bg-gryt-success/85"
              onClick={handleUpdateNow}
            >
              <PiClockClockwiseFill size={16} />{i18n.t("settingsFull.m5fe4e1955a", { version: status?.version })}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingSwitch !== null}
        onOpenChange={(open) => { if (!open) setPendingSwitch(null); }}
        title={switchingToBeta ? i18n.t("settingsFull.m71f83bc4c1") : i18n.t("settingsFull.mfc99a79776")}
        description={
          switchingToBeta
            ? i18n.t("settingsFull.m11e38b666a")
            : i18n.t("settingsFull.m9a367201e9")
        }
        confirmLabel={switchingToBeta ? i18n.t("settingsFull.m69305ab0ff") : i18n.t("settingsFull.mcc6e95e40a")}
        confirmTone="primary"
        onConfirm={confirmChannelSwitch}
      />
    </>
  );
}

/** The store installs updates here, so none of the switches above would do anything. */
function AppStoreUpdates({ store, os }: { store: string; os: "macos" | "windows" }) {
  useTranslation();
  const [appVersion, setAppVersion] = useState<string>("…");

  useEffect(() => {
    void getElectronAPI()?.getAppVersion().then(setAppVersion);
  }, []);

  return (
    <>
      <Divider />

      <h2>{i18n.t("ui.updates")}</h2>

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="font-medium">{i18n.t("settingsFull.m73989d9c59")}</span>
          <Chip tone="neutral">v{appVersion}</Chip>
          <Button tone="ghost" size="xsmall" onClick={requestWhatsNew}>{i18n.t("settingsFull.m3697024201")}</Button>
        </div>
        <span className="text-gryt-muted">{i18n.t("settingsFull.m160cb6d770", { store })}</span>
      </div>

      <Surface>
        <div className="flex flex-col gap-3">
          <span className="font-medium">{i18n.t("settingsFull.mb895094d4a")}</span>
          <span className="text-gryt-muted">{i18n.t("settingsFull.m20663bdb39", { store })}</span>
          <Button size="small" render={<a href={`${DOWNLOAD_URL}?os=${os}`} target="_blank" rel="noopener noreferrer" />}>
            <PiDownloadSimpleFill size={16} />{i18n.t("settingsFull.m63d4c00e28")}<PiArrowSquareOutFill size={14} />
          </Button>
        </div>
      </Surface>
    </>
  );
}

function DesktopAppCard() {
  useTranslation();
  return (
    <>
      <Divider />

      <Surface>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <PiDesktopFill size={18} />
            <span className="font-medium">{i18n.t("settingsFull.m9c18e2a458")}</span>
          </div>
          <span className="text-gryt-muted">{i18n.t("settingsFull.meff0cd9a92")}</span>
          <span className="text-gryt-muted">{i18n.t("settingsFull.mb0e3c27289")}</span>
          <Button size="small"
            render={
              <a href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" />
            }
          >
            <PiDownloadSimpleFill size={16} />{i18n.t("settingsFull.m8a8c7f19e8")}<PiArrowSquareOutFill size={14} />
          </Button>
        </div>
      </Surface>
    </>
  );
}

export function AboutSettings() {
  useTranslation();
  const { open: openReport } = useReportForm();

  return (
    <SettingsContainer>
      <h2>{i18n.t("ui.about")}</h2>

      <div className="flex flex-col gap-1">
        <Wordmark size="5" />
        <span className="text-gryt-muted" style={{ fontFamily: "var(--code-font-family)" }}>
          v{__APP_VERSION__}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-gryt-muted">&copy; 2022–2026 Sivert Gullberg Hansen</span>
        <span className="text-gryt-muted">{i18n.t("settingsFull.m4e9a67b3cb")}{" "}
          <a
            className="gryt-link"
            href={`${GITHUB_URL}/blob/main/LICENSE`}
            target="_blank"
            rel="noopener noreferrer"
          >
            AGPL-3.0-or-later
          </a>
        </span>
        {/* Beside the licence rather than as buttons below. These are the same
            kind of thing — the terms you are already under — and neither is
            something somebody came to this panel to do. */}
        <span className="text-gryt-muted">
          <a
            className="gryt-link"
            href={TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
          >{i18n.t("settingsFull.m8a069ed1c6")}</a>
          {" · "}
          <a
            className="gryt-link"
            href={PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
          >{i18n.t("settingsFull.m7ceacdcaab")}</a>
        </span>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Button size="small"
          tone="neutral"
          render={
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" />
          }
        >
          <FaGithub size={16} />
          GitHub
        </Button>
        {/* In the app rather than out to a browser. It used to open the Fider
            board, which asks for a sign-in before it will take a sentence —
            and Fider is for public feature requests people vote on, which is
            not what most of what arrived there was. */}
        <Button size="small" tone="neutral" onClick={() => openReport("feedback")}>
          <PiChatCircleDotsFill size={16} />{i18n.t("ui.giveFeedback")}</Button>
        <Button size="small" tone="neutral" onClick={() => openReport("bug")}>
          <PiBugFill size={16} />{i18n.t("ui.reportABug")}</Button>
      </div>

    </SettingsContainer>
  );
}

/**
 * Updates as a destination of its own, first in the sidebar — it used to sit at
 * the bottom of About. In the browser there is no updater, so it offers the app.
 */
export function UpdatesSettings() {
  useTranslation();
  const inElectron = isElectron();

  return (
    <SettingsContainer>
      {!inElectron ? (
        <DesktopAppCard />
      ) : isMacAppStoreBuild() ? (
        <AppStoreUpdates store={i18n.t("settingsFull.m002d8d4c25")} os="macos" />
      ) : isMicrosoftStoreBuild() ? (
        <AppStoreUpdates store={i18n.t("settingsFull.ma8babe6f68")} os="windows" />
      ) : (
        <UpdateControls />
      )}
    </SettingsContainer>
  );
}

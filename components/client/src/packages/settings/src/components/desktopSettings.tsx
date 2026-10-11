import { Divider } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { i18n, useTranslation } from "@/i18n";

import { getElectronAPI, isMacDesktop } from "../../../../lib/electron";
import { SettingsContainer, ToggleSetting } from "./settingsComponents";

const isMac = isMacDesktop();

export function DesktopSettings() {
  const { t: tr } = useTranslation();
  const [closeToTray, setCloseToTray] = useState(true);
  const [startWithWindowsSupported, setStartWithWindowsSupported] = useState(false);
  const [startWithWindows, setStartWithWindows] = useState(true);
  const [startMinimizedOnLogin, setStartMinimizedOnLogin] = useState(false);
  const [hwAccel, setHwAccel] = useState(true);

  useEffect(() => {
    getElectronAPI()?.getCloseToTray().then(setCloseToTray);
  }, []);

  useEffect(() => {
    getElectronAPI()?.getStartWithWindowsSupported().then((supported) => {
      setStartWithWindowsSupported(supported);
      if (!supported) return;
      getElectronAPI()?.getStartWithWindows().then(setStartWithWindows);
    });
  }, []);

  useEffect(() => {
    getElectronAPI()?.getStartMinimizedOnLogin().then(setStartMinimizedOnLogin);
  }, []);

  useEffect(() => {
    getElectronAPI()?.getHardwareAcceleration().then(setHwAccel);
  }, []);

  const handleCloseToTrayToggle = useCallback((enabled: boolean) => {
    setCloseToTray(enabled);
    getElectronAPI()?.setCloseToTray(enabled);
  }, []);

  const handleStartWithWindowsToggle = useCallback((enabled: boolean) => {
    setStartWithWindows(enabled);
    getElectronAPI()?.setStartWithWindows(enabled);
  }, []);

  const handleStartMinimizedOnLoginToggle = useCallback((enabled: boolean) => {
    setStartMinimizedOnLogin(enabled);
    getElectronAPI()?.setStartMinimizedOnLogin(enabled);
  }, []);

  const handleHwAccelToggle = useCallback((enabled: boolean) => {
    setHwAccel(enabled);
    getElectronAPI()?.setHardwareAcceleration(enabled);
  }, []);

  return (
    <SettingsContainer>
      <h2>{i18n.t("ui.desktop")}</h2>

      {startWithWindowsSupported && (
        <>
          {isMac ? (
            <ToggleSetting
              anchorId="open-at-login"
              title={i18n.t("settingsFull.ma7a8de0b81")}
              description={i18n.t("settingsFull.m6212f77fba")}
              checked={startWithWindows}
              onCheckedChange={handleStartWithWindowsToggle}
            />
          ) : (
            <ToggleSetting
              anchorId="start-with-windows"
              title={i18n.t("settingsFull.mee4e7bfb0e")}
              description={i18n.t("settingsFull.md6d817aecd")}
              checked={startWithWindows}
              onCheckedChange={handleStartWithWindowsToggle}
            />
          )}
          {/* macOS can't reliably tell an app it was opened at login, so there's nothing to start minimized on. */}
          {startWithWindows && !isMac && (
            <>
              <Divider />
              <ToggleSetting
                anchorId="start-minimized-on-login"
                title={i18n.t("settingsFull.mc49528a4c7")}
                description={i18n.t("settingsFull.m89ed52e577")}
                checked={startMinimizedOnLogin}
                onCheckedChange={handleStartMinimizedOnLoginToggle}
              />
            </>
          )}
          <Divider />
        </>
      )}

      <ToggleSetting
        anchorId="minimize-to-tray-on-close"
        title={tr("desktop.closeToTrayTitle")}
        description={tr("desktop.closeToTrayDescription")}
        checked={closeToTray}
        onCheckedChange={handleCloseToTrayToggle}
      />

      <Divider />

      <ToggleSetting
        anchorId="hardware-acceleration"
        title={i18n.t("settingsFull.md840668996")}
        description={i18n.t("settingsFull.me8f6f07f12")}
        checked={hwAccel}
        onCheckedChange={handleHwAccelToggle}
      />
    </SettingsContainer>
  );
}

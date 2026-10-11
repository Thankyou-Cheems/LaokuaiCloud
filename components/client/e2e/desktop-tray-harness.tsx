import "../src/style.css";

import { createRoot } from "react-dom/client";

import type { ElectronAPI } from "../src/lib/electron";
import { DesktopSettings } from "../src/packages/settings/src/components/desktopSettings";

// Isolated renderer fixture: main-process close behavior is checked separately.
window.electronAPI = {
  isElectron: true,
  getCloseToTray: async () => localStorage.getItem("fixture.closeToTray") !== "false",
  setCloseToTray: (value: boolean) => localStorage.setItem("fixture.closeToTray", String(value)),
  getStartWithWindowsSupported: async () => false,
  getStartMinimizedOnLogin: async () => false,
  getHardwareAcceleration: async () => true,
} as ElectronAPI;

createRoot(document.getElementById("root")!).render(<div className="gryt-app p-4"><DesktopSettings /></div>);

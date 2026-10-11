import { BrowserWindow } from "electron";

import { isLaokuaiAuthCallback, parseLaokuaiLogin } from "./laokuaiAuthPolicy";

let loginWindow: BrowserWindow | null = null;

export function openLaokuaiLogin(parent: BrowserWindow, url: string): void {
  const { login, callback } = parseLaokuaiLogin(url);
  if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
  const window = new BrowserWindow({
    title: "唠蒯云 · 官方账户登录", width: 560, height: 760, parent,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      partition: "persist:laokuai-official-auth",
    },
  });
  loginWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  let completed = false;
  const onNavigate = (event: { preventDefault(): void }, next: string) => {
    if (isLaokuaiAuthCallback(next, callback)) {
      event.preventDefault();
      if (!completed && !parent.isDestroyed()) {
        completed = true;
        parent.webContents.send("auth-callback", next);
      }
      window.close();
    } else if (!/^https?:/.test(next)) {
      event.preventDefault();
    }
  };
  window.webContents.on("will-redirect", onNavigate);
  window.webContents.on("will-navigate", onNavigate);
  window.on("closed", () => {
    if (loginWindow === window) loginWindow = null;
    if (!completed && !parent.isDestroyed()) {
      const cancelled = new URL(callback);
      cancelled.searchParams.set("error", "access_denied");
      cancelled.searchParams.set("state", login.searchParams.get("state") || "");
      parent.webContents.send("auth-callback", cancelled.toString());
    }
  });
  void window.loadURL(login.toString()).catch(() => {
    if (!window.isDestroyed()) window.close();
  });
}

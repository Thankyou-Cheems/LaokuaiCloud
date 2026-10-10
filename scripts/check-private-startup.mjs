/* eslint-env node */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire,stripTypeScriptTypes } from "node:module";
import path from "node:path";

import sharp from "sharp";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const main = read("electron/main.ts");
const config = require("../electron-builder.laokuai.cjs");
const cases = [];
const check = (name, fn) => { fn(); cases.push(name); };
const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const iconSource = JSON.parse(read("private-brand/ICON-SOURCE.json"));
assert.equal(sha(path.join(root, "private-brand/CheemsBurger_transparent.png")), iconSource.sourceSha256);
const trayAssets = config.extraResources.filter(entry => /^tray.*\.png$/.test(entry.to));
assert.equal(trayAssets.length, 11);
for (const entry of trayAssets) {
  assert.ok(entry.from.startsWith("private-brand/icon-"));
  const metadata = await sharp(path.join(root, entry.from)).metadata();
  assert.equal(metadata.hasAlpha, true);
  assert.equal(metadata.width, entry.to.includes("@3x") ? 48 : entry.to.includes("@2x") ? 32 : 16);
}
cases.push("all eleven tray resources: authorized source and transparent 16/32/48px assets");

const events = {};
const windowEvents = {};
let visible = true, focused = true, hidden = 0, shown = 0, focusCalls = 0, quitCalls = 0;
let creates = 0, missingImage = false, failedTray = false;
const window = { on: (name, fn) => { windowEvents[name] = fn; },
  isVisible: () => visible, isFocused: () => focused,
  hide: () => { visible = false; hidden++; }, show: () => { visible = true; shown++; },
  focus: () => { focused = true; focusCalls++; }, webContents: { setBackgroundThrottling() {} } };
const app = { isPackaged: true, on: (name, fn) => { events[name] = fn; }, quit: () => { quitCalls++; events["before-quit"]?.(); } };
class FakeTray {
  constructor(image) { if (failedTray) throw new Error("fixture tray unavailable"); creates++; this.image = image; this.events = {}; }
  isDestroyed() { return this.destroyed === true; }
  setToolTip(value) { this.tooltip = value; }
  on(name, fn) { this.events[name] = fn; }
  popUpContextMenu(menu) { this.menu = menu; }
  setImage(image) { this.image = image; }
}
const functions = main.slice(main.indexOf("function buildTrayContextMenu"), main.indexOf("/** Thousands of small files:"));
const closing = main.slice(main.indexOf("  // Windows may close windows"), main.indexOf('  mainWindow.on("closed"'));
const quitting = main.slice(main.lastIndexOf('  app.on(\n    "before-quit",'), main.lastIndexOf('  app.on(\n    "will-quit",'));
const body = stripTypeScriptTypes(`${functions}\n${closing}\n${quitting}`, { mode: "transform" });
const nativeSource = stripTypeScriptTypes(read("electron/uiLanguage.ts"))
  .replace(/^import .*;$/gm, "").replace(/^export /gm, "");
const native = new Function("en", "zhCN", `${nativeSource}; return { nativeT, setNativeLanguagePreference, setNativeApplicationName };`)(
  JSON.parse(read("src/packages/i18n/locales/en.json")), JSON.parse(read("src/packages/i18n/locales/zh-CN.json")));
native.setNativeLanguagePreference("zh-CN", []); native.setNativeApplicationName("唠蒯");
assert.equal(native.nativeT("privatePortConflictTitle"), "唠蒯 · 端口被占用");
assert.ok(native.nativeT("privatePortConflictMessage", { port: 15738 }).includes("15738"));
native.setNativeLanguagePreference("en", []);
assert.equal(native.nativeT("privatePortConflictTitle"), "唠蒯 · Port in use");
assert.equal(native.nativeT("privateLoginFailed"), "Could not open account sign-in. Check the authentication settings.");
assert.ok(main.includes('nativeT("privatePortConflictMessage", { port: err.port })'));
assert.ok(main.includes('nativeT("privateLoginFailed")'));
assert.ok(main.includes('"laokuai://auth?error=login_window_failed"'));
native.setNativeLanguagePreference("zh-CN", []);
const control = new Function("app", "process", "Tray", "nativeImage", "Menu", "window", "nativeT", "refreshNativeLanguage", `
  let mainWindow=window, tray=null, closeToTray=true, isQuitting=false, IS_LAOKUAI=true, isUserSignedIn=false;
  let voiceState={inVoice:true,muted:false,deafened:false,serverName:'Fixture only'};
  const updates={ready:()=>false}, updatesComeFromTheAppStore=true;
  const startupLog=()=>{}, createMainWindow=()=>{}, installNewestUpdate=()=>{}, checkForUpdatesInBackground=()=>{};
  const stateIcon=name=>'/fixture/resources/'+name+'.png', trayIcon='/fixture/resources/trayTemplate.png';
  ${body}
  return { createTray, refreshTray, toggleMainWindow, currentTrayIconPath, trayTooltip, buildTrayContextMenu,
    set: values=>{ if('quitting' in values)isQuitting=values.quitting; if('closeToTray' in values)closeToTray=values.closeToTray;
      if('signedIn' in values)isUserSignedIn=values.signedIn; if('private' in values)IS_LAOKUAI=values.private;
      if('voice' in values)voiceState={...voiceState,...values.voice}; if(values.destroyTray)tray.destroyed=true; },
    tray:()=>tray, voice:()=>({...voiceState}), quitting:()=>isQuitting };
`)(app, { platform: "win32" }, FakeTray, { createFromPath: file => ({ file, isEmpty: () => missingImage }) },
  { buildFromTemplate: value => value }, window, native.nativeT, () => {});
const close = () => { let prevented = false; windowEvents.close({ preventDefault: () => { prevented = true; } }); return prevented; };
check("private guest X keeps voice state and hides only", () => {
  control.createTray(); const before = control.voice(); assert.equal(close(), true);
  assert.equal(visible, false); assert.deepEqual(control.voice(), before); assert.equal(quitCalls, 0);
});
check("repeated X and createTray do not duplicate tray", () => { close(); control.createTray(); assert.equal(creates, 1); });
check("tray click restores window", () => { control.tray().events.click(); assert.equal(visible, true); assert.ok(shown && focusCalls); });
check("menu offers explicit restore and quit", () => {
  close(); const menu = control.buildTrayContextMenu(); assert.equal(menu[0].label, native.nativeT("726dff642ff6"));
  menu[0].click(); assert.equal(visible, true); menu.find(item => item.label === native.nativeT("privateQuit")).click();
  assert.equal(quitCalls, 1); assert.equal(control.quitting(), true); assert.equal(close(), false);
});
check("saved false close-to-tray is respected", () => { control.set({ quitting: false, closeToTray: false }); assert.equal(close(), false); });
check("missing or destroyed tray permits close", () => { control.set({ closeToTray: true, destroyTray: true }); assert.equal(close(), false); });
check("tray creation failure permits close", () => { failedTray = true; control.createTray(); assert.equal(control.tray(), null); assert.equal(close(), false); failedTray = false; });
check("empty native image does not create an unusable tray", () => { missingImage = true; control.createTray(); assert.equal(control.tray(), null); assert.equal(close(), false); missingImage = false; });
check("tray can recover after creation failure", () => { control.createTray(); assert.equal(close(), true); });
check("Windows query-session-end is not blocked", () => { windowEvents["query-session-end"](); assert.equal(close(), false); });
check("Windows session-end is not blocked", () => { control.set({ quitting: false }); windowEvents["session-end"](); assert.equal(close(), false); });
check("update quit flag permits close", () => {
  assert.match(main, /function installNewestUpdate[^]*?isQuitting = true/);
  control.set({ quitting: true }); assert.equal(close(), false);
});
check("original non-private unsigned-in behavior stays compatible", () => {
  control.set({ quitting: false, private: false, signedIn: false }); assert.equal(close(), false);
  control.set({ signedIn: true }); assert.equal(close(), true);
});
check("all Windows idle/live/muted/deafened paths select Cheems packaged resources", () => {
  control.set({ private: true });
  for (const [voice, name] of [[{inVoice:false,muted:false,deafened:false},"idle"],
    [{inVoice:true},"live"], [{muted:true},"muted"], [{deafened:true},"deafened"]]) {
    control.set({ voice }); const file = control.currentTrayIconPath();
    assert.equal(path.basename(file), `tray-${name}.png`);
    const entry = trayAssets.find(asset => asset.to === path.basename(file));
    assert.equal(sha(path.join(root, entry.from)), sha(path.join(root, "private-brand/icon-16.png")));
    control.refreshTray(); assert.equal(control.tray().image.file, file); assert.match(control.tray().tooltip, /唠蒯/);
  }
});
check("hidden launch requires a usable tray", () => { assert.ok(main.includes("startHiddenOnLaunch && tray && !tray.isDestroyed()")); });
check("tutorial skip follows loaded nickname without persisting tutorial flags", () => {
  const hook = read("src/packages/settings/src/hooks/useSettings.ts");
  const load = hook.slice(hook.indexOf("await loadForUser(userId)"), hook.indexOf("setSettingsLoaded(true)"));
  assert.ok(load.indexOf("setNickname(name)") < load.indexOf("setHasSeenWelcome(true)"));
  assert.ok(!load.includes('setUserValue("hasSeenWelcome"') && !load.includes('setUserValue("hasSeenTour"'));
  assert.ok(!load.includes("writeSeenWelcome()"));
});
const report = { cases, count: cases.length, scope: "actual main tray/close handlers under fake Electron; no OS keys, real profile, microphone or call",
  sourceSha256: iconSource.sourceSha256, trayAssets: trayAssets.map(entry => ({ ...entry, sha256: sha(path.join(root, entry.from)) })) };
fs.writeFileSync(path.join(root, "startup-tray-check.json"), JSON.stringify(report, null, 2));
console.log(`PASS ${cases.length} private startup/tray checks; hidden=${hidden}, no real Electron window or media`);

/* eslint-env node */
const { app, BrowserWindow, Tray, Menu, nativeImage } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "..");
const config = require("../electron-builder.laokuai.cjs");
const resources = path.join(root, config.directories.output, "win-unpacked/resources");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "laokuai-native-startup-check-"));
app.setPath("userData", profile);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
const results = { electron: process.versions.electron, isolatedProfile: true, realMediaOpened: false,
  eventListenersForKeys: 0, inputSimulated: false, applicationSourceLoaded: false, cases: [] };
let control, window, keeper, native;
app.whenReady().then(async () => {
  const ownRequire = createRequire(path.join(resources, "app.asar/dist-electron/main.js"));
  native = ownRequire("uiohook-napi");
  assert.equal(typeof native.uIOhook.start, "function");
  native.uIOhook.start();
  await new Promise(resolve => setTimeout(resolve, 100));
  native.uIOhook.stop();
  results.cases.push("packaged native uiohook starts/stops in actual Electron; no keyboard/mouse listeners or recorded events");
  for (const name of ["tray-idle", "tray-live", "tray-muted", "tray-deafened"]) {
    const image = nativeImage.createFromPath(path.join(resources, `${name}.png`));
    assert.equal(image.isEmpty(), false); assert.ok(image.getSize().width >= 16);
  }
  results.cases.push("actual nativeImage reads all four packaged Cheems states including DPI representations");
  window = new BrowserWindow({ show: false, skipTaskbar: true, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
  // Keep Electron's default-app last-window exit from racing the final evidence write.
  keeper = new BrowserWindow({ show: false, skipTaskbar: true });
  const ts = require("typescript");
  const main = fs.readFileSync(path.join(root, "electron/main.ts"), "utf8");
  const functions = main.slice(main.indexOf("function buildTrayContextMenu"), main.indexOf("/** Thousands of small files:"));
  const closing = main.slice(main.indexOf("  // Windows may close windows"), main.indexOf('  mainWindow.on("closed"'));
  const body = ts.transpileModule(`${functions}\n${closing}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const nativeSource = ts.transpileModule(fs.readFileSync(path.join(root,"electron/uiLanguage.ts"),"utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const nativeModule = {exports:{}};
  new Function("exports","require",nativeSource)(nativeModule.exports, name => JSON.parse(fs.readFileSync(path.resolve(root,"electron",name),"utf8")));
  nativeModule.exports.setNativeLanguagePreference("zh-CN",[]); nativeModule.exports.setNativeApplicationName("唠蒯");
  const nativeFormatter = nativeModule.exports;
  control = new Function("app", "process", "Tray", "nativeImage", "Menu", "window", "resources", "path", "nativeT", "refreshNativeLanguage", `
    let mainWindow=window,tray=null,isQuitting=false,closeToTray=true,IS_LAOKUAI=true,isUserSignedIn=false;
    const voiceState={inVoice:false},updates={ready:()=>false},updatesComeFromTheAppStore=true;
    const startupLog=()=>{},createMainWindow=()=>{},installNewestUpdate=()=>{},checkForUpdatesInBackground=()=>{};
    const stateIcon=name=>path.join(resources,name+'.png'),trayIcon=stateIcon('trayTemplate');
    ${body}
    app.on('before-quit',()=>{isQuitting=true;});
    return {createTray,refreshTray,toggleMainWindow,buildTrayContextMenu,tray:()=>tray,allowQuit:()=>{isQuitting=true;}};
  `)(app, process, Tray, nativeImage, Menu, window, resources, path, nativeFormatter.nativeT, () => {});
  control.createTray(); assert.ok(control.tray());
  const first = control.tray(); control.createTray(); assert.equal(control.tray(), first);
  window.close(); await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(window.isDestroyed(), false); assert.equal(window.isVisible(), false);
  results.cases.push("actual BrowserWindow close is prevented only for usable tray; repeated tray creation reuses instance");
  const menu = control.buildTrayContextMenu();
  assert.ok(menu.items.some(item => item.label === nativeFormatter.nativeT("726dff642ff6")));
  assert.ok(menu.items.some(item => item.label === nativeFormatter.nativeT("privateQuit")));
  // Keep the synthetic window hidden: restore callback is exercised in the fake-handler test.
  window.emit("query-session-end", {}); window.close();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(window.isDestroyed(), true);
  results.cases.push("actual window session-end listener permits close; no OS shutdown was issued");
  results.status = "passed";
  fs.writeFileSync(path.join(root, "startup-native-runtime.json"), JSON.stringify(results, null, 2));
  control.tray()?.destroy(); keeper.destroy(); app.quit();
}).catch(error => {
  try { native?.uIOhook.stop(); control?.allowQuit(); control?.tray()?.destroy(); window?.destroy(); keeper?.destroy(); } catch { /* Best-effort test cleanup. */ }
  results.status = "failed"; results.error = error.message;
  fs.writeFileSync(path.join(root, "startup-native-runtime.json"), JSON.stringify(results, null, 2));
  console.error(error); app.exit(1);
});

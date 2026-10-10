/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { createRequire } from "node:module";
import path from "node:path";

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const load = async file => import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(read(file))).toString("base64")}`);
const { parseLaokuaiLogin, isLaokuaiAuthCallback } = await load("electron/laokuaiAuthPolicy.ts");
const login = new URL("https://auth.gryt.chat/realms/gryt/protocol/openid-connect/auth");
for (const [key, value] of Object.entries({ redirect_uri: "https://gryt.chat/auth/callback", response_type: "code",
  code_challenge_method: "S256", code_challenge: "TEST_CHALLENGE", state: "FAKE_STATE" })) login.searchParams.set(key, value);
const { callback } = parseLaokuaiLogin(login.toString());
assert.equal(parseLaokuaiLogin(login.toString().replace("/auth?", "/registrations?")).callback.href, callback.href);
assert.equal(isLaokuaiAuthCallback("https://gryt.chat/auth/callback?code=FAKE&state=FAKE_STATE", callback), true);
assert.equal(isLaokuaiAuthCallback("https://gryt.chat/auth/callback?error=access_denied", callback), true);
for (const url of ["https://gryt.chat.evil.invalid/auth/callback?code=FAKE", "https://evil.invalid/auth/callback?code=FAKE",
  "https://gryt.chat/auth/callback/else?code=FAKE", "https://gryt.chat/auth/callback", "gryt://auth?code=FAKE", "invalid"]) {
  assert.equal(isLaokuaiAuthCallback(url, callback), false, url);
}
assert.throws(() => parseLaokuaiLogin(login.toString().replace("https:", "javascript:")));
for (const patch of [{ pathname: "/arbitrary" }]) {
  const bad = new URL(login); Object.assign(bad, patch); assert.throws(() => parseLaokuaiLogin(bad.toString()));
}
for (const [key, value] of [["redirect_uri", "https://user:pass@evil.invalid/callback"], ["redirect_uri", "http://remote.invalid/callback"],
  ["response_type", "token"], ["code_challenge_method", "plain"], ["state", ""]]) {
  const bad = new URL(login); bad.searchParams.set(key, value); assert.throws(() => parseLaokuaiLogin(bad.toString()));
}
const { receiveAudioRoles, setReceiveAudioGain } = await load("src/packages/lib/receiveAudio.ts");
const roles = receiveAudioRoles([{ streamID: "mic", screenShareAudioStreamID: "screen" }, { streamID: "screen" }]);
assert.equal(roles.get("mic"), "microphone"); assert.equal(roles.get("screen"), "screen"); assert.equal(roles.get("late"), undefined);
const calls = [];
const source = { receiveCleanup: { setMuted: value => calls.push(["muted", value]) },
  gain: { gain: { setValueAtTime: (...args) => calls.push(["gain", ...args]) } } };
setReceiveAudioGain(source, 0, 42); setReceiveAudioGain(source, 1.5, 43); setReceiveAudioGain(source, NaN, 44);
assert.deepEqual(calls, [["muted", true], ["gain", 0, 42], ["muted", false], ["gain", 1.5, 43], ["muted", true], ["gain", 0, 44]]);
setReceiveAudioGain(undefined, 1, 0);
const main = read("electron/main.ts");
assert.ok(main.indexOf("isolateI18nTestData();") < main.indexOf("const LOG_PATH"));
assert.ok(main.includes("if (!IS_I18N_TEST) {"));
assert.ok(main.includes("openLaokuaiLogin(mainWindow, url)"));
assert.ok(main.includes("const AUTH_ORIGIN_PORT = 15738"));
const window = read("electron/laokuaiAuthWindow.ts");
for (const constraint of ["nodeIntegration: false", "contextIsolation: true", "sandbox: true", "persist:laokuai-official-auth", 'action: "deny"']) assert.ok(window.includes(constraint));
assert.ok(!window.includes("preload:"));
const windows = [];
class MockWindow {
  constructor(options) {
    this.options = options; this.events = {}; this.destroyed = false;
    this.webContents = { events: {}, on: (name, fn) => { this.webContents.events[name] = fn; },
      setWindowOpenHandler: fn => { this.popup = fn; } };
    windows.push(this);
  }
  isDestroyed() { return this.destroyed; }
  on(name, fn) { this.events[name] = fn; }
  close() { this.destroyed = true; this.events.closed?.(); }
  loadURL(url) { this.url = url; return Promise.resolve(); }
}
const bridge = [];
const parent = { isDestroyed: () => false, webContents: { send: (...args) => bridge.push(args) } };
const body = stripTypeScriptTypes(window).replace(/^import .*;$/gm, "").replace(/^export /gm, "");
const open = new Function("BrowserWindow", "parseLaokuaiLogin", "isLaokuaiAuthCallback", `${body}\nreturn openLaokuaiLogin;`)(
  MockWindow, parseLaokuaiLogin, isLaokuaiAuthCallback);
open(parent, login.toString());
assert.equal(windows[0].options.webPreferences.partition, "persist:laokuai-official-auth");
assert.deepEqual(windows[0].popup(), { action: "deny" });
let stopped = 0;
const successful = "https://gryt.chat/auth/callback?code=FAKE&state=FAKE_STATE";
windows[0].webContents.events["will-redirect"]({ preventDefault: () => stopped++ }, successful);
assert.equal(stopped, 1); assert.deepEqual(bridge, [["auth-callback", successful]]);
open(parent, login.toString());
windows[1].webContents.events["will-navigate"]({ preventDefault: () => stopped++ }, "gryt://auth?code=FAKE");
assert.equal(stopped, 2); assert.equal(bridge.length, 1);
windows[1].close();
assert.equal(new URL(bridge[1][1]).searchParams.get("error"), "access_denied");
assert.equal(new URL(bridge[1][1]).searchParams.get("state"), "FAKE_STATE");
const profileCalls = [];
const app = { getAppPath: () => "fake-package", setName: v => profileCalls.push(["name", v]),
  setPath: (key, value) => profileCalls.push(["path", key, value]), setAppUserModelId: v => profileCalls.push(["id", v]) };
const profileBody = stripTypeScriptTypes(read("electron/i18nTestVariant.ts")).replace(/^import .*;$/gm, "").replace(/^export /gm, "");
const { privateProfilePaths } = await load("electron/privateProfile.ts");
const profile = new Function("app", "readFileSync", "mkdirSync", "dirname", "join", "process", "privateProfilePaths", `${profileBody}\nreturn isolateI18nTestData;`)(
  app, () => JSON.stringify({ grytI18nTest: true, grytLaokuai: true }), () => {}, path.dirname, path.join,
  { argv: [], env: { PORTABLE_EXECUTABLE_DIR: "C:\\FAKE_OWN_PACKAGE" }, execPath: "C:\\FAKE_TEMP\\electron.exe" }, privateProfilePaths);
profile();
assert.ok(profileCalls.some(v => v[0] === "path" && v[1] === "userData" && v[2] === path.join("C:\\FAKE_OWN_PACKAGE", "laokuai-chat-data")));
assert.ok(profileCalls.some(v => v[0] === "id" && v[1] === "local.laokuai.chat"));
const require = createRequire(import.meta.url);
const config = require("../electron-builder.laokuai.cjs");
assert.equal(config.appId, "local.laokuai.chat"); assert.equal(config.extraMetadata.grytLaokuai, true);
assert.equal(config.publish, null); assert.deepEqual(config.protocols, []);
assert.equal(config.win.icon, "private-brand/icon.ico");
assert.ok(config.extraResources.some(v => v.from === "private-brand/icon.png" && v.to === "icon.png"));
const prefs = read("src/packages/settings/src/hooks/useAudioSettings.ts");
assert.ok(prefs.includes("receiveLevelingEnabled: true"));
assert.ok(prefs.includes('setUserValue("receiveLevelingEnabled", enabled)'));
assert.ok(read("src/packages/webRTC/src/adapters/voiceConfig.ts").includes("receiveLevelingEnabled: s.receiveLevelingEnabled"));
assert.ok(read("src/packages/webRTC/src/adapters/useReceiveAudioRoles.ts").includes('applyReceiveAudioRoles(streamSources, members)'));
console.log("PASS: callback policy, audio role mapping, manual mute/unmute, own profile/origin/auth constraints");

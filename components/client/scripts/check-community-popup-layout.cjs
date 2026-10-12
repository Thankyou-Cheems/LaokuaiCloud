/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
// TEST-ONLY Electron host. No production app/bootstrap/preload or native helper is invoked.
const { app, BrowserWindow, protocol, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = __dirname, dist = path.join(root, "dist");
const flags = process.argv.filter(x => x.startsWith("--fixture-profile="));
if (flags.length !== 1 || !process.argv.includes("--coordinated-offline-component-run=1")) throw new Error("parent_resource_coordination_and_fresh_fixture_profile_required");
if (process.argv.some(x => /^(--remote-debugging|--inspect|--user-data-dir|--proxy-server)/.test(x))) throw new Error("forbidden_runtime_argument");
const profile = flags[0].slice("--fixture-profile=".length);
if (!path.isAbsolute(profile) || !/^component-ui-fixture-[\w-]+$/.test(path.basename(profile))) throw new Error("invalid_fixture_profile");
const profileRoot = path.join(root, "profiles") + path.sep;
if (!profile.startsWith(profileRoot) || !fs.existsSync(profile) || fs.lstatSync(profile).isSymbolicLink() ||
  fs.realpathSync(profile).toLowerCase() !== path.resolve(profile).toLowerCase() || fs.readdirSync(profile).length) throw new Error("fresh_owned_fixture_profile_required");
app.setPath("userData", profile); app.setPath("sessionData", profile); app.setPath("crashDumps", path.join(profile, "crashDumps"));
app.setName("TEST-offline-production-component-fixture");
app.disableHardwareAcceleration();
for (const flag of ["mute-audio", "disable-background-networking", "disable-sync", "disable-component-update", "disable-domain-reliability", "disable-default-apps", "no-first-run"]) app.commandLine.appendSwitch(flag);
protocol.registerSchemesAsPrivileged([{ scheme: "component-fixture", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'none'; media-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'";
const evidence = path.join(profile, "evidence"); fs.mkdirSync(evidence);
const results = { kind: "TEST-DATA-real-production-components", sourceInputHashes: JSON.parse(fs.readFileSync(path.join(root,"BUILD-RECEIPT.json"),"utf8")).sourceInputHashes, startedAt: new Date().toISOString(),
  syntheticCommunityAndRailOnly: true, wholeAppAndAuthenticatedRoom: false, noAccountOrAudioOrNetwork: true, noProductionPreloadOrAppBootstrap: true,
  inputBoundary: "webContents.sendInputEvent addresses this hidden test renderer only; DOM focus and fixture state setup are recorded. No desktop input, user window activation, global hook or OS keyboard simulation.",
  checks: [], captures: [], events: [] };
let win;
const save = () => fs.writeFileSync(path.join(evidence, "RESULTS.json"), JSON.stringify(results, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = fn => win.webContents.executeJavaScript(`(${fn.toString()})()`, false);
const check = async (name, fn) => {
  const facts = await fn(); results.checks.push({ name, passed: Boolean(facts.passed), ...facts }); save();
};
async function point(selector, type = "mouseMove", index = 0) {
  const rect = await win.webContents.executeJavaScript(`(()=>{const n=document.querySelectorAll(${JSON.stringify(selector)})[${index}];if(!n)throw Error('missing_input_target');const r=n.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  win.webContents.sendInputEvent({ type, ...rect, ...(type === "mouseMove" ? {} : { button: "left", clickCount: 1 }) });
}
async function click(selector, index = 0) { await point(selector, "mouseMove", index); await point(selector, "mouseDown", index); await point(selector, "mouseUp", index); await sleep(100); }
function key(keyCode) {
  const electronKey = ({ ArrowRight:'Right', ArrowLeft:'Left', ArrowUp:'Up', ArrowDown:'Down' })[keyCode] ?? keyCode;
  win.webContents.sendInputEvent({ type: "keyDown", keyCode:electronKey }); win.webContents.sendInputEvent({ type: "keyUp", keyCode:electronKey });
}
async function popupCount() { return evaluate(() => (window.__componentFixture.snapshot().popup ? 1 : 0)); }
async function settlePopups(expected) {
  const started = Date.now();
  while (Date.now() - started < 2200) {
    if (await popupCount() === expected) { await sleep(200); return; }
    await sleep(40);
  }
  results.events.push({ event: 'popup-settle-timeout', expected, actual: await popupCount() }); save();
}

async function driver(){
 await evaluate(()=>{window.__fixtureInputEvents=[];document.addEventListener('keydown',event=>{window.__fixtureInputEvents.push({key:event.key,code:event.code,targetRole:event.target?.getAttribute('role')});},true);});await sleep(650);
 const snap=()=>evaluate(()=>window.__componentFixture.snapshot());
 const set=async v=>{await win.webContents.executeJavaScript(`window.__componentFixture.setVariant(${JSON.stringify(v)})`);await sleep(200);};
 const trigger='[data-gryt="community-lan-control"] button';
 const visible=async()=>{await evaluate(()=>document.querySelector('[data-gryt="community-lan-control"]').scrollIntoView({block:'nearest'}));await sleep(150);};
 const shot=async name=>{const d=await snap();fs.writeFileSync(path.join(evidence,name+'.json'),JSON.stringify(d,null,2));const b=(await win.webContents.capturePage()).toPNG();fs.writeFileSync(path.join(evidence,name+'.png'),b);results.captures.push({name,pngSha256:crypto.createHash('sha256').update(b).digest('hex'),visible:win.isVisible(),focused:win.isFocused()});save();return d;};
 for(const [label,width,height]of [['normal',980,720],['narrow',340,420],['minimum',300,300],['stress',240,240],['short',320,300]]){
  win.setContentSize(width,height);await set('unconfigured');await visible();let d=await shot(label+'-closed');
  await check(label+' compact control and footer in normal flow',async()=>({passed:d.controlPosition!=='fixed'&&d.controlPosition!=='absolute'&&d.control.height<=40&&d.button.width<=40&&d.footer.bottom<=d.viewport.height+1&&d.control.bottom<=d.footer.y&&d.documentWidth<=d.viewport.width&&!d.popup&&!d.bodyText.includes('这个社区尚未提供'),facts:d}));
  await click(trigger);await sleep(300);d=await shot(label+'-open');
  key('ArrowDown');await sleep(120);const keyboard=await evaluate(()=>{const popup=document.querySelector('[aria-label="社区联机详情"]');return{menuFocus:!!popup&&popup.contains(document.activeElement),role:document.activeElement?.getAttribute('role')};});key('Escape');await settlePopups(0);await sleep(200);const restored=await evaluate(()=>({closed:!document.querySelector('[aria-label="社区联机详情"]'),triggerFocus:document.activeElement===document.querySelector('[data-gryt="community-lan-control"] button'),events:window.__fixtureInputEvents,activeRole:document.activeElement?.getAttribute('role'),triggerExpanded:document.querySelector('[data-gryt="community-lan-control"] button')?.getAttribute('aria-expanded'),popupOpen:document.querySelector('[aria-label="社区联机详情"]')?.getAttribute('data-open')}));
  await check(label+' explicit details wrapped and viewport bounded',async()=>({passed:!!d.popup&&d.popup.x>=0&&d.popup.y>=0&&d.popup.right<=d.viewport.width+1&&d.popup.bottom<=d.viewport.height+1&&d.documentWidth<=d.viewport.width&&d.popupText.includes('频道信息已收到')&&d.popupText.includes('社区服务已连接')&&keyboard.menuFocus&&restored.closed&&restored.triggerFocus,facts:d,keyboard,restored}));
 }
 win.setContentSize(980,720);
 for(const variant of ['disabled','cleanup','error']){
  await set(variant);await visible();await click(trigger);await sleep(300);const d=await shot(variant+'-open');
  const expect=variant==='disabled'?'开启联机':variant==='cleanup'?'重试退出':'重试';
  await check(variant+' accurate visible state and action',async()=>({passed:!!d.popup&&d.popupText.includes(expect),facts:d}));
  await evaluate(()=>document.querySelector('[data-gryt="community-lan-control"] button').focus());key('Escape');await sleep(200);
 }
 results.status=results.checks.every(c=>c.passed)?'PASS-component-fixture-only':'FAIL-component-fixture';results.finishedAt=new Date().toISOString();save();
}

app.on("web-contents-created", (_, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => { if (!url.startsWith("component-fixture://app/")) event.preventDefault(); });
});
app.whenReady().then(async () => {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  session.defaultSession.setDisplayMediaRequestHandler((_request, cb) => cb({}));
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !/^(component-fixture:\/\/app\/|data:|blob:)/.test(details.url) }));
  protocol.handle("component-fixture", request => {
    const url = new URL(request.url);
    if (url.hostname !== "app") return new Response("host denied", { status: 403 });
    const file = path.resolve(dist, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile() || !fs.realpathSync(file).startsWith(fs.realpathSync(dist) + path.sep)) return new Response("not found", { status: 404 });
    const types = { ".html": "text/html;charset=utf-8", ".js": "text/javascript;charset=utf-8", ".css": "text/css;charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png" };
    return new Response(fs.readFileSync(file), { headers: { "content-type": types[path.extname(file)] || "application/octet-stream", "Content-Security-Policy": csp } });
  });
  win = new BrowserWindow({ width: 1600, height: 900, useContentSize: true, show: false, skipTaskbar: true, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, offscreen: true } });
  win.webContents.setFrameRate(30);
  results.renderedFrames=0;win.webContents.on("paint",()=>{results.renderedFrames++;});
  const framePump=setInterval(()=>win.webContents.invalidate(),33);
  for (const event of ["show", "focus"]) win.on(event, () => { results.events.push({ event, at: new Date().toISOString() }); save(); });
  win.webContents.on("console-message", event => { if (event.level >= 2) { results.events.push({ event: "console", level: event.level, message: event.message }); save(); } });
  win.webContents.on("render-process-gone", (_event, details) => { results.events.push({ event: "render-process-gone", details }); save(); app.exit(2); });
  const watchdog = setTimeout(() => { results.status = "FAIL-watchdog"; save(); app.exit(3); }, 60000);
  try { await win.loadURL("component-fixture://app/index.html"); await driver(); }
  catch (error) { results.status = "FAIL-component-fixture"; results.failure = String(error.stack || error); save(); }
  finally { clearInterval(framePump);clearTimeout(watchdog); app.exit(results.status?.startsWith("PASS") ? 0 : 1); }
});


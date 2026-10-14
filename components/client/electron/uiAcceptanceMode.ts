// Explicit offline acceptance mode. Ordinary product launches are unchanged.
import { app, type BrowserWindow, type IpcMain, protocol, type Session,session } from "electron";
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "path";

const FLAG = "--laokuai-ui-check-dir=";
export const UI_ACCEPTANCE_URL = "laokuai-ui-check://app/index.html";
export interface UIAcceptanceMode { readonly directory: string }

// These retain the real handlers and isolated stores. Everything else is an
// explicit unavailable error, not a substitute account/community/native state.
const ALLOWED_HANDLES = new Set([
  "get-app-version", "get-slim-variant", "get-beta-channel", "get-auto-update",
  "get-close-to-tray", "get-start-with-windows-supported", "get-start-with-windows",
  "get-start-minimized-on-login", "get-hardware-acceleration", "user-store:load",
  "global-store:load", "addons:list", "secret:available",
  "native-audio-capture-available", "per-application-audio-supported",
  "native-screen-capture:available", "embedded-server:available", "embedded-server:info",
  "embedded-server:status", "embedded-server:logs", "embedded-server:get-auto-start",
]);
const ALLOWED_EVENTS = new Set([
  "global-store:set", "global-store:save", "global-store:delete",
  "user-store:set", "user-store:save", "set-close-to-tray", "set-titlebar-overlay",
  "set-signed-in", "set-voice-state", "set-start-minimized-on-login",
]);

/** Registration wrapper only; production IpcMain is not modified. */
export function createUIAcceptanceIpc(ipc: IpcMain): IpcMain {
  return new Proxy(ipc, {
    get(target, key) {
      if (key === "handle") return ((channel: string, listener: Parameters<IpcMain["handle"]>[1]) => {
        target.handle(channel, (event, ...args) => {
          if (!ALLOWED_HANDLES.has(channel)) throw new Error(`ui-acceptance-ipc-disabled:${channel}`);
          return listener(event, ...args);
        });
      });
      if (key === "on") return ((channel: string, listener: Parameters<IpcMain["on"]>[1]) => {
        target.on(channel, (...args) => {
          if (!ALLOWED_EVENTS.has(channel)) {
            console.warn(`ui-acceptance-ipc-disabled:${channel}`); return;
          }
          listener(...args);
        });
        return target;
      });
      const value = Reflect.get(target,key,target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function createUIAcceptanceMode(ownPackage: boolean, argv: readonly string[]): UIAcceptanceMode | undefined {
  const flags = argv.filter(arg => arg.startsWith("--laokuai-ui-check"));
  if (!flags.length) return undefined;
  if (!ownPackage || flags.length !== 1 || !flags[0].startsWith(FLAG)) throw new Error("invalid-ui-acceptance-mode");
  if (argv.some(arg => /^(--user-data-dir|--remote-debugging|--inspect)/.test(arg)) || process.env.VITE_DEV_SERVER_URL) {
    throw new Error("conflicting-ui-acceptance-options");
  }
  const directory = flags[0].slice(FLAG.length);
  if (!isAbsolute(directory) || !/^laokuai-ui-check-[\w-]+$/.test(basename(directory))) throw new Error("invalid-ui-acceptance-directory");
  // A fresh, explicitly created empty directory; no existing identity/profile is admitted.
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink() || realpathSync(directory).toLowerCase() !== resolve(directory).toLowerCase()
    || readdirSync(directory).length !== 0) throw new Error("ui-acceptance-directory-not-fresh");
  const sessions = join(directory,"sessions"), dumps = join(directory,"crashDumps");
  mkdirSync(sessions); mkdirSync(dumps);
  app.setName("唠蒯云 UI验收");
  app.setAppUserModelId("local.laokuai.chat.ui-check");
  app.setPath("userData",directory); app.setPath("sessionData",sessions); app.setPath("crashDumps",dumps);
  app.disableHardwareAcceleration();
  for (const name of ["mute-audio","disable-background-networking","disable-sync"]) app.commandLine.appendSwitch(name);
  protocol.registerSchemesAsPrivileged([{scheme:"laokuai-ui-check",privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
  return Object.freeze({directory});
}

const MIME: Record<string,string> = {".html":"text/html",".js":"application/javascript",".mjs":"application/javascript",".css":"text/css",".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".gif":"image/gif",".svg":"image/svg+xml",".ico":"image/x-icon",".woff":"font/woff",".woff2":"font/woff2",".ttf":"font/ttf",".wasm":"application/wasm",".ogg":"audio/ogg",".mp3":"audio/mpeg",".wav":"audio/wav"};
export function uiAcceptanceFile(url: string, root: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "laokuai-ui-check:" || parsed.hostname !== "app" || parsed.username || parsed.password || parsed.port) return undefined;
    const file = resolve(root,"."+decodeURIComponent(parsed.pathname));
    const inside = relative(root,file);
    if (!inside || inside === ".." || inside.startsWith(".."+sep) || isAbsolute(inside)) return undefined;
    const real = realpathSync(file), actual = relative(realpathSync(root),real);
    if (!actual || actual === ".." || actual.startsWith(".."+sep) || isAbsolute(actual) || !lstatSync(real).isFile()) return undefined;
    return real;
  } catch { return undefined; }
}

/** Local custom origin, not an HTTP server. Never substitutes renderer or preload. */
export function installUIAcceptanceSession(_mode: UIAcceptanceMode, dist: string): void {
  const installed = new WeakSet<Session>();
  const install = (target: Session) => {
    if (installed.has(target)) return; installed.add(target);
    target.setPermissionRequestHandler((_web,_permission,done)=>done(false));
    target.setPermissionCheckHandler(()=>false);
    target.setDisplayMediaRequestHandler((_request,done)=>done({}));
    target.webRequest.onBeforeRequest({urls:["<all_urls>"]},(request,done)=> {
      const allowed = request.url.startsWith("laokuai-ui-check://app/") || /^(data:|blob:)/.test(request.url);
      done({cancel:!allowed});
    });
    target.protocol.handle("laokuai-ui-check",request=> {
      const file = uiAcceptanceFile(request.url,dist);
      if (!file) return new Response("Not found",{status:404});
      return new Response(new Uint8Array(readFileSync(file)),{headers:{"Content-Type":MIME[extname(file)]??"application/octet-stream","Content-Security-Policy":"default-src 'self' blob: data:; connect-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'"}});
    });
  };
  install(session.defaultSession);
  app.on("session-created",install);
}

/** Actual hidden renderer evidence only; no CDP socket, synthetic account or UI state. */
export function attachUIAcceptanceEvidence(mode: UIAcceptanceMode, window: BrowserWindow): void {
  const directory = join(mode.directory,"ui-evidence"); mkdirSync(directory);
  const observations: unknown[] = [];
  const record = (kind: string, detail: unknown) => {
    observations.push({kind,detail,at:new Date().toISOString()});
    writeFileSync(join(directory,"events.json"),JSON.stringify(observations,null,2));
  };
  window.on("show",()=>record("unexpected-window-show",true));
  window.on("focus",()=>record("unexpected-window-focus",true));
  window.webContents.on("preload-error",(_event,preloadPath,error)=>record("preload-error",{preloadPath,message:error.message}));
  window.webContents.on("did-fail-load",(_event,code,message,url)=>record("did-fail-load",{code,message,url}));
  window.webContents.on("render-process-gone",(_event,detail)=>record("render-process-gone",detail));
  window.webContents.on("console-message",(_event,level,message,line,sourceId)=>record("console",{level,message,line,sourceId}));
  let snapshotStarted = false;
  window.webContents.once("did-finish-load",()=> {
    record("did-finish-load",window.webContents.getURL());
    setTimeout(()=> {
      if (snapshotStarted || window.isDestroyed()) return;
      snapshotStarted = true;
      void (async()=> {
        // Read the application's real DOM. Empty roots/blocked features remain failures or gaps.
        const dom = await window.webContents.executeJavaScript(`(() => {
          const rect = node => { const r=node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
          const nodes = [...document.querySelectorAll('button,input,[role="dialog"],[role="menu"],[role="menuitem"],aside,nav')].slice(0,400);
          return {url:location.href,readyState:document.readyState,lang:document.documentElement.lang,
            rootChildren:document.getElementById('root')?.childElementCount ?? null,
            bodyText:document.body.innerText.slice(0,12000),viewport:{width:innerWidth,height:innerHeight},
            preload:{electronAPI:typeof window.electronAPI,easyTierCommunity:typeof window.easyTierCommunity,
              nativeLanVoiceEnabled:window.electronAPI?.nativeLanVoiceEnabled===true},
            activeElement:{tag:document.activeElement?.tagName,role:document.activeElement?.getAttribute('role')},
            elements:nodes.map(node=>({tag:node.tagName,role:node.getAttribute('role'),label:node.getAttribute('aria-label'),
              title:node.getAttribute('title'),text:(node.textContent??'').slice(0,160),rect:rect(node),
              display:getComputedStyle(node).display,visibility:getComputedStyle(node).visibility}))};
        })()`);
        writeFileSync(join(directory,"dom.json"),JSON.stringify(dom,null,2));
        writeFileSync(join(directory,"viewport.png"),(await window.webContents.capturePage()).toPNG());
        record("snapshot-written",{visible:window.isVisible(),focused:window.isFocused()});
      })().catch(error=>record("snapshot-failed",String(error)));
    },5000);
  });
  // Bounded diagnostic lifetime, even for a white screen or failed page load.
  setTimeout(()=>{record("diagnostic-timeout",{snapshotStarted});app.quit();},12000);
}

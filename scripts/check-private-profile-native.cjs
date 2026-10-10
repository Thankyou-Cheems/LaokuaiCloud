const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { stripTypeScriptTypes } = require("node:module");
const { app, BrowserWindow, session } = require("electron");
const profile = process.argv[2];
const mode = process.argv[3];
const originPort = Number(process.argv[4]);
const assert = require("node:assert/strict");

(async () => {
  const source = stripTypeScriptTypes(fs.readFileSync("electron/privateProfile.ts", "utf8"));
  const { privateProfilePaths } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const selected = mode === "write" ? { data: profile, sessions: profile }
    : privateProfilePaths(true, [`--user-data-dir=${profile}`], path.dirname(profile));
  app.setPath("userData", selected.data);
  app.setPath("sessionData", selected.sessions);
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const server = http.createServer((_req, res) => res.end("<!doctype html><title>Synthetic profile only</title>"));
  await new Promise(resolve => server.listen(originPort, "127.0.0.1", resolve));
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await window.loadURL(`http://127.0.0.1:${originPort}`);
  const marker = await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
    const request=indexedDB.open('public-profile-fixture',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('public');
    request.onerror=()=>reject(Error('fixture IndexedDB failed'));
    request.onsuccess=()=>{const db=request.result;const tx=db.transaction('public','${mode === "write" ? "readwrite" : "readonly"}');
      const store=tx.objectStore('public');const op=${mode === "write" ? "store.put('SYNTHETIC_PUBLIC_MARKER','marker')" : "store.get('marker')"};
      let value;op.onsuccess=()=>{value=${mode === "write" ? "'SYNTHETIC_PUBLIC_MARKER'" : "op.result"}};
      tx.oncomplete=()=>{db.close();resolve(value)};tx.onerror=()=>reject(Error('fixture transaction failed'));};
  })`);
  assert.equal(marker, "SYNTHETIC_PUBLIC_MARKER");
  assert.equal(app.getPath("userData"), profile);
  assert.equal(app.getPath("sessionData"), profile);
  fs.writeFileSync(path.join(profile, `result-${mode}.json`), JSON.stringify({ mode, status: "passed", hiddenWindow: true,
    publicSyntheticMarker: true, sessionRoot: true, realCredentialsRead: false, realMediaOpened: false }));
  server.close();
  app.quit();
})().catch(error => { console.error(error.message); app.exit(1); });

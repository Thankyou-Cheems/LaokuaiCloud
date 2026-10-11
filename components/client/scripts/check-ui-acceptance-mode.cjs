const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), assert=require('node:assert/strict');
const root=process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(require('node:os').tmpdir(),'laokuai-ui-pure-')), client=path.resolve(__dirname,'..');
const ts=require(path.join(client,'node_modules/typescript'));
fs.mkdirSync(path.join(root,'evidence'),{recursive:true});
const checks=[];
function check(name,fn){fn();checks.push(name);}
const calls=[], events=new Map(), sessionList=[], timers=[];
function makeSession(){const s={protocol:{handle(name,fn){s.protocolName=name;s.serve=fn}},webRequest:{onBeforeRequest(filter,fn){s.filter=filter;s.before=fn}},
 setPermissionRequestHandler(fn){s.permission=fn},setPermissionCheckHandler(fn){s.permissionCheck=fn},setDisplayMediaRequestHandler(fn){s.display=fn}};sessionList.push(s);return s;}
const electron={app:{setName(v){calls.push(['name',v])},setAppUserModelId(v){calls.push(['id',v])},setPath(k,v){calls.push(['path',k,v])},disableHardwareAcceleration(){calls.push(['hardware'])},
 commandLine:{appendSwitch(v){calls.push(['switch',v])}},on(name,fn){events.set(name,fn)}},
 protocol:{registerSchemesAsPrivileged(v){calls.push(['schemes',v])}},session:{defaultSession:makeSession()}};
const source=fs.readFileSync(path.join(client,'electron/uiAcceptanceMode.ts'),'utf8');
const out=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},reportDiagnostics:true});
assert.equal((out.diagnostics||[]).length,0);
const moduleBox={exports:{}};
vm.runInNewContext(out.outputText,{module:moduleBox,exports:moduleBox.exports,require(name){if(name==='electron')return electron;if(name==='fs')return fs;if(name==='path')return path;throw Error(name)},
 process:{env:{}},URL,Response,Uint8Array,setTimeout(fn,delay){timers.push({fn,delay});return timers.length},console:{warn(message){calls.push(['blocked',message])}}},{filename:'uiAcceptanceMode.compiled.cjs'});
const api=moduleBox.exports;
const runDir=fs.mkdtempSync(path.join(root,'evidence/pure-'));
const directory=path.join(runDir,'laokuai-ui-check-test');fs.mkdirSync(directory);
check('ordinary launch has no mode/path/Chromium mutations',()=>{assert.equal(api.createUIAcceptanceMode(true,[]),undefined);assert.equal(calls.length,0)});
check('foreign package rejected before path writes',()=>{assert.throws(()=>api.createUIAcceptanceMode(false,['--laokuai-ui-check-dir='+directory]));assert.equal(calls.length,0)});
check('malformed and repeated flags rejected before path writes',()=>{for(const args of [['--laokuai-ui-check'],['--laokuai-ui-check-dir='+directory,'--laokuai-ui-check-dir='+directory]])assert.throws(()=>api.createUIAcceptanceMode(true,args));assert.equal(calls.length,0)});
check('profile/debug options rejected before path writes',()=>{for(const option of ['--user-data-dir=x','--remote-debugging-port=9222','--inspect=9229'])assert.throws(()=>api.createUIAcceptanceMode(true,['--laokuai-ui-check-dir='+directory,option]));assert.equal(calls.length,0)});
check('relative/non-fresh directories rejected before path writes',()=>{assert.throws(()=>api.createUIAcceptanceMode(true,['--laokuai-ui-check-dir=laokuai-ui-check-test']));const used=path.join(runDir,'laokuai-ui-check-used');fs.mkdirSync(used);fs.writeFileSync(path.join(used,'identity'),'test-only');assert.throws(()=>api.createUIAcceptanceMode(true,['--laokuai-ui-check-dir='+used]));assert.equal(calls.length,0)});
check('fresh mode has separate real userData/sessionData/crashDumps paths',()=>{const result=api.createUIAcceptanceMode(true,['--laokuai-ui-check-dir='+directory]);assert.equal(result.directory,directory);assert(Object.isFrozen(result));assert.deepEqual(calls.filter(x=>x[0]==='path'),[['path','userData',directory],['path','sessionData',path.join(directory,'sessions')],['path','crashDumps',path.join(directory,'crashDumps')]])});
check('same directory cannot be admitted twice',()=>assert.throws(()=>api.createUIAcceptanceMode(true,['--laokuai-ui-check-dir='+directory])));
const dist=path.join(runDir,'dist'),outside=path.join(runDir,'outside');fs.mkdirSync(dist);fs.mkdirSync(outside);
fs.writeFileSync(path.join(dist,'index.html'),'<html>actual-local-test-file</html>');fs.writeFileSync(path.join(outside,'secret.txt'),'fixture-only');
check('local protocol resolves real file only',()=>{assert.equal(api.uiAcceptanceFile(api.UI_ACCEPTANCE_URL,dist),fs.realpathSync(path.join(dist,'index.html')));for(const url of ['https://app/index.html','laokuai-ui-check://other/index.html','laokuai-ui-check://user@app/index.html','laokuai-ui-check://app:99/index.html','laokuai-ui-check://app/%2e%2e%2foutside/secret.txt','laokuai-ui-check://app/missing','laokuai-ui-check://app/%00'])assert.equal(api.uiAcceptanceFile(url,dist),undefined)});
check('protocol rejects junction escaping asset root',()=>{fs.symlinkSync(outside,path.join(dist,'escape'),'junction');assert.equal(api.uiAcceptanceFile('laokuai-ui-check://app/escape/secret.txt',dist),undefined)});
const handles=new Map(),on=new Map();let realCalls=0;
const ipc={handle(k,fn){handles.set(k,fn)},on(k,fn){on.set(k,fn);return this},removeHandler(k){handles.delete(k)}};
const port=api.createUIAcceptanceIpc(ipc),real={notAFixtureSnapshot:true};
check('allowlisted IPC retains original handler result unchanged',()=>{port.handle('global-store:load',()=>{realCalls++;return real});assert.equal(handles.get('global-store:load')({}),real);assert.equal(realCalls,1)});
const blocked=['embedded-server:create','embedded-server:start','embedded-server:suggest-port','embedded-server:check-port','et-community-connect','et-community-prepare','squad-configure','hotkeys-set','start-native-audio-capture','native-screen-capture:start','secret:unseal','addons:open-folder','new-unreviewed-channel'];
check('native/listener/secret/new IPC fails closed before handler entry',()=>{for(const name of blocked){port.handle(name,()=>{realCalls++;});assert.throws(()=>handles.get(name)({}),/ui-acceptance-ipc-disabled/)}assert.equal(realCalls,1)});
check('external/window/update IPC cannot enter handler',()=>{for(const name of ['auth:open-external','check-for-updates','restart-for-update','set-hardware-acceleration','toggle-always-on-top','lan:rescan']){port.on(name,()=>{realCalls++});on.get(name)({})}assert.equal(realCalls,1)});
check('isolated persistence event retains real handler',()=>{port.on('global-store:set',(_event,key,value)=>{assert.equal(key,'gryt.ui.language');assert.equal(value,'zh-CN');realCalls++});on.get('global-store:set')({},'gryt.ui.language','zh-CN');assert.equal(realCalls,2)});
check('removeHandler retains Electron receiver',()=>{port.removeHandler('global-store:load');assert(!handles.has('global-store:load'))});
api.installUIAcceptanceSession({directory},dist);
check('default and future sessions deny media permissions',()=>{const next=makeSession();events.get('session-created')(next);for(const s of sessionList){let result;s.permission({},'media',v=>result=v);assert.equal(result,false);assert.equal(s.permissionCheck(),false);s.display({},v=>result=v);assert.equal(Object.keys(result).length,0)}});
check('session requests allow local assets and block http/ws/file/remote custom host',()=>{for(const s of sessionList){for(const url of [api.UI_ACCEPTANCE_URL,'data:text/plain,x','blob:laokuai-ui-check://app/id']){let result;s.before({url},v=>result=v);assert.equal(result.cancel,false)}for(const url of ['https://example.invalid/x','http://127.0.0.1:15738','wss://example.invalid','file:///C:/test','laokuai-ui-check://other/index.html']){let result;s.before({url},v=>result=v);assert.equal(result.cancel,true)}}});
check('diagnostic observer registers without showing/focusing/capturing window',()=>{const windowEvents=new Map(),webEvents=new Map();const fake={on(k,fn){windowEvents.set(k,fn)},webContents:{on(k,fn){webEvents.set(k,fn)},once(k,fn){webEvents.set(k,fn)},getURL(){return api.UI_ACCEPTANCE_URL},executeJavaScript(){throw Error('unexpected DOM execution during registration')},capturePage(){throw Error('unexpected screenshot during registration')}},show(){throw Error('unexpected show')},focus(){throw Error('unexpected focus')}};
 api.attachUIAcceptanceEvidence({directory},fake);assert(windowEvents.has('show'));assert(windowEvents.has('focus'));assert(webEvents.has('preload-error'));assert(webEvents.has('did-fail-load'));assert.deepEqual(timers.map(x=>x.delay),[12000]);webEvents.get('did-finish-load')();assert.deepEqual(timers.map(x=>x.delay),[12000,5000]);assert(!fs.existsSync(path.join(directory,'ui-evidence/viewport.png')));assert(!fs.existsSync(path.join(directory,'ui-evidence/dom.json')))});
const main=fs.readFileSync(path.join(client,'electron/main.ts'),'utf8');
const parsedMain=ts.createSourceFile('main.ts',main,ts.ScriptTarget.Latest,true);
check('UI mode returns before updater/focus/installer-backup side effects',()=>{
 const names=['cleanupLegacyWindowsInstallBackup','pinFeedToNewestCompleteRelease','checkForUpdatesInBackground','startPeriodicUpdateChecks','initBackgroundUpdater','installOnQuit','installDownloadedUpdate','installNewestUpdate','downloadAnnouncedRelease'];
 for(const name of names){const node=parsedMain.statements.find(x=>ts.isFunctionDeclaration(x)&&x.name?.text===name);assert(node,name);const text=ts.transpileModule(node.getText(parsedMain),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const scope={UI_ACCEPTANCE_MODE:{directory},IS_I18N_TEST:false};vm.runInNewContext(text+'\n'+name+'();',scope);}
 assert(main.includes('autoUpdater.autoDownload = !UI_ACCEPTANCE_MODE && !IS_I18N_TEST;'));
 assert(main.includes('autoUpdater.autoInstallOnAppQuit = !UI_ACCEPTANCE_MODE && !IS_I18N_TEST && !updatesComeFromAStore;'));
});
check('main mode validation occurs before logs/stores/single-instance lock',()=>{const pos=main.indexOf('const UI_ACCEPTANCE_MODE');for(const text of ['const LOG_PATH','initUserStore(app.getPath','app.requestSingleInstanceLock()'])assert(pos<main.indexOf(text))});
check('main all IPC registrations use guarded port',()=>{assert(!/ipcMain\.(on|handle)\(/.test(main));assert(main.includes('registerEasyTierCommunityIpc(applicationIpc,'))});
check('main listener/autostart/native/show boundaries have explicit mode guards',()=>{for(const text of ['if (!UI_ACCEPTANCE_MODE && !process.env.VITE_DEV_SERVER_URL)','if (mainWindow && !UI_ACCEPTANCE_MODE) {\n        autoStartIfNeeded(','if (mainWindow && !UI_ACCEPTANCE_MODE) {\n        const stopLanDiscovery =','if (!UI_ACCEPTANCE_MODE) createTray();','if (UI_ACCEPTANCE_MODE) { callback({}); return; }','if (UI_ACCEPTANCE_MODE) return null;','if (UI_ACCEPTANCE_MODE) throw new Error("ui-acceptance-native-disabled");','skipTaskbar: UI_ACCEPTANCE_MODE !== undefined','if (UI_ACCEPTANCE_MODE) { app.exit(1); return; }'])assert(main.includes(text),text)});
// Type-check the real project through a read-only overlay; no source copy or build-info write.
const cfg=ts.readConfigFile(path.join(client,'tsconfig.node.json'),ts.sys.readFile);assert(!cfg.error);
const parsed=ts.parseJsonConfigFileContent(cfg.config,ts.sys,client);assert.equal(parsed.errors.length,0);
const originalMain=path.join(client,'electron/main.ts'),virtual=path.join(client,'electron/uiAcceptanceMode.ts');
const normalize=x=>path.resolve(x).toLowerCase();const overlay=new Map([[normalize(originalMain),main],[normalize(virtual),source]]);
const options={...parsed.options,noEmit:true,incremental:false,composite:false};
const host=ts.createCompilerHost(options),read=host.readFile.bind(host),exists=host.fileExists.bind(host);
host.getCurrentDirectory=()=>client;
host.readFile=file=>overlay.get(normalize(file))??read(file);host.fileExists=file=>overlay.has(normalize(file))||exists(file);
host.writeFile=()=>{throw Error('unexpected compiler write')};
const program=ts.createProgram([...parsed.fileNames,virtual],options,host);
const diagnostics=ts.getPreEmitDiagnostics(program);
fs.writeFileSync(path.join(root,'evidence/typecheck.log'),ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>client,getNewLine:()=>"\n"}));
if(diagnostics.length)throw Error('overlay typecheck failed: '+diagnostics.length);
checks.push('real tsconfig.node full-project read-only overlay typecheck');
(async()=>{const response=await sessionList[0].serve({url:api.UI_ACCEPTANCE_URL});assert.equal(response.status,200);assert.equal(await response.text(),'<html>actual-local-test-file</html>');assert(response.headers.get('content-security-policy').includes("connect-src 'self'"));assert.equal((await sessionList[0].serve({url:'laokuai-ui-check://app/missing'})).status,404);checks.push('protocol returns exact local bytes, CSP and missing-file 404');
const evidence={status:'PASS-pure-and-type-only',checks,fixtures:runDir,applicationStarted:false,electronLoaded:false,network:false,nativeExecution:false,domOrScreenshot:false};
fs.writeFileSync(path.join(root,'evidence/VALIDATION.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));})().catch(e=>{console.error(e);process.exitCode=1});

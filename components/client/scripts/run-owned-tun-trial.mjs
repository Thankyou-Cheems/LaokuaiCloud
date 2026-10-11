import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createOwnedObserver } from './owned-tun-observer.mjs';
import { SCOPE, SCOPE_SHA256, TRIAL_SUSPENDED, sha256, validateApproval, verifyTrialPayload, verifyTrialDocuments, buildIsolatedConfig, runBoundedTrial } from './owned-tun-trial-policy.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const client = path.dirname(scripts);
const require = createRequire(import.meta.url);

/** Compile only five small main modules in memory; never build or start Electron. */
export function loadOwnedAdapter() {
  const ts = require('typescript');
  const cache = new Map();
  const allowed = new Set(['easyTierWindowsProcesses', 'easyTierCommunityManager', 'easyTierMemberAdapter', 'easyTierStatus', 'easyTierCliNetwork']);
  function load(name) {
    if (!allowed.has(name)) throw new Error('unexpected-adapter-import');
    if (cache.has(name)) return cache.get(name);
    const source = fs.readFileSync(path.join(client, 'electron', name + '.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {}; cache.set(name, exports);
    vm.runInNewContext(code, { exports, AbortController, Date, Buffer, Uint8Array, Set, Map, URL, performance,
      process, setTimeout, clearTimeout, require: key => {
        if (key.startsWith('./')) return load(key.slice(2));
        if (!['node:child_process', 'node:net', 'node:path'].includes(key)) throw new Error('unexpected-adapter-port');
        return require(key);
      },
    }, { timeout: 2000, filename: name + '.ts' });
    return exports;
  }
  return load('easyTierWindowsProcesses');
}

async function execute() {
  // Nothing else (OS reads, copies, configs, sockets, child processes) precedes this gate.
  validateApproval(process.argv.slice(2));
  if (process.platform !== 'win32') throw new Error('windows-only');
  for (const [file, expected] of Object.entries(SCOPE.observationSources)) {
    if (sha256(await fsp.readFile(path.join(scripts, file))) !== expected) throw new Error('approved-snapshot-source-mismatch');
  }
  const { EasyTierWindowsProcesses } = loadOwnedAdapter();
  const processes = new EasyTierWindowsProcesses(15897);
  let latestCore, directory, config, reportPath, diagnosticDirectory;
  let diagnosticReady,observer,observerReady;
  const cancelReads = () => observer?.cancel();
  const saveEvidence = async (name, evidence) => {
    // Exists even when the first preflight fails, before payload/config preparation.
    diagnosticReady ??= (async () => {
      const root = path.join(client, '.laokuai-tun-diagnostics');
      try { const stat = await fsp.lstat(root); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe-diagnostic-directory'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; await fsp.mkdir(root); }
      if (await fsp.realpath(root) !== path.join(await fsp.realpath(client), '.laokuai-tun-diagnostics')) throw new Error('unsafe-diagnostic-directory');
      diagnosticDirectory = path.join(root, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID());
      await fsp.mkdir(diagnosticDirectory);
      return diagnosticDirectory;
    })();
    const destination = await diagnosticReady;
    await fsp.writeFile(path.join(destination, name),
      JSON.stringify({ ...evidence, scopeSha256: SCOPE_SHA256 }, null, 2), { flag: 'wx' });
  };
  const getObserver=()=>observerReady??=(async()=>{
    await saveEvidence('observer-scope.json',{scope:SCOPE});
    observer=createOwnedObserver({scripts,directory:diagnosticDirectory,powershell:path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe')});
    return observer;
  })();
  const onCancel = stop => {
    const listener = () => { stop(); cancelReads(); };
    process.on('SIGINT', listener); process.on('SIGTERM', listener);
    return () => { process.off('SIGINT', listener); process.off('SIGTERM', listener); };
  };
  try {
    const result = await runBoundedTrial({ processes, cancelReads,
      full:async args=>(await getObserver()).full(args),light:async args=>(await getObserver()).light(args),
      setTimer: (callback, ms) => setTimeout(callback, ms), clearTimer: timer => clearTimeout(timer),
      onCancel, pause: ms => new Promise(resolve => setTimeout(resolve, ms)),
      prepare: async () => {
        const payload = Object.fromEntries(await Promise.all(SCOPE.payload.map(async file => [file.name, await fsp.readFile(file.path)])));
        const buildBytes = await fsp.readFile(SCOPE.buildReceipt.path), auditBytes = await fsp.readFile(SCOPE.importAudit.path);
        verifyTrialPayload(payload, buildBytes, auditBytes);
        const documents = Object.fromEntries(await Promise.all([...SCOPE.licenseFiles, SCOPE.notices, SCOPE.inventory]
          .map(async file => [file.file, await fsp.readFile(path.join(client, 'release', file.file))])));
        verifyTrialDocuments(documents);
        const root = path.join(client, '.laokuai-tun-trial');
        try { if (!(await fsp.lstat(root)).isDirectory() || (await fsp.lstat(root)).isSymbolicLink()) throw new Error('unsafe-trial-directory'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; await fsp.mkdir(root); }
        if (await fsp.realpath(root) !== path.join(await fsp.realpath(client), '.laokuai-tun-trial')) throw new Error('unsafe-trial-directory');
        const run = path.join(root, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID());
        await fsp.mkdir(run); directory = path.join(run, 'runtime'); await fsp.mkdir(directory);
        reportPath = path.join(run, 'result.json');
        await fsp.writeFile(path.join(run, 'approved-scope.json'), JSON.stringify({ scope: SCOPE, sha256: SCOPE_SHA256 }, null, 2), { flag: 'wx' });
        for (const [name, bytes] of Object.entries(payload)) await fsp.writeFile(path.join(directory, name), bytes, { flag: 'wx' });
        await fsp.mkdir(path.join(run, 'licenses'));
        for (const [name, bytes] of Object.entries(documents)) await fsp.writeFile(path.join(run, name), bytes, { flag: 'wx' });
        await fsp.writeFile(path.join(run, 'BUILD-DELIVERY.json'), buildBytes, { flag: 'wx' });
        await fsp.writeFile(path.join(run, 'PE-IMPORT-AUDIT.json'), auditBytes, { flag: 'wx' });
        const instanceId = randomUUID(), text = buildIsolatedConfig(instanceId);
        const configFile = path.join(run, 'isolated-no-peer.toml');
        await fsp.writeFile(configFile, text, { flag: 'wx' });
        // Test-only launch metadata. Never enters manager, renderer, community receipt or real profile.
        config = { serverId: 'owned-nic-trial-only', instanceId, networkName: 'default', configFile,
          configSha256: sha256(text), bootstrap: 'product-owned' };
      },
      start: async () => {
        // Reverify staged bytes and the exact config immediately before launching.
        const payload = Object.fromEntries(await Promise.all(SCOPE.payload.map(async file => [file.name, await fsp.readFile(path.join(directory, file.name))])));
        if (JSON.stringify((await fsp.readdir(directory)).sort()) !== JSON.stringify(SCOPE.payload.map(file => file.name).sort())) throw new Error('unexpected-staged-runtime-file');
        verifyTrialPayload(payload, await fsp.readFile(path.join(path.dirname(directory), 'BUILD-DELIVERY.json')), await fsp.readFile(path.join(path.dirname(directory), 'PE-IMPORT-AUDIT.json')));
        verifyTrialDocuments(Object.fromEntries(await Promise.all([...SCOPE.licenseFiles, SCOPE.notices, SCOPE.inventory]
          .map(async file => [file.file, await fsp.readFile(path.join(path.dirname(directory), file.file))]))));
        if (sha256(await fsp.readFile(config.configFile)) !== config.configSha256) throw new Error('trial-config-modified');
        latestCore = await processes.start(directory, config, new AbortController().signal);
        return latestCore;
      },
    });
    try { await observer?.close(); } catch { result.outcome='failed';result.failure??='observer-close-unconfirmed'; }
    await saveEvidence('trial-result.json',result);
    await fsp.writeFile(reportPath, JSON.stringify(result, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ outcome: result.outcome, failure: result.failure, ready: result.ready,
      scopeSha256: SCOPE_SHA256, reportPath, diagnosticDirectory, reports: result.reports, realCommunityJoinVerified: false }));
    process.exitCode = result.outcome === 'passed' ? 0 : 1;
  } catch (error) {
    processes.shutdownOwned();
    try { await processes.drainOwned(); } catch { /* Keep owned cleanup evidence, never remove OS resources. */ }
    const result = { outcome: 'failed', failure: /^[a-z0-9-]{1,96}$/.test(error.message ?? '') ? error.message : 'trial-preflight-or-execution-failed', scopeSha256: SCOPE_SHA256,
      reports: processes.cleanupReports(), diagnosticDirectory, realCommunityJoinVerified: false, deletedOsResources: false };
    await saveEvidence('trial-failure.json',result).catch(()=>{});
    if (reportPath) await fsp.writeFile(reportPath, JSON.stringify(result, null, 2), { flag: 'wx' }).catch(() => {});
    console.log(JSON.stringify(result)); process.exitCode = 1;
  } finally { cancelReads(); await observer?.close().catch(()=>{}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--check')) {
    // Prints scope only. No adapter load, process/socket, OS observation or file writes.
    console.log(JSON.stringify({ mode: 'pure-scope-check', suspended: TRIAL_SUSPENDED, scope: SCOPE, approvedScopeSha256: SCOPE_SHA256, candidateExecuted: false }, null, 2));
  } else await execute();
}

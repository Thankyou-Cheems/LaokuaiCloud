import { createHash } from 'node:crypto';
import { decodeFacts } from './owned-tun-snapshot-semantics.mjs';

export const DIAGNOSTIC_PREFIX = 'LAOKUAI_READONLY_V1 ';
const phases = new Set(['administrator','helper','adapters','addresses','routes','dns','interface-fingerprints',
  'fw-rules','fw-profiles','fw-address','fw-port','fw-application','fw-service','fw-interface','fw-interface-type',
  'fw-security','categories','driver-package','tcp-listeners','gui-identity','owned-sockets','driver-running','serialize']);
const commands = /^(Get-Net\w+|Get-DnsClientServerAddress|Get-CimInstance|Get-ChildItem|Get-ItemProperty|Get-Process|Select-String)$/;
const categories = new Set(['PermissionDenied','ObjectNotFound','NotSpecified','InvalidOperation','InvalidArgument','ResourceUnavailable','OperationStopped','SecurityError']);
const exceptionTypes = new Set(['System.Management.Automation.RuntimeException','System.Management.Automation.CommandNotFoundException',
  'System.Security.SecurityException','System.UnauthorizedAccessException','Microsoft.Management.Infrastructure.CimException',
  'System.IO.IOException','System.IO.FileNotFoundException','System.InvalidOperationException']);
const digest = value => createHash('sha256').update(value).digest('hex');

/** Preserve structured stderr and its digest, never arbitrary native/OS text or endpoints. */
export function snapshotDiagnostic(error, stderr, elapsedMs, timeoutMs, aborted) {
  const rows = [];
  let droppedLines = 0;
  for (const line of String(stderr ?? '').split(/\r?\n/)) {
    if (!line) continue;
    if (!line.startsWith(DIAGNOSTIC_PREFIX) || rows.length >= 64) { droppedLines++; continue; }
    try {
      const r = JSON.parse(line.slice(DIAGNOSTIC_PREFIX.length));
      if (r.schema !== 1 || !phases.has(r.phase) || !['start','ok','error'].includes(r.stage)
        || !Number.isSafeInteger(r.elapsedMs) || r.elapsedMs < 0) throw new Error();
      const row = { schema: 1, phase: r.phase, stage: r.stage, elapsedMs: r.elapsedMs };
      if (r.stage === 'error') {
        row.exceptionType = exceptionTypes.has(r.exceptionType) ? r.exceptionType : 'unknown';
        row.category = categories.has(r.category) ? r.category : 'unknown';
        row.hresult = Number.isSafeInteger(r.hresult) ? r.hresult : null;
        // Error IDs have provider-controlled content. Keep only a known command and OS code.
        const id = String(r.fullyQualifiedErrorId ?? '');
        const parts = id.split(',');
        const command = parts.length === 2 && commands.test(parts[1]) ? parts[1] : null;
        row.fullyQualifiedErrorId = command && /^Windows System Error \d{1,6}$/.test(parts[0]) ? id
          : command && parts[0] === 'CmdletizationQuery_NotFound' ? id
          : id === 'snapshot-requires-administrator' ? id : 'redacted';
        row.reason = ['requires-administrator','access-denied','cmdlet-unavailable','other'].includes(r.reason) ? r.reason : 'other';
      }
      rows.push(row);
    } catch { droppedLines++; }
  }
  return { schema: 1, elapsedMs, timeoutMs, aborted: Boolean(aborted),
    exitCode: Number.isInteger(error?.code) ? error.code : null,
    errorCode: ['ABORT_ERR','ETIMEDOUT','ENOENT','EACCES','ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(error?.code) ? error.code : null,
    killed: Boolean(error?.killed), signal: ['SIGTERM','SIGKILL','SIGINT'].includes(error?.signal) ? error.signal : null,
    lastPhase: rows.at(-1)?.phase ?? 'unknown', stderrBytes: Buffer.byteLength(String(stderr ?? '')),
    stderrSha256: digest(String(stderr ?? '')), droppedLines, stderr: rows };
}

/** Inject execFile for pure tests. Cancellation and the outer watchdog retain priority. */
export function readOwnedSnapshot({ execFile, executable, script, ownedPid, signal, timeoutMs, maxBuffer, now = performance.now.bind(performance), onDiagnostic, onSnapshot = async () => {} }) {
  const started = now();
  return new Promise((resolve, reject) => {
    let called = false;
    const done = async (error, stdout = '', stderr = '') => {
      if (called) return; called = true;
      const diagnostic = snapshotDiagnostic(error, stderr, Math.max(0, Math.round(now() - started)), timeoutMs, signal.aborted);
      let value, failure;
      try { value = JSON.parse(String(stdout).replace(/^\uFEFF/, '')); } catch { /* No partial JSON baseline. */ }
      if (error) failure = diagnostic.stderr.at(-1)?.reason === 'requires-administrator' ? 'read-only-snapshot-requires-administrator'
        : signal.aborted ? 'read-only-snapshot-cancelled' : error.killed || error.code === 'ETIMEDOUT' ? 'read-only-snapshot-timeout' : 'read-only-snapshot-unavailable';
      else {
        if (!value) failure = 'invalid-read-only-snapshot';
        if (!failure && (value?.snapshotSchema !== 1 || value.complete !== true)) failure = 'incomplete-read-only-snapshot';
        if (!failure && signal.aborted) failure = 'read-only-snapshot-cancelled';
      }
      // Full safe input is persisted before any policy comparison, including later decode/read failures.
      if (value?.snapshotSchema === 1) {
        if (value.semanticEncoded) {
          try { value.semanticFacts = decodeFacts(value.semanticEncoded); }
          catch { failure ||= 'invalid-semantic-configuration'; }
        }
        try { await onSnapshot(value); }
        catch { failure = 'read-only-snapshot-write-failed'; }
      }
      if (!failure && signal.aborted) failure = 'read-only-snapshot-cancelled';
      if (!value && failure) { diagnostic.partialOutputBytes=Buffer.byteLength(String(stdout));diagnostic.partialOutputSha256=digest(String(stdout)); }
      diagnostic.failure = failure ?? null;
      try { await onDiagnostic(diagnostic); }
      catch { reject(new Error('read-only-diagnostic-write-failed')); return; }
      if (failure) reject(new Error(failure)); else if (signal.aborted) reject(new Error('read-only-snapshot-cancelled')); else resolve(value);
    };
    try {
      execFile(executable, ['-NoProfile','-NonInteractive','-File',script,'-OwnedPid',String(ownedPid)],
        { windowsHide: true, shell: false, timeout: timeoutMs, maxBuffer, signal }, done);
    } catch (error) { void done(error); }
  });
}

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// CI builds the SDK first; these existing suites exercise its actual dist.
// The final freshness suite alone loads current Peer/controller TS in a VM.
if (!existsSync(new URL('../dist/webrtc/hybrid/HybridRouteController.js', import.meta.url))) {
  throw Error('Build the SDK with npm run build before hybrid regressions');
}
const prelude = new URL('./hybrid-network-guard.mjs', import.meta.url).href;
const cases = [
  ['controller permissions, leases and recovery with controlled peer frames', 'check-hybrid.mjs'],
  ['authority and exact-track stats boundary', 'check-hybrid-network-boundary.mjs'],
  ['pair scheduling and receive graph adapter', 'check-hybrid-integration.mjs'],
  ['fenced borrowed source ownership', 'check-hybrid-source-ownership.mjs'],
  ['host session lifecycle with external adapters', 'check-hybrid-session.mjs'],
  ['authentication and retired pair cleanup', 'check-hybrid-auth-recovery.mjs'],
  ['diagnostic privacy and failure classification', 'check-hybrid-diagnostics.mjs'],
  ['selected candidate pair classification', 'check-peer-path-stats.mjs'],
  ['production Peer/controller freshness and historical counterexamples', 'check-hybrid-media-freshness.mjs'],
];
for (const [behavior, script] of cases) {
  const result = spawnSync(process.execPath, ['--import', prelude, fileURLToPath(new URL(script, import.meta.url))],
    { encoding: 'utf8', timeout: 20000, env: process.env });
  if (result.error || result.status !== 0) {
    process.stderr.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
    throw result.error ?? Error('hybrid regression failed: ' + behavior);
  }
  console.log('PASS ' + behavior);
}
console.log('Built SDK regressions and source VM freshness counterexamples passed; synthetic boundaries only, no audibility or WAN acceptance.');

import { setTimeout as pause } from 'node:timers/promises';

import type { EasyTierExistingConfiguration } from './easyTierExistingConfiguration';
import type { EasyTierCliCore } from './easyTierWindowsProcesses';
import {
  cleanupLaokuaiOwnedTunFirewallRules,   type LaokuaiOwnedTunFirewallEvidence, type LaokuaiOwnedTunFirewallOptions,
prepareLaokuaiOwnedTunFirewallRules,
  releaseLaokuaiOwnedTunFirewallRules, validLaokuaiOwnedTunFirewallEvidence,
} from './windowsFirewallRules';

/** No adapter discovery or renderer input: join the live owned NIC receipt to
 * the address/prefix pinned by the authenticated community grant. */
export function ownedTunFirewallEvidence(config: EasyTierExistingConfiguration, core: EasyTierCliCore): LaokuaiOwnedTunFirewallEvidence | null {
  const scope = config.ownedFirewallScope;
  if (!core.isAlive() || !scope || !config.credentialIdentity
    || scope.localAddress !== config.credentialIdentity.virtualIp
    || !Number.isInteger(scope.prefixLength) || scope.prefixLength < 1 || scope.prefixLength > 30) return null;
  const interfaces = core.ownedResources?.().interfaces;
  if (interfaces?.length !== 1) return null;
  const octets = scope.localAddress.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  const address = octets.reduce((value, octet) => value * 256 + octet, 0);
  const size = 2 ** (32 - scope.prefixLength), network = Math.floor(address / size) * size;
  const remoteSubnet = [24, 16, 8, 0].map(shift => Math.floor(network / 2 ** shift) % 256).join('.') + '/' + scope.prefixLength;
  const evidence = {...interfaces[0], localAddress: scope.localAddress, remoteSubnet};
  return validLaokuaiOwnedTunFirewallEvidence(evidence) ? evidence : null;
}

/** Serialize the one application ledger across connect, disconnect and cleanup.
 * An ICMP preparation failure must not tear down an otherwise live game LAN. */
export function createOwnedTunFirewallSession(options: () => LaokuaiOwnedTunFirewallOptions,
  log: (message: string) => void) {
  let tail: Promise<unknown> = Promise.resolve();
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    const flight = tail.then(work, work); tail = flight.catch(() => undefined); return flight;
  };
  return {
    prepare: (config: EasyTierExistingConfiguration, core: EasyTierCliCore, signal: AbortSignal): Promise<() => Promise<void>> => run(async () => {
      const settings = options();
      if (!settings.product || settings.platform !== 'win32' || signal.aborted) return async () => {};
      const evidence = ownedTunFirewallEvidence(config, core);
      if (!evidence) { log('Owned TUN ICMP rule: unavailable owned interface evidence'); return async () => {}; }
      try {
        let report = await prepareLaokuaiOwnedTunFirewallRules(settings, evidence);
        // CLI readiness can precede the OS address appearing on the same owned
        // NIC. Retry only that readback race; never retry identity/ownership errors.
        for (let attempt = 1; attempt < 3 && report.installed.length === 0 && report.failures.length > 0 &&
          report.failures.every(failure => failure.code === 'tun-not-ready'); attempt++) {
          await pause(250, undefined, {signal});
          if (!core.isAlive() || signal.aborted) break;
          report = await prepareLaokuaiOwnedTunFirewallRules(settings, evidence);
        }
        log(`Owned TUN ICMP rule: status=${report.status} installed=${report.installed.length} failures=${report.failures.map(failure => failure.code).join(',')}`);
        let released = false;
        return () => run(async () => {
          if (released) return;
          const result = await releaseLaokuaiOwnedTunFirewallRules(settings, report.installed);
          log(`Owned TUN ICMP release: status=${result.status} removed=${result.removed.length} failures=${result.failures.length}`);
          if (result.status !== 'prepared' && result.status !== 'bypassed') throw new Error('owned-tun-firewall-cleanup-failed');
          released = true;
        });
      } catch {
        log('Owned TUN ICMP rule: preparation failed; LAN remains running');
        return async () => {};
      }
    }),
    cleanup: () => run(() => cleanupLaokuaiOwnedTunFirewallRules(options())),
  };
}

import { diagnosticCode, type LocalDiagnostic } from '../src/lib/localDiagnostics';
import type { CommunityEtRuntimeDiagnostic } from './communityEtGrantRuntime';
import type { EasyTierManagerDiagnostic } from './easyTierCommunityManager';

/** Explicit projection; never forward runtime objects or raw error text to disk. */
export function networkDiagnostic(event: CommunityEtRuntimeDiagnostic | EasyTierManagerDiagnostic): LocalDiagnostic {
  const code = event.code === 'success' || event.code === null ? 'ok' : diagnosticCode(event.code);
  if (event.event === 'http') {
    const operations = {session:'credential-session', acquire:'credential-acquire', renew:'credential-renew',
      revoke:'credential-revoke', binding:'credential-binding', directory:'credential-directory',
      relay:'credential-policy', 'relay-renew':'credential-policy', 'relay-status':'credential-relay-status'} as const;
    return {phase:'lan', operation:operations[event.operation], action:event.action, code, reason:event.reason ?? null,
      ...(event.httpStatus === null ? {} : {httpStatus:event.httpStatus})};
  }
  if (event.event === 'state' || event.event === 'telemetry') return {
    phase:'lan', operation:event.event === 'state' ? 'lan-state' : 'lan-telemetry',
    action:event.action, code, generation:event.generation, status:event.phase, reason:event.reason ?? null,
  };
  return {phase:'lan', operation:event.event, action:event.action, code, generation:event.generation};
}

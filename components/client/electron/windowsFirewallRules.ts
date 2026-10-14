import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, win32 } from "node:path";

/**
 * The Windows firewall is changed by the already-elevated, packaged broker's
 * native COM implementation.  This module only sends a small typed JSON
 * request to that executable.  It never invokes PowerShell/netsh, installs a
 * service, starts a driver, or asks Windows for another UAC prompt.
 */
export const LAOKUAI_FIREWALL_RULE_PREFIX = "LaokuaiCloud.Managed.v1.";
export const LAOKUAI_FIREWALL_RULE_GROUP = "LaokuaiCloud";
export const LAOKUAI_FIREWALL_LEDGER_SCHEMA = 2 as const;
export const LAOKUAI_FIREWALL_WIRE_SCHEMA = 2 as const;

const MAX_LEDGER_BYTES = 64 * 1024;
const MAX_WIRE_BYTES = 64 * 1024;
const RULE_NAME_PATTERN = /^LaokuaiCloud\.Managed\.v1\.(app|easytier)\.([0-9a-f]{24})$/;
const RULE_KINDS = ["app", "easytier"] as const;

export type LaokuaiFirewallRuleKind = typeof RULE_KINDS[number];

export interface LaokuaiFirewallRule {
  schemaVersion: typeof LAOKUAI_FIREWALL_LEDGER_SCHEMA;
  kind: LaokuaiFirewallRuleKind;
  name: string;
  program: string;
  ownershipId: string;
}

interface FirewallLedger {
  schemaVersion: typeof LAOKUAI_FIREWALL_LEDGER_SCHEMA;
  rules: LaokuaiFirewallRule[];
}

export interface LaokuaiFirewallWireRequest {
  schemaVersion: typeof LAOKUAI_FIREWALL_WIRE_SCHEMA;
  operation: "reconcile" | "cleanup";
  ensure: LaokuaiFirewallRule[];
  remove: LaokuaiFirewallRule[];
}

export interface LaokuaiFirewallWireFailure {
  operation: "ensure" | "remove";
  name: string;
  code: string;
}

export interface LaokuaiFirewallWireResponse {
  schemaVersion: typeof LAOKUAI_FIREWALL_WIRE_SCHEMA;
  installed: string[];
  removed: string[];
  failures: LaokuaiFirewallWireFailure[];
}

export interface LaokuaiFirewallOptions {
  platform: NodeJS.Platform;
  product: boolean;
  appExecutable: string;
  /** The actual verified cache path used by the launched EasyTier core. */
  easyTierExecutable?: string | null;
  /** Fixed, hash-verified native audio sidecar. It is another owned app executable. */
  nativeAudioExecutable?: string | null;
  /** Packaged community-lan-broker.exe, which handles COM firewall calls. */
  helperExecutable: string;
  ledgerFile: string;
  fileExists?: (path: string) => boolean;
  readLedgerFile?: (path: string) => string;
  writeLedgerFile?: (path: string, contents: string) => void;
  /** Tests inject a fake COM backend; production uses the helper below. */
  invoke?: (helperExecutable: string, request: LaokuaiFirewallWireRequest) => LaokuaiFirewallWireResponse | Promise<LaokuaiFirewallWireResponse>;
  logger?: (message: string) => void;
}

export interface LaokuaiFirewallReport {
  status: "bypassed" | "prepared" | "partial" | "failed";
  installed: LaokuaiFirewallRule[];
  removed: string[];
  failures: LaokuaiFirewallWireFailure[];
}

/** Canonical Windows path used for rule names and COM comparisons. */
export function normalizeLaokuaiFirewallPath(value: string): string | null {
  if (typeof value !== "string" || !/^[a-z]:[\\/]/i.test(value) || value.includes('"')
    || [...value].some(character => character.charCodeAt(0) < 32) || !win32.isAbsolute(value)) return null;
  const normalized = win32.normalize(value)
    .replace(/^[a-z]:/i, drive => drive.toUpperCase())
    .replace(/[\\/]+$/, "");
  return normalized.length > 0 ? normalized : null;
}

function pathKey(value: string): string {
  return normalizeLaokuaiFirewallPath(value)?.toLowerCase() ?? value.toLowerCase();
}

/** A deterministic name is part of ownership; it is not a user-facing title. */
export function laokuaiFirewallRuleName(kind: LaokuaiFirewallRuleKind, program: string): string {
  const digest = createHash("sha256").update(`${kind}\0${pathKey(program)}`).digest("hex").slice(0, 24);
  return `${LAOKUAI_FIREWALL_RULE_PREFIX}${kind}.${digest}`;
}

export function isLaokuaiFirewallRuleName(value: unknown): value is string {
  return typeof value === "string" && RULE_NAME_PATTERN.test(value);
}

function ruleFor(kind: LaokuaiFirewallRuleKind, program: string): LaokuaiFirewallRule | null {
  const normalized = normalizeLaokuaiFirewallPath(program);
  if (!normalized) return null;
  return {
    schemaVersion: LAOKUAI_FIREWALL_LEDGER_SCHEMA,
    kind,
    name: laokuaiFirewallRuleName(kind, normalized),
    program: normalized,
    ownershipId: randomUUID().replace(/-/g, ""),
  };
}

/** Pure target construction used by the main process and source tests. */
export function buildLaokuaiFirewallRules(appExecutable: string, easyTierExecutable?: string | null, nativeAudioExecutable?: string | null): LaokuaiFirewallRule[] {
  const values = [ruleFor("app", appExecutable), ruleFor("easytier", easyTierExecutable ?? ""), ruleFor("app", nativeAudioExecutable ?? "")];
  const result: LaokuaiFirewallRule[] = [];
  for (const rule of values) {
    if (!rule || result.some(existing => existing.name === rule.name)) continue;
    result.push(rule);
  }
  return result;
}

function validLedgerRule(value: unknown): value is LaokuaiFirewallRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== LAOKUAI_FIREWALL_LEDGER_SCHEMA
    || !RULE_KINDS.includes(record.kind as LaokuaiFirewallRuleKind)
    || !isLaokuaiFirewallRuleName(record.name)
    || typeof record.program !== "string"
    || typeof record.ownershipId !== "string" || !/^[0-9a-f]{32}$/.test(record.ownershipId)) return false;
  const program = normalizeLaokuaiFirewallPath(record.program);
  if (!program) return false;
  const kind = record.kind as LaokuaiFirewallRuleKind;
  // The deterministic name prevents a corrupted ledger from selecting an
  // arbitrary rule that merely happens to use our textual prefix.
  return record.name === laokuaiFirewallRuleName(kind, program);
}

function readLedger(path: string, read: (path: string) => string): LaokuaiFirewallRule[] {
  try {
    const contents = read(path);
    if (Buffer.byteLength(contents, "utf8") > MAX_LEDGER_BYTES) throw new Error("firewall-ledger-too-large");
    const parsed = JSON.parse(contents) as Record<string, unknown>;
    if (parsed.schemaVersion !== LAOKUAI_FIREWALL_LEDGER_SCHEMA || !Array.isArray(parsed.rules)) throw new Error("firewall-ledger-invalid");
    const result: LaokuaiFirewallRule[] = [];
    for (const value of parsed.rules) {
      if (!validLedgerRule(value)) throw new Error("firewall-ledger-invalid-rule");
      const rule = value as LaokuaiFirewallRule;
      if (result.some(existing => existing.name === rule.name)) throw new Error("firewall-ledger-duplicate-rule");
      result.push(rule);
      if (result.length > 64) throw new Error("firewall-ledger-too-many-rules");
    }
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function writeLedger(path: string, rules: LaokuaiFirewallRule[], write: (path: string, contents: string) => void): void {
  if (rules.length > 64) throw new Error("firewall-ledger-too-many-rules");
  mkdirSync(dirname(path), { recursive: true });
  const ledger: FirewallLedger = { schemaVersion: LAOKUAI_FIREWALL_LEDGER_SCHEMA, rules };
  write(path, `${JSON.stringify(ledger, null, 2)}\n`);
}

function atomicLedgerWrite(path: string, contents: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

async function defaultInvoke(helperExecutable: string, request: LaokuaiFirewallWireRequest): Promise<LaokuaiFirewallWireResponse> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(helperExecutable, ["--firewall"], {
      windowsHide: true,
      shell: false,
      timeout: 8000,
      maxBuffer: MAX_WIRE_BYTES,
      encoding: "utf8",
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.end(`${JSON.stringify(request)}\n`);
  });
  if (String(output).length > MAX_WIRE_BYTES) throw new Error("firewall-response-too-large");
  const parsed = JSON.parse(String(output).trim()) as Partial<LaokuaiFirewallWireResponse>;
  if (parsed.schemaVersion !== LAOKUAI_FIREWALL_WIRE_SCHEMA
    || !Array.isArray(parsed.installed) || !Array.isArray(parsed.removed) || !Array.isArray(parsed.failures)) {
    throw new Error("firewall-response-invalid");
  }
  return {
    schemaVersion: LAOKUAI_FIREWALL_WIRE_SCHEMA,
    installed: parsed.installed.filter((value): value is string => typeof value === "string"),
    removed: parsed.removed.filter((value): value is string => typeof value === "string"),
    failures: parsed.failures.filter((value): value is LaokuaiFirewallWireFailure => !!value && typeof value === "object"
      && ["ensure", "remove"].includes((value as LaokuaiFirewallWireFailure).operation)
      && typeof (value as LaokuaiFirewallWireFailure).name === "string"
      && typeof (value as LaokuaiFirewallWireFailure).code === "string"),
  };
}

async function invokeFor(options: LaokuaiFirewallOptions, request: LaokuaiFirewallWireRequest): Promise<LaokuaiFirewallWireResponse> {
  const result = await (options.invoke ?? defaultInvoke)(options.helperExecutable, request);
  if (result.schemaVersion !== LAOKUAI_FIREWALL_WIRE_SCHEMA || !Array.isArray(result.installed)
    || !Array.isArray(result.removed) || !Array.isArray(result.failures)) throw new Error("firewall-response-invalid");
  const installed = result.installed.filter(name => request.ensure.some(rule => rule.name === name));
  const removed = result.removed.filter(name => request.remove.some(rule => rule.name === name));
  const failures = result.failures.filter(failure => (failure.operation === "ensure" ? request.ensure : request.remove)
    .some(rule => rule.name === failure.name));
  for (const rule of request.ensure) if (!installed.includes(rule.name) && !failures.some(failure => failure.name === rule.name)) {
    failures.push({ operation: "ensure", name: rule.name, code: "verification-missing" });
  }
  for (const rule of request.remove) if (!removed.includes(rule.name) && !failures.some(failure => failure.name === rule.name)) {
    failures.push({ operation: "remove", name: rule.name, code: "verification-missing" });
  }
  return { schemaVersion: LAOKUAI_FIREWALL_WIRE_SCHEMA, installed, removed, failures };
}

function classify(installed: LaokuaiFirewallRule[], removed: string[], failures: LaokuaiFirewallWireFailure[]): LaokuaiFirewallReport["status"] {
  if (failures.length === 0) return "prepared";
  if (installed.length > 0 || removed.length > 0) return "partial";
  return "failed";
}

function reportRules(rules: readonly LaokuaiFirewallRule[], names: readonly string[]): LaokuaiFirewallRule[] {
  const accepted = new Set(names);
  return rules.filter(rule => accepted.has(rule.name));
}

function emptyReport(status: LaokuaiFirewallReport["status"]): LaokuaiFirewallReport {
  return { status, installed: [], removed: [], failures: [] };
}

/**
 * Reconcile only the app rule and, once the verified cache exists, the actual
 * EasyTier-core rule.  Missing ET cache is not an instruction to delete a
 * previous ET rule; its kind is outside this call's desired scope.
 */
export async function prepareLaokuaiFirewallRules(options: LaokuaiFirewallOptions): Promise<LaokuaiFirewallReport> {
  if (!options.product || options.platform !== "win32") return emptyReport("bypassed");
  if (!options.helperExecutable) return emptyReport("failed");
  const fileExists = options.fileExists ?? ((path: string) => existsSync(path) && statSync(path).isFile());
  const read = options.readLedgerFile ?? ((path: string) => readFileSync(path, "utf8"));
  const write = options.writeLedgerFile ?? atomicLedgerWrite;
  let prior: LaokuaiFirewallRule[];
  try { prior = readLedger(options.ledgerFile, read); }
  catch { return { ...emptyReport("failed"), failures: [{ operation: "ensure", name: "firewall-ledger", code: "ledger-read-failed" }] }; }
  const current = buildLaokuaiFirewallRules(options.appExecutable, options.easyTierExecutable, options.nativeAudioExecutable)
    .filter(rule => { try { return fileExists(rule.program); } catch { return false; } })
    .map(rule => prior.find(old => old.name === rule.name) ?? rule);
  if (current.length !== 1 + (options.easyTierExecutable ? 1 : 0) + (options.nativeAudioExecutable ? 1 : 0)) {
    return { ...emptyReport("failed"), failures: [{ operation: "ensure", name: "firewall-target", code: "target-missing-or-invalid" }] };
  }
  const currentNames = new Set(current.map(rule => rule.name));
  const currentKinds = new Set(current.map(rule => rule.kind));
  // Only retire a stale rule after its kind has a current replacement.  This
  // preserves an ET rule during the app-only startup pass.
  const stale = prior.filter(rule => !currentNames.has(rule.name) && currentKinds.has(rule.kind));
  const retained = new Map(prior.map(rule => [rule.name, rule]));
  // Save ownership before COM mutation, so interruption cannot create an
  // untracked rule. If saving fails, make no firewall changes.
  for (const rule of current) retained.set(rule.name, rule);
  try { writeLedger(options.ledgerFile, [...retained.values()], write); }
  catch { return { ...emptyReport("failed"), failures: [{ operation: "ensure", name: "firewall-ledger", code: "ledger-write-failed" }] }; }
  const request: LaokuaiFirewallWireRequest = {
    schemaVersion: LAOKUAI_FIREWALL_WIRE_SCHEMA,
    operation: "reconcile",
    ensure: current,
    remove: stale,
  };
  let response: LaokuaiFirewallWireResponse;
  try { response = await invokeFor(options, request); }
  catch { return { status: "failed", installed: [], removed: [], failures: [{ operation: "ensure", name: current[0].name, code: "helper-unavailable" }] }; }
  const failures = response.failures;
  const installed = reportRules(current, response.installed);
  for (const rule of installed) retained.set(rule.name, rule);
  for (const rule of stale) {
    if (response.removed.includes(rule.name)) retained.delete(rule.name);
    else if (!failures.some(failure => failure.name === rule.name)) retained.set(rule.name, rule);
  }
  try { writeLedger(options.ledgerFile, [...retained.values()], write); }
  catch { failures.push({ operation: "ensure", name: "firewall-ledger", code: "ledger-write-failed" }); options.logger?.("firewall-ledger-write-failed"); }
  if (failures.length > 0) options.logger?.(`firewall-rules-partial:${failures.length}`);
  return { status: classify(installed, response.removed, failures), installed, removed: response.removed, failures };
}

/**
 * Remove only ledger-backed rules. The native
 * helper checks every COM rule's path, direction, action, profile, protocol,
 * enabled state and group before it removes anything, so a user block rule or
 * a same-name collision is preserved.
 */
export async function cleanupLaokuaiFirewallRules(options: LaokuaiFirewallOptions): Promise<LaokuaiFirewallReport> {
  if (!options.product || options.platform !== "win32") return emptyReport("bypassed");
  if (!options.helperExecutable) return emptyReport("failed");
  const read = options.readLedgerFile ?? ((path: string) => readFileSync(path, "utf8"));
  const write = options.writeLedgerFile ?? atomicLedgerWrite;
  let prior: LaokuaiFirewallRule[];
  try { prior = readLedger(options.ledgerFile, read); }
  catch { return { ...emptyReport("failed"), failures: [{ operation: "remove", name: "firewall-ledger", code: "ledger-read-failed" }] }; }
  const candidates = new Map<string, LaokuaiFirewallRule>();
  for (const rule of prior) candidates.set(rule.name, rule);
  if (!candidates.size) return emptyReport("prepared");
  const request: LaokuaiFirewallWireRequest = {
    schemaVersion: LAOKUAI_FIREWALL_WIRE_SCHEMA,
    operation: "cleanup",
    ensure: [],
    remove: [...candidates.values()],
  };
  let response: LaokuaiFirewallWireResponse;
  try { response = await invokeFor(options, request); }
  catch { return { status: "failed", installed: [], removed: [], failures: [{ operation: "remove", name: "firewall-helper", code: "helper-unavailable" }] }; }
  const failures = response.failures;
  const retained = [...candidates.values()].filter(rule => !response.removed.includes(rule.name));
  try { writeLedger(options.ledgerFile, retained, write); }
  catch { failures.push({ operation: "remove", name: "firewall-ledger", code: "ledger-write-failed" }); options.logger?.("firewall-ledger-write-failed"); }
  return { status: classify([], response.removed, failures), installed: [], removed: response.removed, failures };
}

/** Main-only evidence from the live owned core receipt and verified community configuration. */
export interface LaokuaiOwnedTunFirewallEvidence {
  guid: string;
  luid: string;
  ifIndex: number;
  localAddress: string;
  remoteSubnet: string;
}
export interface LaokuaiOwnedTunFirewallRule extends LaokuaiOwnedTunFirewallEvidence {
  schemaVersion: 1;
  interfaceAlias: string;
  name: string;
  ownershipId: string;
}
export interface LaokuaiOwnedTunFirewallRequest {
  schemaVersion: 1;
  operation: "resolve" | "ensure" | "remove";
  evidence?: LaokuaiOwnedTunFirewallEvidence;
  rules: LaokuaiOwnedTunFirewallRule[];
}
export interface LaokuaiOwnedTunFirewallResponse {
  schemaVersion: 1;
  scope?: LaokuaiOwnedTunFirewallEvidence & { interfaceAlias: string };
  installed: string[];
  removed: string[];
  failures: LaokuaiFirewallWireFailure[];
}
export interface LaokuaiOwnedTunFirewallOptions {
  platform: NodeJS.Platform;
  product: boolean;
  helperExecutable: string;
  /** Separate from firewall-rules.json: preserves the original two-rule protocol. */
  ledgerFile: string;
  readLedgerFile?: (path: string) => string;
  writeLedgerFile?: (path: string, contents: string) => void;
  invoke?: (helper: string, request: LaokuaiOwnedTunFirewallRequest) => LaokuaiOwnedTunFirewallResponse | Promise<LaokuaiOwnedTunFirewallResponse>;
  logger?: (message: string) => void;
}
export interface LaokuaiOwnedTunFirewallReport {
  status: LaokuaiFirewallReport["status"];
  installed: LaokuaiOwnedTunFirewallRule[];
  removed: string[];
  failures: LaokuaiFirewallWireFailure[];
}
const TUN_RULE_PREFIX = "LaokuaiCloud.OwnedTun.Icmp.v1.";
function ipv4Number(value: unknown): number | null {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$/.test(value)) return null;
  const octets = value.split(".").map(Number);
  if (octets.some(octet => octet > 255)) return null;
  return octets.reduce((number, octet) => number * 256 + octet, 0);
}
function privateIpv4Number(value: number): boolean {
  return (value >= 0x0a000000 && value <= 0x0affffff)
    || (value >= 0xac100000 && value <= 0xac1fffff)
    || (value >= 0xc0a80000 && value <= 0xc0a8ffff);
}
export function validLaokuaiOwnedTunFirewallEvidence(value: unknown): value is LaokuaiOwnedTunFirewallEvidence {
  if (!value || typeof value !== "object") return false;
  const scope = value as LaokuaiOwnedTunFirewallEvidence;
  if (typeof scope.guid !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(scope.guid)
    || scope.guid === "00000000-0000-0000-0000-000000000000"
    || typeof scope.luid !== "string" || !/^[1-9][0-9]{0,19}$/.test(scope.luid) || BigInt(scope.luid) > 0xffffffffffffffffn
    || !Number.isInteger(scope.ifIndex) || scope.ifIndex < 1 || scope.ifIndex > 0x7fffffff
    || typeof scope.remoteSubnet !== "string") return false;
  const address = ipv4Number(scope.localAddress), parts = scope.remoteSubnet.split("/");
  if (address === null || !privateIpv4Number(address) || parts.length !== 2 || !/^([1-9]|[12][0-9]|3[0-2])$/.test(parts[1])) return false;
  const network = ipv4Number(parts[0]), size = 2 ** (32 - Number(parts[1]));
  return network !== null && network % size === 0 && privateIpv4Number(network)
    && privateIpv4Number(network + size - 1) && address >= network && address < network + size;
}
function tunIdentity(scope: LaokuaiOwnedTunFirewallEvidence & { interfaceAlias: string }): string {
  return [scope.guid, scope.luid, scope.ifIndex, scope.interfaceAlias, scope.localAddress, scope.remoteSubnet].join("\0");
}
function tunRuleName(scope: LaokuaiOwnedTunFirewallEvidence & { interfaceAlias: string }): string {
  return `${TUN_RULE_PREFIX}${createHash("sha256").update(tunIdentity(scope)).digest("hex").slice(0, 24)}`;
}
function validTunScope(value: unknown): value is LaokuaiOwnedTunFirewallEvidence & { interfaceAlias: string } {
  if (!validLaokuaiOwnedTunFirewallEvidence(value)) return false;
  const alias = (value as { interfaceAlias?: unknown }).interfaceAlias;
  return typeof alias === "string" && alias.length > 0 && alias.length <= 256
    && ![...alias].some(character => character.charCodeAt(0) < 32);
}
function validTunRule(value: unknown): value is LaokuaiOwnedTunFirewallRule {
  if (!validTunScope(value)) return false;
  const rule = value as LaokuaiOwnedTunFirewallRule;
  return rule.schemaVersion === 1 && rule.name === tunRuleName(rule)
    && typeof rule.ownershipId === "string" && /^[0-9a-f]{32}$/.test(rule.ownershipId);
}
function readTunLedger(options: LaokuaiOwnedTunFirewallOptions): LaokuaiOwnedTunFirewallRule[] {
  try {
    const contents = (options.readLedgerFile ?? (file => readFileSync(file, "utf8")))(options.ledgerFile);
    if (Buffer.byteLength(contents, "utf8") > MAX_LEDGER_BYTES) throw new Error("tun-ledger-too-large");
    const ledger = JSON.parse(contents) as { schemaVersion: unknown; rules: unknown[] };
    if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.rules) || ledger.rules.length > 64
      || !ledger.rules.every(validTunRule) || new Set(ledger.rules.map(rule => rule.name)).size !== ledger.rules.length) throw new Error("tun-ledger-invalid");
    return ledger.rules;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
function writeTunLedger(options: LaokuaiOwnedTunFirewallOptions, rules: LaokuaiOwnedTunFirewallRule[]): void {
  if (rules.length > 64) throw new Error("tun-ledger-too-many-rules");
  const contents = `${JSON.stringify({ schemaVersion: 1, rules }, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_LEDGER_BYTES) throw new Error("tun-ledger-too-large");
  mkdirSync(dirname(options.ledgerFile), { recursive: true });
  (options.writeLedgerFile ?? atomicLedgerWrite)(options.ledgerFile, contents);
}
async function invokeTunFirewall(options: LaokuaiOwnedTunFirewallOptions, request: LaokuaiOwnedTunFirewallRequest): Promise<LaokuaiOwnedTunFirewallResponse> {
  let result: LaokuaiOwnedTunFirewallResponse;
  if (options.invoke) result = await options.invoke(options.helperExecutable, request);
  else {
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(options.helperExecutable, ["--firewall-tun"], { windowsHide: true, shell: false,
        timeout: 8000, maxBuffer: MAX_WIRE_BYTES, encoding: "utf8" }, (error, stdout) => error ? reject(error) : resolve(stdout));
      child.stdin?.end(`${JSON.stringify(request)}\n`);
    });
    result = JSON.parse(output) as LaokuaiOwnedTunFirewallResponse;
  }
  if (!result || result.schemaVersion !== 1 || !Array.isArray(result.installed) || !Array.isArray(result.removed) || !Array.isArray(result.failures)
    || !result.installed.every(name => typeof name === "string") || !result.removed.every(name => typeof name === "string")
    || !result.failures.every(failure => !!failure && ["ensure", "remove"].includes(failure.operation)
      && typeof failure.name === "string" && typeof failure.code === "string")) throw new Error("tun-response-invalid");
  return result;
}
function tunReport(status: LaokuaiOwnedTunFirewallReport["status"], code?: string, operation: "ensure" | "remove" = "ensure"): LaokuaiOwnedTunFirewallReport {
  return { status, installed: [], removed: [], failures: code ? [{ operation, name: "owned-tun-firewall", code }] : [] };
}
/** Call only after owned NIC evidence and community identity are verified. Serialize calls with release/cleanup. */
export async function prepareLaokuaiOwnedTunFirewallRules(options: LaokuaiOwnedTunFirewallOptions, evidence: LaokuaiOwnedTunFirewallEvidence): Promise<LaokuaiOwnedTunFirewallReport> {
  if (!options.product || options.platform !== "win32") return tunReport("bypassed");
  if (!options.helperExecutable || !validLaokuaiOwnedTunFirewallEvidence(evidence)) return tunReport("failed", "tun-scope-invalid");
  let prior: LaokuaiOwnedTunFirewallRule[];
  try { prior = readTunLedger(options); } catch { return tunReport("failed", "ledger-read-failed"); }
  let resolved: LaokuaiOwnedTunFirewallResponse;
  try { resolved = await invokeTunFirewall(options, { schemaVersion: 1, operation: "resolve", evidence, rules: [] }); }
  catch { return tunReport("failed", "helper-unavailable"); }
  if (resolved.failures.length > 0) return tunReport("failed", resolved.failures.every(failure => failure.code === "tun-not-ready") ? "tun-not-ready" : "tun-scope-unverified");
  if (!validTunScope(resolved.scope)
    || ["guid", "luid", "ifIndex", "localAddress", "remoteSubnet"].some(key => resolved.scope![key as keyof LaokuaiOwnedTunFirewallEvidence] !== evidence[key as keyof LaokuaiOwnedTunFirewallEvidence])) return tunReport("failed", "tun-scope-unverified");
  const scope = resolved.scope, name = tunRuleName(scope);
  const rule: LaokuaiOwnedTunFirewallRule = prior.find(old => old.name === name)
    ?? { ...scope, schemaVersion: 1, name, ownershipId: randomUUID().replace(/-/g, "") };
  const retained = prior.some(old => old.name === name) ? prior : [...prior, rule];
  // Ownership is persisted before any native mutation, including failed/partial installation.
  try { writeTunLedger(options, retained); } catch { return tunReport("failed", "ledger-write-failed"); }
  let response: LaokuaiOwnedTunFirewallResponse;
  try { response = await invokeTunFirewall(options, { schemaVersion: 1, operation: "ensure", rules: [rule] }); }
  catch { return tunReport("failed", "helper-unavailable"); }
  const installed = response.installed.includes(name) ? [rule] : [];
  const failures = response.failures.filter(failure => failure.name === name);
  if (!installed.length && !failures.length) failures.push({ operation: "ensure", name, code: "verification-missing" });
  return { status: failures.length ? installed.length ? "partial" : "failed" : "prepared", installed, removed: [], failures };
}
/** Release exact handles returned by preparation; never infer authority from adapter aliases or rule prefixes. */
export async function releaseLaokuaiOwnedTunFirewallRules(options: LaokuaiOwnedTunFirewallOptions, handles: readonly LaokuaiOwnedTunFirewallRule[]): Promise<LaokuaiOwnedTunFirewallReport> {
  if (!options.product || options.platform !== "win32") return tunReport("bypassed");
  if (!options.helperExecutable || !handles.every(validTunRule)) return tunReport("failed", "tun-handle-invalid", "remove");
  let prior: LaokuaiOwnedTunFirewallRule[];
  try { prior = readTunLedger(options); } catch { return tunReport("failed", "ledger-read-failed", "remove"); }
  const candidates = prior.filter(rule => handles.some(handle => handle.name === rule.name && handle.ownershipId === rule.ownershipId));
  if (!candidates.length) return tunReport("prepared");
  let response: LaokuaiOwnedTunFirewallResponse;
  try { response = await invokeTunFirewall(options, { schemaVersion: 1, operation: "remove", rules: candidates }); }
  catch { return tunReport("failed", "helper-unavailable", "remove"); }
  const removed = response.removed.filter(name => candidates.some(rule => rule.name === name));
  const failures = response.failures.filter(failure => candidates.some(rule => rule.name === failure.name));
  for (const rule of candidates) if (!removed.includes(rule.name) && !failures.some(failure => failure.name === rule.name)) failures.push({ operation: "remove", name: rule.name, code: "verification-missing" });
  try { writeTunLedger(options, prior.filter(rule => !removed.includes(rule.name))); }
  catch { failures.push({ operation: "remove", name: "owned-tun-firewall", code: "ledger-write-failed" }); }
  return { status: failures.length ? removed.length ? "partial" : "failed" : "prepared", installed: [], removed, failures };
}
/** Explicit user cleanup also handles persisted rules from a previous interrupted owned lifecycle. */
export async function cleanupLaokuaiOwnedTunFirewallRules(options: LaokuaiOwnedTunFirewallOptions): Promise<LaokuaiOwnedTunFirewallReport> {
  if (!options.product || options.platform !== "win32") return tunReport("bypassed");
  let prior: LaokuaiOwnedTunFirewallRule[];
  try { prior = readTunLedger(options); } catch { return tunReport("failed", "ledger-read-failed", "remove"); }
  return releaseLaokuaiOwnedTunFirewallRules(options, prior);
}


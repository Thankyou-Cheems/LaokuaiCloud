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
export function buildLaokuaiFirewallRules(appExecutable: string, easyTierExecutable?: string | null): LaokuaiFirewallRule[] {
  const values = [ruleFor("app", appExecutable), ruleFor("easytier", easyTierExecutable ?? "")];
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
  const current = buildLaokuaiFirewallRules(options.appExecutable, options.easyTierExecutable)
    .filter(rule => { try { return fileExists(rule.program); } catch { return false; } })
    .map(rule => prior.find(old => old.name === rule.name) ?? rule);
  if (current.length !== (options.easyTierExecutable ? 2 : 1)) {
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


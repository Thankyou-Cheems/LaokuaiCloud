/** Local desktop protection; no identity, audio or keyboard history is stored. */
export interface SquadConfig {
  enabled: boolean;
  processDetection: boolean;
  processTarget: string;
  keys: string[];
}

export const SQUAD_DEFAULTS: SquadConfig = {
  enabled: true, processDetection: true, processTarget: "", keys: ["KeyB", "KeyG", "KeyV"],
};
/** Preserve explicit opt-out and reject damaged persisted shapes before use. */
export function resolveSquadConfig(value: unknown): SquadConfig {
  const stored = value && typeof value === "object" ? value as Partial<SquadConfig> : {};
  const keys = Array.isArray(stored.keys) && stored.keys.every(k => typeof k === "string")
    ? stored.keys : SQUAD_DEFAULTS.keys;
  const result = { enabled: typeof stored.enabled === "boolean" ? stored.enabled : true,
    processDetection: typeof stored.processDetection === "boolean" ? stored.processDetection : true,
    processTarget: typeof stored.processTarget === "string" ? stored.processTarget : "", keys: [...keys] };
  if (validateSquadConfig(result)) { result.processTarget = ""; result.keys = [...SQUAD_DEFAULTS.keys]; }
  return result;
}
export const SQUAD_HANGOVER_MS = 200;
export type SquadStatus = "off" | "standby" | "armed" | "suppressed" | "hangover" | "unavailable";
export interface SquadSnapshot {
  status: SquadStatus;
  gateEnabled: boolean;
  suppressed: boolean;
  reason?: string;
  heldCount: number;
  global: boolean;
}
export interface SquadScope {
  valid: boolean;
  path: string;
  down: number[];
  reason?: string;
}

const MODIFIERS: Record<string, number> = { Ctrl: 17, Shift: 16, Alt: 18, Meta: 91 };
export function squadVirtualKey(code: string): number | null {
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return 111 + Number(code.slice(1));
  return ({ Space: 32, Tab: 9, Enter: 13, Escape: 27, Mouse3: 4, Mouse4: 5, Mouse5: 6 } as Record<string, number>)[code] ?? null;
}
export function squadCombo(combo: string): { base: number; modifiers: number[] } | null {
  const parts = combo.split("+");
  const base = squadVirtualKey(parts.pop() ?? "");
  if (base === null || new Set(parts).size !== parts.length || parts.some(p => !MODIFIERS[p])) return null;
  return { base, modifiers: parts.map(p => MODIFIERS[p]) };
}
export function squadTargetValid(target: string): boolean {
  if (!target) return true;
  if (/^[\w .-]+\.exe$/i.test(target)) return true;
  return /^[a-z]:\\[^\r\n"<>|?*]+\.exe$/i.test(target) && !target.split("\\").includes("..");
}
export function squadProcessMatches(path: string, target = ""): boolean {
  const normalized = path.replace(/\//g, "\\").toLowerCase();
  if (target) {
    if (!squadTargetValid(target)) return false;
    const wanted = target.toLowerCase();
    return wanted.includes("\\") ? normalized === wanted : normalized.split("\\").pop() === wanted;
  }
  // Root launchers and anti-cheat executables do not arm protection.
  return /\\squadgame\\binaries\\win64\\squadgame(?:-win64-shipping)?\.exe$/.test(normalized);
}
export function validateSquadConfig(config: SquadConfig, otherKeys: string[] = []): string | null {
  if (!squadTargetValid(config.processTarget)) return "invalid-process";
  if (config.keys.length < 1 || config.keys.length > 6 || config.keys.some(k => !squadCombo(k))) return "invalid-key";
  const parsed = config.keys.map(k => squadCombo(k)!);
  if (new Set(parsed.map(k => k.base)).size !== parsed.length) return "duplicate-key";
  for (const other of otherKeys.filter(Boolean)) {
    const binding = squadCombo(other);
    if (binding && parsed.some(k => k.base === binding.base && k.modifiers.every(m => binding.modifiers.includes(m)))) return "hotkey-conflict";
  }
  return null;
}
export function squadObservedKeys(config: SquadConfig): number[] {
  return [...new Set(config.keys.flatMap(k => { const p = squadCombo(k); return p ? [p.base, ...p.modifiers] : []; }))];
}

/** Pure state machine: time is injected; only trusted snapshots can release. */
export class SquadController {
  private config: SquadConfig = { ...SQUAD_DEFAULTS, enabled: false };
  private held = new Set<number>();
  private until = 0;
  private protected = false;
  private previousSuppression = false;
  private latest: SquadSnapshot = { status: "off", gateEnabled: false, suppressed: false, heldCount: 0, global: false };

  configure(config: SquadConfig): void { this.config = config; }
  read(): SquadSnapshot { return this.latest; }
  sample(scope: SquadScope, now: number, excluded = false, fault?: string): SquadSnapshot {
    const c = this.config;
    const global = !c.processDetection;
    if (!c.enabled) {
      this.held.clear(); this.until = 0; this.protected = false; this.previousSuppression = false;
      return this.latest = { status: "off", gateEnabled: false, suppressed: false, heldCount: 0, global };
    }
    if (!scope.valid || fault) {
      const suppressed = this.protected || this.previousSuppression;
      return this.latest = { status: "unavailable", gateEnabled: suppressed, suppressed,
        reason: fault ?? scope.reason ?? "scope-unavailable", heldCount: this.held.size, global };
    }
    const down = new Set(scope.down);
    const inScope = global || squadProcessMatches(scope.path, c.processTarget);
    const wasHeld = this.held.size > 0;
    for (const key of this.held) if (!down.has(key)) this.held.delete(key);
    if (inScope && !excluded) {
      for (const key of c.keys) {
        const p = squadCombo(key);
        if (p && down.has(p.base) && p.modifiers.every(m => down.has(m))) this.held.add(p.base);
      }
    }
    if (wasHeld && !this.held.size) this.until = now + SQUAD_HANGOVER_MS;
    const suppressed = this.held.size > 0 || now < this.until;
    this.protected = inScope || suppressed;
    this.previousSuppression = suppressed;
    return this.latest = {
      status: this.held.size ? "suppressed" : suppressed ? "hangover" : inScope ? "armed" : "standby",
      gateEnabled: this.protected, suppressed, heldCount: this.held.size, global,
    };
  }
}

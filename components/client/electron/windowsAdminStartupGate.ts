import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

const MAX_BROKER_BYTES = 32 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 4096;
const BROKER_CHECK_APPROVED = "approved";

export type LaokuaiAdminStartupResult = "approved" | "bypassed" | "denied" | "unavailable";

export interface LaokuaiAdminStartupOptions {
  platform: NodeJS.Platform;
  product: boolean;
  offlineTest: boolean;
  brokerExecutable: string;
  brokerReceipt: string;
  showError: (title: string, message: string) => void;
  exit: (code: number) => never;
  readFile?: typeof readFileSync;
  statFile?: typeof statSync;
  execute?: typeof execFileSync;
}

/** Only these two explicit, local, offline test launches may skip the product gate. */
export function isExplicitLaokuaiOfflineLaunch(argv: readonly string[]): boolean {
  return argv.some(argument => argument.startsWith("--laokuai-ui-check-dir=")) || argv.includes("--laokuai-preview");
}

/**
 * Validate the broker that is already inside the product resources. The receipt
 * is checked before invocation to reject missing or mismatched package files.
 * This consistency check is not a signature or a trust root for modified bundles.
 */
export function verifyLaokuaiBrokerBundle(
  brokerExecutable: string,
  brokerReceipt: string,
  readFile: typeof readFileSync = readFileSync,
  statFile: typeof statSync = statSync,
): boolean {
  try {
    const binaryStat = statFile(brokerExecutable);
    const receiptStat = statFile(brokerReceipt);
    if (!binaryStat.isFile() || !receiptStat.isFile()
      || binaryStat.size <= 1024 || binaryStat.size > MAX_BROKER_BYTES
      || receiptStat.size <= 0 || receiptStat.size > MAX_RECEIPT_BYTES) return false;
    const receipt = JSON.parse(readFile(brokerReceipt, "utf8")) as Record<string, unknown>;
    if (receipt.schemaVersion !== 1 || receipt.bytes !== binaryStat.size
      || typeof receipt.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(receipt.sha256)) return false;
    const actual = createHash("sha256").update(readFile(brokerExecutable)).digest("hex");
    return actual === receipt.sha256;
  } catch {
    return false;
  }
}

/**
 * Enforce administrator startup for the real Windows product. This function is
 * synchronous by design: no profile, store, window, service or native runtime
 * may be touched after a rejected launch.
 */
export function enforceLaokuaiWindowsAdminStartup(options: LaokuaiAdminStartupOptions): LaokuaiAdminStartupResult {
  if (!options.product || options.platform !== "win32" || options.offlineTest) return "bypassed";

  const readFile = options.readFile ?? readFileSync;
  const statFile = options.statFile ?? statSync;
  if (!verifyLaokuaiBrokerBundle(options.brokerExecutable, options.brokerReceipt, readFile, statFile)) {
    options.showError("唠蒯云无法启动", "无法验证管理员权限，请重新解压完整绿色包后再试。");
    options.exit(1);
  }

  const execute = options.execute ?? execFileSync;
  try {
    const output = execute(options.brokerExecutable, ["--check"], {
      windowsHide: true,
      shell: false,
      timeout: 3000,
      maxBuffer: 128,
      encoding: "utf8",
    });
    if (String(output) === BROKER_CHECK_APPROVED) return "approved";
  } catch {
    // A missing, tampered or unusable helper never becomes an implicit allow.
  }

  options.showError("唠蒯云无法启动", "请右键以管理员身份运行");
  options.exit(1);
}

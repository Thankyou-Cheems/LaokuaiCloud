import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { win32 } from "node:path";

const MAX_BROKER_BYTES = 32 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 4096;
const BROKER_CHECK_APPROVED = "approved";
export const LAOKUAI_ADMIN_RESTARTED_ARG = "--laokuai-admin-restarted";

export type LaokuaiAdminStartupResult = "approved" | "bypassed" | "denied" | "unavailable";

export interface LaokuaiAdminStartupOptions {
  platform: NodeJS.Platform;
  product: boolean;
  offlineTest: boolean;
  brokerExecutable: string;
  brokerReceipt: string;
  packaged: boolean;
  executable: string;
  argv: readonly string[];
  parentPid: number;
  portableDirectory?: string;
  promptRestart: () => boolean | Promise<boolean>;
  showError: (title: string, message: string) => void;
  exit: (code: number) => never;
  readFile?: typeof readFileSync;
  statFile?: typeof statSync;
  execute?: typeof execFileSync;
}

/** Only profile reuse and the explicit maintenance action survive elevation. */
export function laokuaiAdminRestartRequest(argv: readonly string[]): string {
  const profiles = argv.flatMap((argument, index) => argument.startsWith("--user-data-dir=")
    ? [argument.slice("--user-data-dir=".length)]
    : argument === "--user-data-dir" ? [argv[index + 1] ?? ""] : []);
  if (profiles.length > 1 || (profiles.length === 1 && !validLocalWindowsPath(profiles[0]))) {
    throw new Error("invalid-admin-restart-profile");
  }
  return JSON.stringify({
    userDataDirectory: profiles[0] ?? null,
    cleanupNetworkRules: argv.includes("--cleanup-network-rules"),
  });
}

function validLocalWindowsPath(value: string): boolean {
  return value.length < 32768 && /^[A-Za-z]:[\\/]/.test(value) && !value.includes('"')
    && [...value].every(character => character.charCodeAt(0) >= 32);
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
 * Approved launches return synchronously so pre-ready setup keeps its ordering.
 * A rejected launch returns the prompt task, which always exits. The ESM entry
 * must NOT await that task: Electron emits ready after the entry module settles.
 */
export function enforceLaokuaiWindowsAdminStartup(options: LaokuaiAdminStartupOptions): LaokuaiAdminStartupResult | Promise<never> {
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

  if (options.argv.includes(LAOKUAI_ADMIN_RESTARTED_ARG)) {
    options.showError("唠蒯云无法启动", "重新启动后仍未获得管理员权限。请退出后右键以管理员身份运行。不会再次请求提权。");
    options.exit(1);
  }
  // The single-file portable wrapper can remove its temporary extraction when
  // this process exits. Only the fixed-directory package can restart in place.
  if (!options.packaged || !validLocalWindowsPath(options.executable)
    || (options.portableDirectory && win32.resolve(options.portableDirectory).toLowerCase()
      !== win32.dirname(win32.resolve(options.executable)).toLowerCase())) {
    options.showError("唠蒯云无法启动", "请在完整解压的绿色目录中右键以管理员身份运行唠蒯云。");
    options.exit(1);
  }
  return restartAfterReadiness(options, execute);
}

async function restartAfterReadiness(options: LaokuaiAdminStartupOptions, execute: typeof execFileSync): Promise<never> {
  if (!await options.promptRestart()) options.exit(0);
  let request: string;
  try { request = laokuaiAdminRestartRequest(options.argv); }
  catch {
    options.showError("唠蒯云无法重新启动", "配置目录参数无效，请退出后从完整绿色目录重新启动。");
    options.exit(1);
  }
  let restartOutput = "";
  try {
    restartOutput = String(execute(options.brokerExecutable, ["--restart-app", String(options.parentPid)], {
      windowsHide: true, shell: false, maxBuffer: 128, encoding: "utf8", input: request + "\n",
      // Normal Windows UAC may wait for the user's response; do not kill it on
      // a short token-inspection timeout and leave a pending launch behind.
    }));
  } catch {
    // Keep helper diagnostics private and never retry a rejected UAC request.
  }
  if (restartOutput === "started") options.exit(0);
  if (restartOutput === "cancelled") {
    options.showError("已取消管理员启动", "你已取消 Windows 管理员授权，唠蒯云将退出。需要使用时可重新启动并选择管理员启动。");
    options.exit(0);
  }
  if (restartOutput === "busy") {
    options.showError("管理员启动正在进行", "另一个唠蒯云启动请求正在等待 Windows 管理员授权。请完成已有授权，此次启动将退出。");
    options.exit(0);
  }
  options.showError("唠蒯云无法重新启动", "管理员启动未完成。请退出后从完整绿色目录右键以管理员身份运行。");
  options.exit(1);
}

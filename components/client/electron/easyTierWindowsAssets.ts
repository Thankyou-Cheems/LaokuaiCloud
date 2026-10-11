import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { unzipSync } from "fflate";

import { EasyTierOperationError } from "./easyTierCommunityManager";
import { EASYTIER_WINDOWS_TARGET as target } from "./easyTierTarget";

/** Measured from the verified official archive, without executing its contents. */
export const EASYTIER_WINDOWS_FILES = Object.freeze({
  "easytier-core.exe": "6490c6f5b5b809065517bb3324ca34c0f1f367f81b7fda04a6352391508b8ff8",
  "easytier-cli.exe": "3afdf2e4306c3f8d65408ddd230c7e4118ffdb5d550921022aed9966693c82ba",
  "Packet.dll": "c7c03a87eac7243ccbe331554624b18803010b740e311fc8cfddb573096eacac",
  "WinDivert64.sys": "8da085332782708d8767bcace5327a6ec7283c17cfb85e40b03cd2323a90ddc2",
  "wintun.dll": "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce",
});
export const easyTierSha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export const EASYTIER_LAOKUAI_SOURCE_PATCH_SHA256 = "eb30fab089422c82256a8c8db9cb7a15d3c41b8b972a05729f63ebfbac7e8cad";
export const EASYTIER_LAOKUAI_PROFILE_SHA256 = "8904d6aff6c819a6d3bc03700467c7878199a68c57c9771905b7c90ec8c805d7";
/** Exact private no-Npcap build; official core/CLI remain reference only. */
export const EASYTIER_PRODUCT_FILES = Object.freeze({
  "easytier-core.exe": { sha256: "d4f100ace0ae50b5270af10f579a2ccf7b2991731f05b82920eefba60055d49a", bytes: 20107264 },
  "easytier-cli.exe": { sha256: "b84fa350b9c8036649df3cdc8ee728c364ea81075d82fd3783cdeede3b9ddccd", bytes: 6050816 },
  "WinDivert64.sys": { sha256: EASYTIER_WINDOWS_FILES["WinDivert64.sys"], bytes: 94144 },
  "wintun.dll": { sha256: EASYTIER_WINDOWS_FILES["wintun.dll"], bytes: 427552 },
});

export function verifiedEasyTierProductManifest(value: unknown): { coreSha256: string; cliSha256: string; cacheIdentity: string } {
  const manifest = value as Record<string, unknown>;
  if (!manifest || manifest.schemaVersion !== 2 || manifest.version !== "2.7.0-laokuai"
    || manifest.upstreamCommit !== "8b7f1f0196edb5b580829ed5f135050fb5853478"
    || manifest.ownedStopProtocol !== 1 || manifest.hostPolicy !== "externally-managed"
    || manifest.sourcePatchSha256 !== EASYTIER_LAOKUAI_SOURCE_PATCH_SHA256
    || manifest.sourceCommit !== "dbaf04531024f4201e73ec0bc5ba6a7a6d8d3b49"
    || manifest.sourceTree !== "e58f64a219c204cdaf364fc95466cf03acfb7c21"
    || manifest.cargoLockSha256 !== "e3ee41507e7a8ef94470b70f4639140e67aadae646ada82dfd23b0beeb0e7fb2"
    || manifest.buildProfile !== "windows-default-minus-faketcp-v1" || manifest.buildProfileSha256 !== EASYTIER_LAOKUAI_PROFILE_SHA256
    || manifest.noDefaultFeatures !== true || manifest.target !== "x86_64-pc-windows-msvc" || manifest.toolchain !== "1.95.0"
    || manifest.normalAndDelayImportsVerified !== true
    || manifest.coreSha256 !== EASYTIER_PRODUCT_FILES["easytier-core.exe"].sha256
    || manifest.cliSha256 !== EASYTIER_PRODUCT_FILES["easytier-cli.exe"].sha256) {
    throw new EasyTierOperationError("runtime-required");
  }
  const files = manifest.files as Record<string, { sha256?: unknown; bytes?: unknown }> | undefined;
  if (!files || JSON.stringify(Object.keys(files).sort()) !== JSON.stringify(Object.keys(EASYTIER_PRODUCT_FILES).sort()) ||
    Object.entries(EASYTIER_PRODUCT_FILES).some(([name, expected]) => files[name]?.sha256 !== expected.sha256 || files[name]?.bytes !== expected.bytes)) {
    throw new EasyTierOperationError("runtime-required");
  }
  // Both executables/profile enter cache identity; never reuse the old official CLI.
  const cacheIdentity = easyTierSha256(Buffer.from(JSON.stringify([manifest.sourceCommit, manifest.buildProfileSha256, EASYTIER_PRODUCT_FILES])));
  return { coreSha256: manifest.coreSha256, cliSha256: manifest.cliSha256, cacheIdentity };
}

export function verifiedEasyTierArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.byteLength !== target.assetBytes || easyTierSha256(bytes) !== target.archiveSha256) throw new EasyTierOperationError("unsupported-target");
  // Extract only fixed filenames, never the official management console or ZIP paths.
  const files = unzipSync(bytes, { filter: file => file.originalSize <= 32 * 1024 * 1024
    && Object.keys(EASYTIER_WINDOWS_FILES).some(name => file.name === `easytier-windows-x86_64/${name}`) });
  const result: Record<string, Uint8Array> = {};
  for (const [name, hash] of Object.entries(EASYTIER_WINDOWS_FILES)) {
    const value = files[`easytier-windows-x86_64/${name}`];
    if (!value || easyTierSha256(value) !== hash) throw new EasyTierOperationError("unsupported-target");
    result[name] = value;
  }
  return result;
}

/** Static asset preparation. No process launch, driver load, service or profile access. */
export class EasyTierWindowsAssets {
  private preparing: Promise<string> | null = null;
  private productPreparing: Promise<string> | null = null;
  constructor(private root: () => string, private bundledDirectory: () => string) {}
  directory(): string { return join(this.root(), "runtime", target.archiveSha256); }
  /** Release-owned manifest + downstream binary only; official downloads cannot activate TUN. */
  prepareProductBundled(): Promise<string> {
    if (!this.productPreparing) this.productPreparing = this.installProduct().finally(() => { this.productPreparing = null; });
    return this.productPreparing;
  }
  private async installProduct(): Promise<string> {
    try {
      const manifestFile = join(this.bundledDirectory(), "laokuai-build.json");
      if ((await stat(manifestFile)).size > 4096) throw new Error("manifest-size");
      const manifest = verifiedEasyTierProductManifest(JSON.parse(await readFile(manifestFile, "utf8")));
      const directory = join(this.root(), "runtime", "2.7.0-laokuai", manifest.cacheIdentity);
      const hashes = Object.fromEntries(Object.entries(EASYTIER_PRODUCT_FILES).map(([name, value]) => [name, value.sha256]));
      const contents: Record<string, Uint8Array> = {};
      for (const [name, hash] of Object.entries(hashes)) {
        const file = join(this.bundledDirectory(), name);
        if ((await stat(file)).size > 32 * 1024 * 1024) throw new Error("asset-size");
        const bytes = await readFile(file);
        if (easyTierSha256(bytes) !== hash) throw new Error("asset-hash");
        contents[name] = bytes;
      }
      await mkdir(directory, { recursive: true });
      for (const [name, bytes] of Object.entries(contents)) {
        const file = join(directory, name);
        // Never accept a cache-local manifest or silently replace it with official core.
        try {
          if ((await stat(file)).size <= 32 * 1024 * 1024
            && easyTierSha256(await readFile(file)) === hashes[name as keyof typeof hashes]) continue;
        } catch { /* Controlled cache only. */ }
        const temporary = `${file}.partial`;
        await writeFile(temporary, bytes, { mode: 0o600 }); await rename(temporary, file);
      }
      for (const [name, hash] of Object.entries(hashes)) {
        if (easyTierSha256(await readFile(join(directory, name))) !== hash) throw new Error("cache-hash");
      }
      return directory;
    } catch { throw new EasyTierOperationError("runtime-required"); }
  }
  async verifyInstalled(): Promise<string> {
    const directory = this.directory();
    try {
      for (const [name, hash] of Object.entries(EASYTIER_WINDOWS_FILES)) {
        if ((await stat(join(directory, name))).size > 32 * 1024 * 1024) throw new Error("asset-size");
        if (easyTierSha256(await readFile(join(directory, name))) !== hash) throw new Error("asset-hash");
      }
      return directory;
    } catch { throw new EasyTierOperationError("runtime-required"); }
  }
  prepare(): Promise<string> {
    if (!this.preparing) this.preparing = this.install(true).finally(() => { this.preparing = null; });
    return this.preparing;
  }
  prepareBundled(): Promise<string> {
    if (!this.preparing) this.preparing = this.install(false).finally(() => { this.preparing = null; });
    return this.preparing;
  }
  private async install(download: boolean): Promise<string> {
    try { return await this.verifyInstalled(); } catch { /* A verified package or explicit download repairs the cache. */ }
    let contents: Record<string, Uint8Array> = {};
    try {
      for (const [name, hash] of Object.entries(EASYTIER_WINDOWS_FILES)) {
        const file = join(this.bundledDirectory(), name);
        if ((await stat(file)).size > 32 * 1024 * 1024) throw new EasyTierOperationError("unsupported-target");
        const bytes = await readFile(file);
        if (easyTierSha256(bytes) !== hash) throw new EasyTierOperationError("unsupported-target");
        contents[name] = bytes;
      }
    }
    catch {
      if (!download) throw new EasyTierOperationError("runtime-required");
      // Explicit user request only. Bound both time and bytes; no floating release lookup.
      const response = await fetch(target.assetUrl, { signal: AbortSignal.timeout(90_000), credentials: "omit" });
      const url = new URL(response.url);
      if (!response.ok || url.protocol !== "https:" || !["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname)) throw new EasyTierOperationError("runtime-required");
      const reader = response.body?.getReader();
      if (!reader) throw new EasyTierOperationError("runtime-required");
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > target.assetBytes) throw new EasyTierOperationError("unsupported-target");
          chunks.push(part.value);
        }
      } finally { await reader.cancel(); }
      contents = verifiedEasyTierArchive(Buffer.concat(chunks));
    }
    const directory = this.directory();
    await mkdir(directory, { recursive: true });
    for (const [name, value] of Object.entries(contents)) {
      // Concurrent installs share one promise. Only controlled cache paths are written.
      const temporary = join(directory, `${name}.partial`);
      await writeFile(temporary, value, { mode: 0o600 });
      await rename(temporary, join(directory, name));
    }
    return this.verifyInstalled();
  }
}

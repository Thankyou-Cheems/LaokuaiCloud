/* eslint-env node */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const at = process.argv.indexOf("--out-dir");
if (at < 0 || !process.argv[at + 1]) throw Error("--out-dir required");
const out = resolve(process.argv[at + 1]);
const allowed = resolve(root, "../../.local") + "/";
if (!out.replaceAll("\\", "/").toLowerCase().startsWith(allowed.replaceAll("\\", "/").toLowerCase())) throw Error("Fixture output must stay within project .local");
if (existsSync(join(out, "dist"))) throw Error("Fresh output directory required");
mkdirSync(join(out, "entry"), { recursive: true });
const entry = join(out, "entry/index.html");
const fixture = join(root, "scripts/fixtures/receive-correction-ui.tsx").replaceAll("\\", "/");
writeFileSync(entry, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TEST offline receive correction</title><div id="root"></div><script type="module" src="/${fixture}"></script></html>`);
await build({ configFile: false, root: join(out, "entry"), base: "./", publicDir: false,
  esbuild: { jsx: "automatic" }, plugins: [tailwindcss()],
  build: { outDir: join(out, "dist"), emptyOutDir: false, rollupOptions: { input: entry } } });
console.log(JSON.stringify({ out, actualBrowserRun: false, scope: "Production component/CSS with synthetic telemetry; no product bootstrap" }));

/* eslint-env node */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const at = process.argv.indexOf("--out-dir");
if (at < 0 || !process.argv[at + 1]) throw Error("--out-dir required");
const out = resolve(process.argv[at + 1]);
const allowed = resolve(root, "../../.local") + "/";
if (!out.replaceAll("\\", "/").toLowerCase().startsWith(allowed.replaceAll("\\", "/").toLowerCase())) throw Error("Fixture output must stay within the project .local directory");
if (existsSync(join(out, "dist"))) throw Error("Fresh output dist required; preserve the previous fixture");
mkdirSync(join(out, "entry"), { recursive: true });
const entry = join(out, "entry/index.html");
const fixture = join(root, "scripts/fixtures/kirilie-ui.tsx").replaceAll("\\", "/");
writeFileSync(entry, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TEST offline Kirilie UI fixture</title><style>html,body,#root{margin:0;width:100%;height:100%;min-height:0;overflow:hidden}.fixture-channels{width:210px}.fixture-app{min-width:0}.fixture-body{overflow:hidden}@media(max-width:700px){.fixture-channels{display:none}.fixture-body>nav:first-child{display:none}.fixture-body{padding:8px}.fixture-body main{padding:12px}.fixture-app header{flex-wrap:wrap;font-size:12px}}@media(max-width:380px){.fixture-app header span{display:none}}</style><div id="root"></div><script type="module" src="/${fixture}"></script></html>`);
await build({ configFile: false, root: join(out, "entry"), base: "./", publicDir: false,
  esbuild: { jsx: "automatic" },
  plugins: [tailwindcss()], build: { outDir: join(out, "dist"), emptyOutDir: false,
    rollupOptions: { input: entry } } });
const inputs = ["src/lib/kirilieTheme.ts", "src/styles/kirilie.css", "src/style.css", "src/assets/kirilie-garden.svg",
  "src/packages/common/src/hooks/useTheme.ts", "src/packages/settings/src/components/theme/themeStylePicker.tsx", "scripts/fixtures/kirilie-ui.tsx"];
writeFileSync(join(out, "BUILD-RECEIPT.json"), JSON.stringify({ actualBrowserRun: false,
  scope: "Actual production CSS/tokens, theme hook and style picker, real @gryt/ui dialogs, portal menus, fields, select, switch and tooltip. Synthetic room, channels and member rows. No product bootstrap/account/network/native/media.",
  entry: join(out, "dist/index.html"),
  sourceInputHashes: Object.fromEntries(inputs.map(file => [file, createHash("sha256").update(readFileSync(join(root, file))).digest("hex")])) }, null, 2) + "\n");
console.log(JSON.stringify({ out, actualBrowserRun: false }));

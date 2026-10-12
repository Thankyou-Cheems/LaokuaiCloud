/* eslint-env node */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pngToIco from "png-to-ico";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const prior = JSON.parse(fs.readFileSync(path.join(root, "private-brand/ICON-SOURCE.json"), "utf8"));
const source = process.argv[2] || path.join(root, "private-brand", prior.sourceName);
const output = path.join(root, "private-brand");
fs.mkdirSync(output, { recursive: true });
const bytes = fs.readFileSync(source);
const digest = createHash("sha256").update(bytes).digest("hex");
if (prior.approvedSource && digest !== prior.sourceSha256) throw new Error("Approved brand source changed; review provenance before converting");
const saved = path.join(output, path.basename(source));
if (path.resolve(source) !== saved) fs.writeFileSync(saved, bytes);
const files = [];
for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
  const file = path.join(output, `icon-${size}.png`);
  await sharp(bytes).resize(size, size, { fit: "contain", background: "#00000000" }).png().toFile(file);
  files.push(file);
}
fs.writeFileSync(path.join(output, "icon.ico"), await pngToIco(files.filter(f => /-(16|32|48|256)\.png$/.test(f))));
fs.copyFileSync(path.join(output, "icon-512.png"), path.join(output, "icon.png"));
fs.copyFileSync(path.join(output, "icon-256.png"), path.join(root, "public/laokuai-icon.png"));
const metadata = await sharp(bytes).metadata();
fs.writeFileSync(path.join(output, "ICON-SOURCE.json"), JSON.stringify({
  ...prior,
  sourceName: path.basename(source), sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  width: metadata.width, height: metadata.height, hasAlpha: metadata.hasAlpha,
  conversion: "sharp contain resize only; alpha preserved; ICO sizes 16, 32, 48, 256",
  distribution: "Private self-use asset. Do not upload to upstream i18n PR.",
}, null, 2) + "\n");

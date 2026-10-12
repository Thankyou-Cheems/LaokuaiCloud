/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("node:fs");
const path = require("node:path");

function writeNotices(root) {
  const entries = [];
  const visited = new Set();
  const visit = (nm) => {
    if (!fs.existsSync(nm)) return;
    const resolved = fs.realpathSync(nm);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    for (const item of fs.readdirSync(nm, { withFileTypes: true })) {
      if (item.name.startsWith(".") || (!item.isDirectory() && !item.isSymbolicLink())) continue;
      const folder = path.join(nm, item.name);
      if (!fs.statSync(folder).isDirectory()) continue;
      const packages = item.name.startsWith("@") ? fs.readdirSync(folder).map((name) => path.join(folder, name)) : [folder];
      for (const pkg of packages) {
        const metadataPath = path.join(pkg, "package.json");
        if (!fs.existsSync(metadataPath)) continue;
        const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        for (const dir of [pkg, path.join(pkg, "libuiohook")]) {
          if (!fs.existsSync(dir)) continue;
          for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!file.isFile() || !/^(licen[sc]e|copying|notice)/i.test(file.name)) continue;
            entries.push(`\n=== ${metadata.name}@${metadata.version}: ${path.relative(pkg, path.join(dir, file.name)).replaceAll("\\", "/")} ===\n${fs.readFileSync(path.join(dir, file.name), "utf8")}\n`);
          }
        }
        visit(path.join(pkg, "node_modules"));
      }
    }
  };
  visit(path.join(root, "node_modules"));
  const out = path.join(root, "build/legal/THIRD-PARTY-NOTICES.txt");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, "Original installed dependency license texts for this exact build. Electron and Chromium notices accompany the runtime separately.\n" + entries.sort().join(""));
  return out;
}
module.exports = { writeNotices };

// Copies static extension assets (manifest, HTML, CSS, icons) into
// dist/extension after tsup has bundled the TypeScript entry points, and
// renames tsup's `*.global.js`/`*.global.js.map` IIFE output (its naming
// convention for browser-global bundles) to the plain `*.js` names
// manifest.json and index.html expect.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "dist", "extension");

const assets = [
  ["extension/manifest.json", "manifest.json"],
  ["extension/sidepanel/index.html", "sidepanel/index.html"],
  ["extension/sidepanel/styles.css", "sidepanel/styles.css"],
  ["extension/icons", "icons"],
];

mkdirSync(outDir, { recursive: true });

for (const [src, dest] of assets) {
  const srcPath = join(root, src);
  const destPath = join(outDir, dest);
  if (!existsSync(srcPath)) {
    console.warn(`[copy-extension-assets] skipping missing asset: ${src}`);
    continue;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  cpSync(srcPath, destPath, { recursive: true });
}

function stripGlobalSuffix(dir) {
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    if (statSync(entryPath).isDirectory()) {
      stripGlobalSuffix(entryPath);
      continue;
    }
    if (!entry.includes(".global.js")) continue;
    const renamed = entry.replace(".global.js", ".js");
    const renamedPath = join(dir, renamed);
    if (entry.endsWith(".js")) {
      const contents = readFileSync(entryPath, "utf8").replace(
        /sourceMappingURL=.*\.global\.js\.map/,
        `sourceMappingURL=${renamed}.map`,
      );
      writeFileSync(entryPath, contents);
    }
    renameSync(entryPath, renamedPath);
  }
}

stripGlobalSuffix(outDir);

console.log("[copy-extension-assets] done");

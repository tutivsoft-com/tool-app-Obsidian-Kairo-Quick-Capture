import { readFile, access } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const version = (await readFile(new URL("VERSION", root), "utf8")).trim();
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const rootManifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
for (const [label, value] of [["package.json", packageJson.version], ["manifest.json", rootManifest.version]]) {
  if (value !== version) throw new Error(`${label} has ${value}; expected ${version}`);
}
if (rootManifest.id.includes("obsidian")) throw new Error("Invalid plugin id");
for (const artifact of ["main.js", "manifest.json", "styles.css"]) await access(new URL(artifact, root));
console.log(`Release metadata synchronized at ${version}.`);

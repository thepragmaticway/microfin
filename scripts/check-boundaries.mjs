import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory()
          ? files(path.join(dir, e.name))
          : path.join(dir, e.name),
      ),
    )
  ).flat();
}
const errors = [];
for (const file of await files("src")) {
  if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
  const source = await readFile(file, "utf8");
  const normalized = file.replaceAll("\\", "/");
  const imports = [
    ...source.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)/g),
  ].map((m) => m[1]);
  for (const imp of imports) {
    if (
      (normalized.startsWith("src/components/") ||
        (normalized.startsWith("src/app/") && !normalized.includes("/api/"))) &&
      /server\/dal|server\/auth/.test(imp)
    )
      errors.push(`${file}: UI cannot import DAL/auth`);
    if (
      normalized.includes("/services/") &&
      /components|browser|next\/navigation/.test(imp)
    )
      errors.push(`${file}: service imports browser layer`);
    if (normalized.includes("/api/") && /server\/dal/.test(imp))
      errors.push(`${file}: API must use services`);
    if (source.includes('"use client"') && /server\//.test(imp))
      errors.push(`${file}: client imports server layer`);
  }
}
if (errors.length) throw new Error(errors.join("\n"));
console.log("Layer boundaries passed");

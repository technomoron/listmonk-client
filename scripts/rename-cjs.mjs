import { readdir, rename, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cjsDir = join(__dirname, "..", "dist", "cjs");

async function renameJsToCjs() {
  const files = await readdir(cjsDir);
  const targets = files.filter((file) => file.endsWith(".js"));

  await Promise.all(
    targets.map(async (file) => {
      const src = join(cjsDir, file);
      const dest = join(cjsDir, file.replace(/\.js$/, ".cjs"));
      await rename(src, dest);
    }),
  );
  return targets;
}

async function rewriteInternalImports() {
  const files = (await readdir(cjsDir)).filter((file) => file.endsWith(".cjs"));
  await Promise.all(
    files.map(async (file) => {
      const full = join(cjsDir, file);
      const content = await readFile(full, "utf8");
      const rewritten = content.replace(/\.\/([\w-]+)\.js/g, "./$1.cjs");
      if (rewritten !== content) {
        await writeFile(full, rewritten, "utf8");
      }
    }),
  );
}

renameJsToCjs()
  .then((targets) => {
    if (targets.length === 0) {
      console.warn("rename-cjs: no .js files found to rename.");
    }
    return rewriteInternalImports();
  })
  .catch((err) => {
    console.error("Failed to rename cjs files:", err);
    process.exit(1);
  });

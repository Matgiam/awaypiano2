/**
 * Copies the spessasynth AudioWorklet processor into `public/worklets/`.
 *
 * `AudioWorkletGlobalScope` has no module resolution — `audioWorklet.addModule()`
 * takes a URL and fetches it over HTTP. The processor therefore cannot be
 * imported through the bundler like normal code; it has to exist as a static
 * asset. Copying it on `predev`/`prebuild` (rather than committing it) means the
 * served file can never drift out of sync with the installed package version.
 *
 * Run with: `npm run worklet:sync`
 */

import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));

const SOURCE = join(
  PROJECT_ROOT,
  "node_modules",
  "spessasynth_lib",
  "dist",
  "spessasynth_processor.min.js",
);
const DESTINATION = join(
  PROJECT_ROOT,
  "public",
  "worklets",
  "spessasynth_processor.min.js",
);
// A sidecar file recording which package version produced the copy, so a stale
// asset is obvious rather than silently wrong.
const STAMP = join(PROJECT_ROOT, "public", "worklets", "version.json");

async function main() {
  const pkg = JSON.parse(
    await readFile(
      join(PROJECT_ROOT, "node_modules", "spessasynth_lib", "package.json"),
      "utf8",
    ),
  );

  try {
    await stat(SOURCE);
  } catch {
    throw new Error(
      `Worklet processor not found at ${SOURCE}. Run \`npm install\` first.`,
    );
  }

  await mkdir(dirname(DESTINATION), { recursive: true });
  await copyFile(SOURCE, DESTINATION);
  await writeFile(
    STAMP,
    `${JSON.stringify({ package: "spessasynth_lib", version: pkg.version }, null, 2)}\n`,
    "utf8",
  );

  const { size } = await stat(DESTINATION);
  console.log(
    `Synced spessasynth_lib@${pkg.version} worklet -> public/worklets/ (${(size / 1024).toFixed(0)} KB)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

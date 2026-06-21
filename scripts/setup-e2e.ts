import fs from "node:fs/promises";
import path from "node:path";
import { ensureDataHome } from "../src/lib/init";

async function main() {
  const home = process.env.INKPRESS_HOME;
  if (!home) throw new Error("INKPRESS_HOME is required for E2E setup.");
  const resolved = path.resolve(home);
  if (!resolved.endsWith(`${path.sep}.e2e-data`)) {
    throw new Error("E2E setup may only reset the .e2e-data directory.");
  }
  await fs.rm(resolved, { recursive: true, force: true });
  await ensureDataHome();
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyStandaloneTree } from "../../scripts/standalone-copy";

const tempRoots: string[] = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "standalone-copy-"));
  tempRoots.push(root);
  const src = path.join(root, "src");
  const targetDir = path.join(src, "target");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "value.txt"), "ok");
  fs.symlinkSync(targetDir, path.join(src, "linked"), "dir");
  return { src, dest: path.join(root, "dest") };
}

describe("copyStandaloneTree", () => {
  it("materializes symlinks when platform is win32", () => {
    const { src, dest } = createFixture();
    const replaced = copyStandaloneTree(src, dest, "win32");
    expect(replaced).toBeGreaterThan(0);
    expect(fs.lstatSync(path.join(dest, "linked")).isSymbolicLink()).toBe(false);
    expect(fs.lstatSync(path.join(dest, "linked")).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(dest, "linked", "value.txt"), "utf8")).toBe("ok");
  });

  it("keeps default dereference behavior on non-Windows", () => {
    const { src, dest } = createFixture();
    const replaced = copyStandaloneTree(src, dest, "linux");
    expect(replaced).toBe(0);
    expect(fs.readFileSync(path.join(dest, "linked", "value.txt"), "utf8")).toBe("ok");
  });
});

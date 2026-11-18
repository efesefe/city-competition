import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, afterEach } from "node:test";
import { loadEnv } from "./loadEnv.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe("loadEnv", () => {
  it("loads KEY=value from .env without overriding existing env", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-loadenv-"));
    dirs.push(dir);
    const file = join(dir, ".env");
    writeFileSync(
      file,
      [
        "# comment",
        "CC_LOADENV_A=from-file",
        "CC_LOADENV_B='quoted'",
        "CC_LOADENV_C=\"double\"",
        "not a line",
        "",
      ].join("\n"),
      "utf8",
    );

    process.env.CC_LOADENV_A = "already-set";
    delete process.env.CC_LOADENV_B;
    delete process.env.CC_LOADENV_C;

    loadEnv(file);

    assert.equal(process.env.CC_LOADENV_A, "already-set");
    assert.equal(process.env.CC_LOADENV_B, "quoted");
    assert.equal(process.env.CC_LOADENV_C, "double");

    delete process.env.CC_LOADENV_A;
    delete process.env.CC_LOADENV_B;
    delete process.env.CC_LOADENV_C;
  });

  it("is a no-op when the file is missing", () => {
    loadEnv(join(tmpdir(), "cc-loadenv-missing-does-not-exist.env"));
  });
});

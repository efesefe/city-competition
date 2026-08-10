import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "..");
const SCAN_DIRS = ["app", "components"];

/** Turkish letters that indicate user-facing TR copy. */
const TR_LETTER = /[çğıöşüÇĞİÖŞÜ]/;

/**
 * Template literals that interpolate AND contain Turkish letters —
 * forbidden for UI copy (use ICU messages instead).
 */
const BAD_TEMPLATE =
  /`(?:[^`]*\$\{[^}]+\}[^`]*[çğıöşüÇĞİÖŞÜ]|[^`]*[çğıöşüÇĞİÖŞÜ][^`]*\$\{[^}]+\})[^`]*`/g;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("i18n static: no Turkish template-literal concatenation", () => {
  it("finds no interpolated Turkish UI templates in app/ and components/", () => {
    const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
    const violations: string[] = [];

    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      // Strip block comments to reduce false positives
      const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const matches = stripped.match(BAD_TEMPLATE);
      if (matches) {
        for (const m of matches) {
          if (!TR_LETTER.test(m)) continue;
          violations.push(`${path.relative(ROOT, file)}: ${m.slice(0, 80)}`);
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});

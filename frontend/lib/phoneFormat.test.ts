import { describe, expect, it } from "vitest";
import {
  extractTRNationalDigits,
  formatTRNationalPhone,
  nationalToE164TR,
} from "@/lib/phoneFormat";
import { toE164TR } from "@/lib/auth-api";

describe("phoneFormat TR national", () => {
  it("formats as the user types into 5xx xxx xx xx groups", () => {
    expect(formatTRNationalPhone("5")).toBe("5");
    expect(formatTRNationalPhone("532")).toBe("532");
    expect(formatTRNationalPhone("5321")).toBe("532 1");
    expect(formatTRNationalPhone("532123")).toBe("532 123");
    expect(formatTRNationalPhone("5321234")).toBe("532 123 4");
    expect(formatTRNationalPhone("5321234567")).toBe("532 123 45 67");
  });

  it("strips pasted country code and leading zero", () => {
    expect(extractTRNationalDigits("+905321234567")).toBe("5321234567");
    expect(extractTRNationalDigits("905321234567")).toBe("5321234567");
    expect(extractTRNationalDigits("0532 123 45 67")).toBe("5321234567");
    expect(formatTRNationalPhone("05321234567")).toBe("532 123 45 67");
  });

  it("caps at 10 national digits", () => {
    expect(formatTRNationalPhone("53212345678999")).toBe("532 123 45 67");
  });

  it("builds E.164 and round-trips with toE164TR", () => {
    expect(nationalToE164TR("532 123 45 67")).toBe("+905321234567");
    expect(toE164TR("532 123 45 67")).toBe("+905321234567");
    expect(toE164TR("05321234567")).toBe("+905321234567");
    expect(toE164TR("532")).toBeNull();
  });
});

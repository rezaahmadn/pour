import { describe, it, expect } from "vitest";
import { hmacHex, randomDigits, randomHex } from "../src/crypto";
import { formatNumber, normalizeHandle, normalizeNumber } from "../src/account";

describe("crypto", () => {
  it("randomDigits returns only digits of the requested length", () => {
    for (let i = 0; i < 20; i++) {
      expect(randomDigits(16)).toMatch(/^\d{16}$/);
    }
  });

  it("randomHex returns 2 hex chars per byte", () => {
    expect(randomHex(32)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hmacHex is deterministic and 64 hex chars", async () => {
    const a = await hmacHex("pepper", "1234567890123456");
    const b = await hmacHex("pepper", "1234567890123456");
    const c = await hmacHex("other", "1234567890123456");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("account", () => {
  it("normalizeNumber strips separators and requires 16 digits", () => {
    expect(normalizeNumber("1234 5678-9012 3456")).toBe("1234567890123456");
    expect(normalizeNumber("123456789012345")).toBeNull();
    expect(normalizeNumber("12345678901234567")).toBeNull();
    expect(normalizeNumber("")).toBeNull();
  });

  it("formatNumber groups by four", () => {
    expect(formatNumber("1234567890123456")).toBe("1234 5678 9012 3456");
  });

  it("normalizeHandle lowercases, trims, and rejects bad or reserved handles", () => {
    expect(normalizeHandle("  Reza_1 ")).toBe("reza_1");
    expect(normalizeHandle("ab")).toBeNull();
    expect(normalizeHandle("a".repeat(21))).toBeNull();
    expect(normalizeHandle("has space")).toBeNull();
    expect(normalizeHandle("héllo")).toBeNull();
    expect(normalizeHandle("admin")).toBeNull();
    expect(normalizeHandle("Login")).toBeNull();
  });
});

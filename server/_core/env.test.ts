import { describe, expect, it, vi } from "vitest";

describe("ENV", () => {
  it("throws when JWT_SECRET is missing", async () => {
    const prev = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/JWT_SECRET/i);
    if (prev !== undefined) process.env.JWT_SECRET = prev;
  });

  it("loads when JWT_SECRET is present", async () => {
    const prev = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-jwt-secret";
    vi.resetModules();
    const mod = await import("./env");
    expect(mod.ENV.cookieSecret).toBe("test-jwt-secret");
    if (prev === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prev;
  });
});


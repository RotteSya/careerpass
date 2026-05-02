import { describe, expect, it } from "vitest";

describe("vite manus debug collector", () => {
  it("is serve-only so it cannot run in production build output", async () => {
    const mod = await import("../vite.config");
    const config = mod.default;
    const plugins = Array.isArray(config.plugins)
      ? config.plugins
      : config.plugins
        ? [config.plugins]
        : [];

    const collector = plugins.find((p: any) => p?.name === "manus-debug-collector") as any;
    expect(collector).toBeTruthy();
    expect(collector.apply).toBe("serve");
  });
});


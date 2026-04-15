import { describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "./rateLimit";

describe("createRateLimiter", () => {
  it("blocks after exceeding max within window", () => {
    vi.useFakeTimers();
    try {
      const limiter = createRateLimiter({ windowMs: 1000, max: 2 });
      expect(limiter.consume("k")).toBe(true);
      expect(limiter.consume("k")).toBe(true);
      expect(limiter.consume("k")).toBe(false);
      vi.advanceTimersByTime(1001);
      expect(limiter.consume("k")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});


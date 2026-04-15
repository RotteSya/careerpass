import { describe, expect, it, vi } from "vitest";
import { createRateLimitMiddleware } from "./rateLimitMiddleware";
import { createRateLimiter } from "./rateLimit";

function createRes() {
  return {
    statusCode: 200,
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

describe("createRateLimitMiddleware", () => {
  it("returns 429 when limit exceeded", () => {
    vi.useFakeTimers();
    try {
      const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
      const mw = createRateLimitMiddleware({
        limiter,
        key: (req) => String(req.headers["x-key"] ?? ""),
      });

      const req = { headers: { "x-key": "k1" } } as any;

      const res1 = createRes() as any;
      let next1 = false;
      mw(req, res1, () => {
        next1 = true;
      });
      expect(next1).toBe(true);
      expect(res1.statusCode).toBe(200);

      const res2 = createRes() as any;
      let next2 = false;
      mw(req, res2, () => {
        next2 = true;
      });
      expect(next2).toBe(false);
      expect(res2.statusCode).toBe(429);
      expect(res2.ended).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});


import { describe, expect, it } from "vitest";
import { createCsrfMiddleware } from "./csrfMiddleware";

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

describe("createCsrfMiddleware", () => {
  it("rejects mismatched origin for cookie-authenticated POST", () => {
    const mw = createCsrfMiddleware({ allowedOrigins: ["https://app.example.com"] });
    const req = {
      method: "POST",
      headers: {
        origin: "https://evil.com",
        cookie: "app_session_id=abc",
      },
    } as any;
    const res = createRes() as any;
    let nextCalled = false;
    mw(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.ended).toBe(true);
  });
});


import { describe, expect, it } from "vitest";
import { assertCsrf } from "./csrf";

describe("assertCsrf", () => {
  it("allows requests without session cookie", () => {
    expect(() =>
      assertCsrf(
        {
          method: "POST",
          headers: { origin: "https://evil.com" },
        },
        { allowedOrigins: ["https://app.example.com"] }
      )
    ).not.toThrow();
  });

  it("rejects cookie-authenticated request with mismatched origin", () => {
    expect(() =>
      assertCsrf(
        {
          method: "POST",
          headers: {
            origin: "https://evil.com",
            cookie: "app_session_id=abc",
          },
        },
        { allowedOrigins: ["https://app.example.com"] }
      )
    ).toThrow(/csrf/i);
  });

  it("allows cookie-authenticated request with matching origin", () => {
    expect(() =>
      assertCsrf(
        {
          method: "POST",
          headers: {
            origin: "https://app.example.com",
            cookie: "app_session_id=abc",
          },
        },
        { allowedOrigins: ["https://app.example.com"] }
      )
    ).not.toThrow();
  });
});


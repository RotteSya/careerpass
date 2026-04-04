import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { getSessionCookieOptions } from "./_core/cookies";

function createRequest(
  overrides?: Partial<Pick<Request, "protocol" | "headers">>
) {
  return {
    protocol: "http",
    headers: {},
    ...overrides,
  } as Request;
}

describe("getSessionCookieOptions", () => {
  it("uses lax cookies for non-HTTPS requests so browsers do not reject the session", () => {
    const options = getSessionCookieOptions(createRequest());

    expect(options).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
    });
  });

  it("uses secure none cookies for direct HTTPS requests", () => {
    const options = getSessionCookieOptions(
      createRequest({ protocol: "https" })
    );

    expect(options).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "none",
      secure: true,
    });
  });

  it("treats forwarded https requests as secure behind a proxy", () => {
    const options = getSessionCookieOptions(
      createRequest({
        headers: {
          "x-forwarded-proto": "https",
        },
      })
    );

    expect(options).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "none",
      secure: true,
    });
  });
});

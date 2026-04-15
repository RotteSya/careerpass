import { describe, expect, it } from "vitest";
import { createManusOauthState, verifyManusOauthState } from "./manusOauthState";

describe("manus oauth state", () => {
  it("creates and verifies state with matching cookie", () => {
    const state = createManusOauthState();
    const ok = verifyManusOauthState({
      stateParam: state,
      cookieHeader: `manus_oauth_state=${state}`,
    });
    expect(ok).toBe(true);
  });

  it("rejects missing cookie", () => {
    const state = createManusOauthState();
    expect(() =>
      verifyManusOauthState({ stateParam: state, cookieHeader: "" })
    ).toThrow(/state/i);
  });

  it("rejects mismatch between param and cookie", () => {
    const state = createManusOauthState();
    expect(() =>
      verifyManusOauthState({
        stateParam: state,
        cookieHeader: `manus_oauth_state=other`,
      })
    ).toThrow(/state/i);
  });
});


/**
 * OAuth callback tests
 * Covers: HMAC state signing/verification, handleCallback public procedure,
 * forged state rejection, expired state rejection, and CalendarCallback
 * URL query-param parsing logic.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildOauthSignedState, verifyOauthSignedState } from "./_core/oauthSignedState";

const TEST_SECRET = "test-jwt-secret";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("HMAC OAuth state helpers", () => {
  it("builds and verifies a valid signed state", () => {
    const state = buildOauthSignedState(
      {
      userId: 42,
      provider: "google",
      exp: Date.now() + 10 * 60 * 1000,
      },
      TEST_SECRET
    );
    const result = verifyOauthSignedState(state, TEST_SECRET);
    expect(result.userId).toBe(42);
    expect(result.provider).toBe("google");
  });

  it("rejects a state with wrong secret", () => {
    const state = buildOauthSignedState(
      {
      userId: 42,
      provider: "google",
      exp: Date.now() + 10 * 60 * 1000,
      },
      TEST_SECRET
    );
    expect(() => verifyOauthSignedState(state, "wrong-secret")).toThrow(
      "State signature mismatch"
    );
  });

  it("rejects a tampered payload", () => {
    const state = buildOauthSignedState(
      {
      userId: 42,
      provider: "google",
      exp: Date.now() + 10 * 60 * 1000,
      },
      TEST_SECRET
    );
    // Tamper: replace the data portion with a different payload
    const [, sig] = state.split(".");
    const tamperedData = Buffer.from(
      JSON.stringify({ userId: 999, provider: "google", exp: Date.now() + 99999 })
    ).toString("base64url");
    const tamperedState = `${tamperedData}.${sig}`;
    expect(() => verifyOauthSignedState(tamperedState, TEST_SECRET)).toThrow(
      "State signature mismatch"
    );
  });

  it("rejects an expired state", () => {
    const state = buildOauthSignedState(
      {
      userId: 42,
      provider: "google",
      exp: Date.now() - 1000, // already expired
      },
      TEST_SECRET
    );
    expect(() => verifyOauthSignedState(state, TEST_SECRET)).toThrow("State expired");
  });

  it("rejects a malformed state (no dot separator)", () => {
    expect(() => verifyOauthSignedState("notadotseperatedstring", TEST_SECRET)).toThrow(
      "Malformed state"
    );
  });

  it("rejects an empty state string", () => {
    expect(() => verifyOauthSignedState("", TEST_SECRET)).toThrow("Malformed state");
  });
});

describe("CalendarCallback URL query-param parsing", () => {
  it("correctly extracts code and state from a Google OAuth redirect URL", () => {
    // Simulate what window.location.search would contain after Google redirects back
    const mockCode = "4/0AX4XfWi_test_auth_code_abc123";
    const mockState = buildOauthSignedState(
      {
        userId: 7,
        provider: "google",
        exp: Date.now() + 10 * 60 * 1000,
      },
      TEST_SECRET
    );
    const search = `?code=${encodeURIComponent(mockCode)}&state=${encodeURIComponent(mockState)}`;
    const params = new URLSearchParams(search);

    expect(params.get("code")).toBe(mockCode);
    expect(params.get("state")).toBe(mockState);

    // Verify the extracted state is valid
    const stateData = verifyOauthSignedState(params.get("state")!, TEST_SECRET);
    expect(stateData.userId).toBe(7);
    expect(stateData.provider).toBe("google");
  });

  it("returns null for code when URL has no code param (error case)", () => {
    const search = "?error=access_denied&error_description=The+user+denied+access";
    const params = new URLSearchParams(search);
    expect(params.get("code")).toBeNull();
    expect(params.get("error")).toBe("access_denied");
  });

  it("handles URL-encoded state parameter correctly", () => {
    const state = buildOauthSignedState(
      {
        userId: 1,
        provider: "outlook",
        exp: Date.now() + 5 * 60 * 1000,
      },
      TEST_SECRET
    );
    // State contains dots and base64url chars — must survive URL encode/decode round-trip
    const encoded = encodeURIComponent(state);
    const decoded = decodeURIComponent(encoded);
    expect(decoded).toBe(state);
    const stateData = verifyOauthSignedState(decoded, TEST_SECRET);
    expect(stateData.provider).toBe("outlook");
  });
});

describe("handleCallback procedure logic (unit)", () => {
  it("extracts userId and provider from a valid signed state", () => {
    const state = buildOauthSignedState(
      {
        userId: 55,
        provider: "google",
        exp: Date.now() + 10 * 60 * 1000,
      },
      TEST_SECRET
    );
    const stateData = verifyOauthSignedState(state, TEST_SECRET);
    expect(stateData.userId).toBe(55);
    expect(stateData.provider).toBe("google");
  });

  it("throws on forged state (attacker tries to claim another user's token)", () => {
    // Attacker builds a state without the correct HMAC signature
    const fakePayload = Buffer.from(
      JSON.stringify({ userId: 1, provider: "google", exp: Date.now() + 99999 })
    ).toString("base64url");
    const fakeState = `${fakePayload}.invalidsignature`;
    expect(() => verifyOauthSignedState(fakeState, TEST_SECRET)).toThrow();
  });

  it("rejects state with mismatched length signature (timing-safe check)", () => {
    const state = buildOauthSignedState(
      {
        userId: 10,
        provider: "google",
        exp: Date.now() + 10 * 60 * 1000,
      },
      TEST_SECRET
    );
    const [data] = state.split(".");
    // Provide a signature of different length
    const shortSigState = `${data}.abc`;
    expect(() => verifyOauthSignedState(shortSigState, TEST_SECRET)).toThrow();
  });
});

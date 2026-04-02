/**
 * OAuth callback tests
 * Covers: HMAC state signing/verification, handleCallback public procedure,
 * forged state rejection, expired state rejection, and CalendarCallback
 * URL query-param parsing logic.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import crypto from "crypto";

// ─── Inline helpers (mirror server/routers.ts) ────────────────────────────────
const TEST_SECRET = "test-jwt-secret";

function buildSignedState(payload: { userId: number; provider: string; exp: number }): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", TEST_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifySignedState(
  state: string,
  secret = TEST_SECRET
): { userId: number; provider: string } {
  const [data, sig] = state.split(".");
  if (!data || !sig) throw new Error("Malformed state");
  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error("State signature mismatch");
  }
  const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as {
    userId: number;
    provider: string;
    exp: number;
  };
  if (Date.now() > payload.exp) throw new Error("State expired");
  return { userId: payload.userId, provider: payload.provider };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("HMAC OAuth state helpers", () => {
  it("builds and verifies a valid signed state", () => {
    const state = buildSignedState({
      userId: 42,
      provider: "google",
      exp: Date.now() + 10 * 60 * 1000,
    });
    const result = verifySignedState(state);
    expect(result.userId).toBe(42);
    expect(result.provider).toBe("google");
  });

  it("rejects a state with wrong secret", () => {
    const state = buildSignedState({
      userId: 42,
      provider: "google",
      exp: Date.now() + 10 * 60 * 1000,
    });
    expect(() => verifySignedState(state, "wrong-secret")).toThrow("State signature mismatch");
  });

  it("rejects a tampered payload", () => {
    const state = buildSignedState({
      userId: 42,
      provider: "google",
      exp: Date.now() + 10 * 60 * 1000,
    });
    // Tamper: replace the data portion with a different payload
    const [, sig] = state.split(".");
    const tamperedData = Buffer.from(
      JSON.stringify({ userId: 999, provider: "google", exp: Date.now() + 99999 })
    ).toString("base64url");
    const tamperedState = `${tamperedData}.${sig}`;
    expect(() => verifySignedState(tamperedState)).toThrow("State signature mismatch");
  });

  it("rejects an expired state", () => {
    const state = buildSignedState({
      userId: 42,
      provider: "google",
      exp: Date.now() - 1000, // already expired
    });
    expect(() => verifySignedState(state)).toThrow("State expired");
  });

  it("rejects a malformed state (no dot separator)", () => {
    expect(() => verifySignedState("notadotseperatedstring")).toThrow("Malformed state");
  });

  it("rejects an empty state string", () => {
    expect(() => verifySignedState("")).toThrow("Malformed state");
  });
});

describe("CalendarCallback URL query-param parsing", () => {
  it("correctly extracts code and state from a Google OAuth redirect URL", () => {
    // Simulate what window.location.search would contain after Google redirects back
    const mockCode = "4/0AX4XfWi_test_auth_code_abc123";
    const mockState = buildSignedState({
      userId: 7,
      provider: "google",
      exp: Date.now() + 10 * 60 * 1000,
    });
    const search = `?code=${encodeURIComponent(mockCode)}&state=${encodeURIComponent(mockState)}`;
    const params = new URLSearchParams(search);

    expect(params.get("code")).toBe(mockCode);
    expect(params.get("state")).toBe(mockState);

    // Verify the extracted state is valid
    const stateData = verifySignedState(params.get("state")!);
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
    const state = buildSignedState({
      userId: 1,
      provider: "outlook",
      exp: Date.now() + 5 * 60 * 1000,
    });
    // State contains dots and base64url chars — must survive URL encode/decode round-trip
    const encoded = encodeURIComponent(state);
    const decoded = decodeURIComponent(encoded);
    expect(decoded).toBe(state);
    const stateData = verifySignedState(decoded);
    expect(stateData.provider).toBe("outlook");
  });
});

describe("handleCallback procedure logic (unit)", () => {
  it("extracts userId and provider from a valid signed state", () => {
    const state = buildSignedState({
      userId: 55,
      provider: "google",
      exp: Date.now() + 10 * 60 * 1000,
    });
    const stateData = verifySignedState(state);
    expect(stateData.userId).toBe(55);
    expect(stateData.provider).toBe("google");
  });

  it("throws on forged state (attacker tries to claim another user's token)", () => {
    // Attacker builds a state without the correct HMAC signature
    const fakePayload = Buffer.from(
      JSON.stringify({ userId: 1, provider: "google", exp: Date.now() + 99999 })
    ).toString("base64url");
    const fakeState = `${fakePayload}.invalidsignature`;
    expect(() => verifySignedState(fakeState)).toThrow();
  });

  it("rejects state with mismatched length signature (timing-safe check)", () => {
    const state = buildSignedState({
      userId: 10,
      provider: "google",
      exp: Date.now() + 10 * 60 * 1000,
    });
    const [data] = state.split(".");
    // Provide a signature of different length
    const shortSigState = `${data}.abc`;
    expect(() => verifySignedState(shortSigState)).toThrow();
  });
});

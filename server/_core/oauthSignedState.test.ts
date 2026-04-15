import { describe, expect, it, vi } from "vitest";
import { buildOauthSignedState, verifyOauthSignedState } from "./oauthSignedState";

describe("oauth signed state", () => {
  it("verifies a valid state", () => {
    const secret = "test-secret";
    const state = buildOauthSignedState(
      { userId: 1, provider: "google", exp: Date.now() + 60_000 },
      secret
    );
    expect(verifyOauthSignedState(state, secret)).toEqual({
      userId: 1,
      provider: "google",
    });
  });

  it("rejects mismatched secret", () => {
    const state = buildOauthSignedState(
      { userId: 1, provider: "google", exp: Date.now() + 60_000 },
      "s1"
    );
    expect(() => verifyOauthSignedState(state, "s2")).toThrow(
      "State signature mismatch"
    );
  });

  it("rejects tampered data", () => {
    const secret = "test-secret";
    const state = buildOauthSignedState(
      { userId: 1, provider: "google", exp: Date.now() + 60_000 },
      secret
    );
    const dotIdx = state.lastIndexOf(".");
    const data = state.slice(0, dotIdx);
    const sig = state.slice(dotIdx + 1);
    const tampered = `${data}x.${sig}`;
    expect(() => verifyOauthSignedState(tampered, secret)).toThrow(
      "State signature mismatch"
    );
  });

  it("rejects expired state", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const secret = "test-secret";
      const state = buildOauthSignedState(
        { userId: 1, provider: "google", exp: Date.now() + 1_000 },
        secret
      );
      vi.advanceTimersByTime(1_001);
      expect(() => verifyOauthSignedState(state, secret)).toThrow("State expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects malformed state", () => {
    expect(() => verifyOauthSignedState("notadotseperatedstring", "s")).toThrow(
      "Malformed state"
    );
    expect(() => verifyOauthSignedState("", "s")).toThrow("Malformed state");
  });

  it("rejects signature length mismatch", () => {
    const secret = "test-secret";
    const state = buildOauthSignedState(
      { userId: 1, provider: "google", exp: Date.now() + 60_000 },
      secret
    );
    const dotIdx = state.lastIndexOf(".");
    const data = state.slice(0, dotIdx);
    const short = `${data}.a`;
    expect(() => verifyOauthSignedState(short, secret)).toThrow();
  });
});


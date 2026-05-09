import { afterEach, describe, expect, it } from "vitest";
import {
  isPrivateAllowedTelegramId,
  isPrivateAllowedUserId,
  isPrivateMode,
  privateModeSnapshot,
} from "./privateMode";

const KEYS = [
  "PRIVATE_MODE",
  "PRIVATE_ALLOWED_USER_IDS",
  "PRIVATE_ALLOWED_TELEGRAM_IDS",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

describe("privateMode", () => {
  let saved: Record<string, string | undefined>;
  afterEach(() => restoreEnv(saved));

  it("disabled by default — both allow checks return true (SaaS path)", () => {
    saved = snapshotEnv();
    delete process.env.PRIVATE_MODE;
    delete process.env.PRIVATE_ALLOWED_USER_IDS;
    delete process.env.PRIVATE_ALLOWED_TELEGRAM_IDS;
    expect(isPrivateMode()).toBe(false);
    expect(isPrivateAllowedUserId(99)).toBe(true);
    expect(isPrivateAllowedTelegramId("any")).toBe(true);
  });

  it("PRIVATE_MODE=true with empty lists denies by default", () => {
    saved = snapshotEnv();
    process.env.PRIVATE_MODE = "true";
    delete process.env.PRIVATE_ALLOWED_USER_IDS;
    delete process.env.PRIVATE_ALLOWED_TELEGRAM_IDS;
    expect(isPrivateMode()).toBe(true);
    expect(isPrivateAllowedUserId(42)).toBe(false);
    expect(isPrivateAllowedTelegramId(123)).toBe(false);
  });

  it("PRIVATE_MODE=true honors user-id allow-list", () => {
    saved = snapshotEnv();
    process.env.PRIVATE_MODE = "true";
    process.env.PRIVATE_ALLOWED_USER_IDS = "42, 7";
    expect(isPrivateAllowedUserId(42)).toBe(true);
    expect(isPrivateAllowedUserId(7)).toBe(true);
    expect(isPrivateAllowedUserId(99)).toBe(false);
  });

  it("PRIVATE_MODE=true honors telegram-id allow-list", () => {
    saved = snapshotEnv();
    process.env.PRIVATE_MODE = "true";
    process.env.PRIVATE_ALLOWED_TELEGRAM_IDS = "111111111,222222222";
    expect(isPrivateAllowedTelegramId(111111111)).toBe(true);
    expect(isPrivateAllowedTelegramId("222222222")).toBe(true);
    expect(isPrivateAllowedTelegramId(999)).toBe(false);
  });

  it("snapshot reports current state", () => {
    saved = snapshotEnv();
    process.env.PRIVATE_MODE = "true";
    process.env.PRIVATE_ALLOWED_USER_IDS = "1,2,3";
    process.env.PRIVATE_ALLOWED_TELEGRAM_IDS = "abc";
    const snap = privateModeSnapshot();
    expect(snap.enabled).toBe(true);
    expect(snap.allowedUserIds).toEqual(["1", "2", "3"]);
    expect(snap.allowedTelegramIds).toEqual(["abc"]);
  });
});

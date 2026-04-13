import { describe, expect, it } from "vitest";
import {
  __resetTelegramMailNoticeDedupForTests,
  buildTelegramMailNoticeDedupKey,
  shouldSendTelegramMailNoticeOnce,
} from "./gmail";

describe("gmail telegram notice dedupe", () => {
  it("allows first send and blocks duplicate within TTL", () => {
    __resetTelegramMailNoticeDedupForTests();
    const userId = 101;
    const messageId = "msg-abc";
    expect(shouldSendTelegramMailNoticeOnce({ userId, messageId, nowMs: 1_000 })).toBe(true);
    expect(shouldSendTelegramMailNoticeOnce({ userId, messageId, nowMs: 2_000 })).toBe(false);
  });

  it("expires dedupe after TTL", () => {
    __resetTelegramMailNoticeDedupForTests();
    const userId = 102;
    const messageId = "msg-expire";
    expect(shouldSendTelegramMailNoticeOnce({ userId, messageId, nowMs: 1_000 })).toBe(true);
    // TTL is 15min = 900000ms
    expect(shouldSendTelegramMailNoticeOnce({ userId, messageId, nowMs: 902_000 })).toBe(true);
  });

  it("dedupe key is stable by user+message", () => {
    expect(buildTelegramMailNoticeDedupKey({ userId: 1, messageId: "x" })).toBe("1:x");
  });
});

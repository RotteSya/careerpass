import { describe, expect, it } from "vitest";
import {
  __resetTelegramMailNoticeDedupForTests,
  buildTelegramMailNoticeDedupKey,
  jobStatusFromEmailDecision,
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

describe("gmail job status inference", () => {
  it("maps recruiting event types to the supported selection statuses", () => {
    expect(jobStatusFromEmailDecision({ eventType: "briefing" })).toBe("briefing");
    expect(jobStatusFromEmailDecision({ eventType: "deadline" })).toBe("es_preparing");
    expect(jobStatusFromEmailDecision({ eventType: "entry" })).toBe("document_screening");
    expect(jobStatusFromEmailDecision({ eventType: "test" })).toBe("written_test");
    expect(jobStatusFromEmailDecision({ eventType: "offer" })).toBe("offer");
    expect(jobStatusFromEmailDecision({ eventType: "rejection" })).toBe("rejected");
  });

  it("only uses interview rounds for interview events", () => {
    expect(jobStatusFromEmailDecision({ eventType: "interview", interviewRound: "1st" })).toBe("interview_1");
    expect(jobStatusFromEmailDecision({ eventType: "interview", interviewRound: "2nd" })).toBe("interview_2");
    expect(jobStatusFromEmailDecision({ eventType: "interview", interviewRound: "3rd" })).toBe("interview_3");
    expect(jobStatusFromEmailDecision({ eventType: "interview", interviewRound: "final" })).toBe("interview_final");
    expect(jobStatusFromEmailDecision({ eventType: "test", interviewRound: "1st" })).toBe("written_test");
  });

  it("maps hard outcomes to board enum values", () => {
    expect(jobStatusFromEmailDecision({ eventType: "other", hardOutcome: "offer" })).toBe("offer");
    expect(jobStatusFromEmailDecision({ eventType: "other", hardOutcome: "rejection" })).toBe("rejected");
  });
});

import { describe, expect, it } from "vitest";
import { timeNudgeRules } from "./timeNudges";
import type { UserJobContext } from "../types";

function makeContext(overrides: Partial<UserJobContext["applications"][number]> = {}): UserJobContext {
  const now = new Date("2026-04-24T00:00:00.000Z");
  return {
    userId: 1,
    preferredLanguage: "zh",
    now,
    applications: [
      {
        id: 101,
        companyNameJa: "株式会社テスト",
        status: "document_screening",
        updatedAt: new Date("2026-03-25T00:00:00.000Z"),
        nextActionAt: null,
        lastStatusEventAt: new Date("2026-03-25T00:00:00.000Z"),
        portalUrl: null,
        lastPortalCheckedAt: null,
        portalCheckIntervalDays: 7,
        portalStatusCheckEnabled: false,
        ...overrides,
      },
    ],
  };
}

function evaluateTimeNudges(context: UserJobContext) {
  return timeNudgeRules.flatMap((rule) => rule.evaluate(context));
}

describe("time nudge abandon suggestion", () => {
  it("suggests follow-up or withdrawal after 30 days without status progress", () => {
    const nudges = evaluateTimeNudges(makeContext());
    const abandon = nudges.find((n) => n.title === "有公司可能该整理了");

    expect(abandon).toBeTruthy();
    expect(abandon?.category).toBe("follow_up");
    expect(abandon?.body).toContain("标记为放弃");
  });

  it("keeps 14-day stale reminder before the 30-day abandon threshold", () => {
    const nudges = evaluateTimeNudges(
      makeContext({
        updatedAt: new Date("2026-03-26T00:00:00.000Z"),
        lastStatusEventAt: new Date("2026-03-26T00:00:00.000Z"),
      }),
    );

    expect(nudges.some((n) => n.title === "某公司选考停滞了？")).toBe(true);
    expect(nudges.some((n) => n.title === "有公司可能该整理了")).toBe(false);
  });

  it("does not suggest withdrawal for terminal statuses", () => {
    const nudges = evaluateTimeNudges(makeContext({ status: "rejected" }));

    expect(nudges.some((n) => n.title === "有公司可能该整理了")).toBe(false);
  });

  it("does not suggest withdrawal when a future next action is scheduled", () => {
    const nudges = evaluateTimeNudges(
      makeContext({ nextActionAt: new Date("2026-04-30T00:00:00.000Z") }),
    );

    expect(nudges.some((n) => n.title === "有公司可能该整理了")).toBe(false);
  });
});

describe("event reminder T-1", () => {
  function fromNow(hoursFromNow: number): Date {
    return new Date(
      Date.parse("2026-04-24T00:00:00.000Z") + hoursFromNow * 3600 * 1000,
    );
  }

  it("fires for an interview ~24 hours away", () => {
    const nudges = evaluateTimeNudges(
      makeContext({
        status: "interview_1",
        nextActionAt: fromNow(24),
        updatedAt: new Date("2026-04-23T00:00:00.000Z"),
        lastStatusEventAt: new Date("2026-04-23T00:00:00.000Z"),
      }),
    );
    const reminder = nudges.find((n) => n.title === "📌 明天有面试");
    expect(reminder).toBeTruthy();
    expect(reminder?.priority).toBe("high");
    expect(reminder?.category).toBe("deadline_warning");
  });

  it("fires for a briefing ~24 hours away with the briefing-specific copy", () => {
    const nudges = evaluateTimeNudges(
      makeContext({
        status: "briefing",
        nextActionAt: fromNow(24),
        updatedAt: new Date("2026-04-23T00:00:00.000Z"),
        lastStatusEventAt: new Date("2026-04-23T00:00:00.000Z"),
      }),
    );
    expect(nudges.some((n) => n.title === "📌 明天有说明会")).toBe(true);
    expect(nudges.some((n) => n.title === "📌 明天有面试")).toBe(false);
  });

  it("does not fire when the event is more than 36 hours away", () => {
    const nudges = evaluateTimeNudges(
      makeContext({
        status: "interview_1",
        nextActionAt: fromNow(48),
      }),
    );
    expect(nudges.some((n) => n.title === "📌 明天有面试")).toBe(false);
  });

  it("does not fire when the event is less than 12 hours away", () => {
    const nudges = evaluateTimeNudges(
      makeContext({
        status: "interview_1",
        nextActionAt: fromNow(6),
      }),
    );
    expect(nudges.some((n) => n.title === "📌 明天有面试")).toBe(false);
  });

  it("does not fire for non-event statuses even with nextActionAt set", () => {
    const nudges = evaluateTimeNudges(
      makeContext({
        status: "document_screening",
        nextActionAt: fromNow(24),
      }),
    );
    expect(nudges.some((n) => n.title === "📌 明天有面试")).toBe(false);
    expect(nudges.some((n) => n.title === "📌 明天有说明会")).toBe(false);
  });
});

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

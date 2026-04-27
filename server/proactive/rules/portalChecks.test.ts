import { describe, expect, it } from "vitest";
import type { UserJobContext } from "../types";
import { portalCheckRule } from "./portalChecks";

function makeContext(overrides: Partial<UserJobContext["applications"][number]> = {}): UserJobContext {
  return {
    userId: 1,
    preferredLanguage: "zh",
    now: new Date("2026-04-24T00:00:00.000Z"),
    applications: [
      {
        id: 101,
        companyNameJa: "株式会社テスト",
        status: "document_screening",
        updatedAt: new Date("2026-04-10T00:00:00.000Z"),
        nextActionAt: null,
        lastStatusEventAt: new Date("2026-04-10T00:00:00.000Z"),
        portalUrl: "https://example.com/mypage",
        lastPortalCheckedAt: new Date("2026-04-10T00:00:00.000Z"),
        portalCheckIntervalDays: 7,
        portalStatusCheckEnabled: true,
        ...overrides,
      },
    ],
  };
}

describe("portal check nudge", () => {
  it("reminds users to check an enabled recruiting portal after the interval", () => {
    const nudges = portalCheckRule.evaluate(makeContext());

    expect(nudges).toHaveLength(1);
    expect(nudges[0].title).toBe("该查一下招聘官网了");
    expect(nudges[0].category).toBe("follow_up");
  });

  it("does not remind for terminal applications", () => {
    const nudges = portalCheckRule.evaluate(makeContext({ status: "rejected" }));

    expect(nudges).toHaveLength(0);
  });

  it("does not remind when portal checks are disabled", () => {
    const nudges = portalCheckRule.evaluate(makeContext({ portalStatusCheckEnabled: false }));

    expect(nudges).toHaveLength(0);
  });
});

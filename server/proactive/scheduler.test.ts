import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDispatchNotification, deliveredStore } = vi.hoisted(() => ({
  mockDispatchNotification: vi.fn().mockResolvedValue(undefined),
  deliveredStore: new Map<string, Date>(),
}));

vi.mock("./deliveredNudges", () => ({
  getNudgeLastDeliveredAt: vi.fn(async (userId: number, key: string) =>
    deliveredStore.get(`${userId}:${key}`) ?? null
  ),
  recordNudgeDelivered: vi.fn(async (userId: number, key: string, at: Date) => {
    deliveredStore.set(`${userId}:${key}`, at);
  }),
}));

vi.mock("../db", () => ({
  getUserById: vi.fn().mockResolvedValue({
    id: 1,
    preferredLanguage: "zh",
    notificationSchedule: null,
    nudgeCategoriesEnabled: null,
  }),
  getActiveMessagingBinding: vi.fn().mockResolvedValue({
    provider: "telegram",
    externalId: "123",
  }),
  getJobApplications: vi.fn().mockResolvedValue([
    {
      id: 101,
      companyNameJa: "株式会社テスト",
      companyNameEn: null,
      status: "document_screening",
      updatedAt: new Date("2026-03-25T00:00:00.000Z"),
      nextActionAt: null,
    },
  ]),
  listLatestJobStatusEventTimes: vi.fn().mockResolvedValue(
    new Map([[101, new Date("2026-03-25T00:00:00.000Z")]])
  ),
}));

vi.mock("../_core/messaging", () => ({
  dispatchNotification: mockDispatchNotification,
}));

vi.mock("../billing", () => ({
  collectTrialNudges: vi.fn().mockResolvedValue([]),
  markTrialNudgeDelivered: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./humanize", () => ({
  humanizeNudgeBody: vi.fn().mockImplementation(async (nudge: { body: string }) => nudge.body),
}));

import { runProactiveCheckForUser } from "./scheduler";
import { dispatchNotification } from "../_core/messaging";

describe("runProactiveCheckForUser", () => {
  beforeEach(() => {
    vi.mocked(dispatchNotification).mockClear();
    deliveredStore.clear();
  });

  it("does not dispatch the same proactive nudge twice within the cooldown window", async () => {
    const first = await runProactiveCheckForUser(1);
    const second = await runProactiveCheckForUser(1);

    expect(first.length).toBeGreaterThan(0);
    expect(second).toHaveLength(0);
    expect(dispatchNotification).toHaveBeenCalledTimes(first.length);
  });
});

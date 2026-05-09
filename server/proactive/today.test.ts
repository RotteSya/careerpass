import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn().mockResolvedValue(null),
  getJobApplications: vi.fn(),
  getUserById: vi.fn(),
}));

vi.mock("../db", () => ({
  getDb: mocks.getDb,
  getJobApplications: mocks.getJobApplications,
  getUserById: mocks.getUserById,
}));

import { computeTodayTasks } from "./today";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("computeTodayTasks", () => {
  const NOW = new Date("2026-05-10T09:00:00Z");

  beforeEach(() => {
    mocks.getUserById.mockResolvedValue({ id: 1, preferredLanguage: "ja" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty when there are no applications and no events", async () => {
    mocks.getJobApplications.mockResolvedValueOnce([]);
    const tasks = await computeTodayTasks(1, { now: NOW });
    expect(tasks).toEqual([]);
  });

  it("ranks an imminent deadline (<24h) above a far one", async () => {
    mocks.getJobApplications.mockResolvedValueOnce([
      {
        id: 17,
        userId: 1,
        companyNameJa: "[example] A社",
        status: "es_preparing",
        priority: "medium",
        nextActionAt: new Date(NOW.getTime() + 12 * HOUR_MS),
        updatedAt: NOW,
      },
      {
        id: 18,
        userId: 1,
        companyNameJa: "[example] B社",
        status: "es_preparing",
        priority: "medium",
        nextActionAt: new Date(NOW.getTime() + 5 * DAY_MS),
        updatedAt: NOW,
      },
    ]);
    const tasks = await computeTodayTasks(1, { now: NOW });
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].jobApplicationId).toBe(17);
    expect(tasks[0].signals).toContain("nextActionAt<24h");
  });

  it("priority=high boosts score", async () => {
    mocks.getJobApplications.mockResolvedValueOnce([
      {
        id: 1,
        userId: 1,
        companyNameJa: "[example] Lo",
        status: "researching",
        priority: "low",
        nextActionAt: null,
        updatedAt: NOW,
      },
      {
        id: 2,
        userId: 1,
        companyNameJa: "[example] Hi",
        status: "researching",
        priority: "high",
        nextActionAt: null,
        updatedAt: NOW,
      },
    ]);
    const tasks = await computeTodayTasks(1, { now: NOW });
    expect(tasks[0].jobApplicationId).toBe(2);
    expect(tasks[0].signals).toContain("priority=high");
  });

  it("filters out terminal statuses", async () => {
    mocks.getJobApplications.mockResolvedValueOnce([
      {
        id: 10,
        userId: 1,
        companyNameJa: "[example] Done",
        status: "rejected",
        priority: "high",
        nextActionAt: new Date(NOW.getTime() + 3 * HOUR_MS),
        updatedAt: NOW,
      },
      {
        id: 11,
        userId: 1,
        companyNameJa: "[example] Active",
        status: "interview_1",
        priority: "medium",
        nextActionAt: null,
        updatedAt: NOW,
      },
    ]);
    const tasks = await computeTodayTasks(1, { now: NOW });
    expect(tasks.find(t => t.jobApplicationId === 10)).toBeUndefined();
    expect(tasks.find(t => t.jobApplicationId === 11)).toBeDefined();
  });

  it("flags stale waits (>=7d) on applied/screening statuses", async () => {
    mocks.getJobApplications.mockResolvedValueOnce([
      {
        id: 30,
        userId: 1,
        companyNameJa: "[example] Stale",
        status: "applied",
        priority: "medium",
        nextActionAt: null,
        updatedAt: new Date(NOW.getTime() - 10 * DAY_MS),
      },
    ]);
    const tasks = await computeTodayTasks(1, { now: NOW });
    expect(tasks[0]?.signals).toContain("waiting>=7d");
    expect(tasks[0]?.kind).toBe("stale_wait");
  });

  it("respects the limit", async () => {
    mocks.getJobApplications.mockResolvedValueOnce([
      {
        id: 1,
        userId: 1,
        companyNameJa: "A",
        status: "interview_1",
        priority: "high",
        nextActionAt: new Date(NOW.getTime() + 2 * HOUR_MS),
        updatedAt: NOW,
      },
      {
        id: 2,
        userId: 1,
        companyNameJa: "B",
        status: "es_preparing",
        priority: "high",
        nextActionAt: new Date(NOW.getTime() + 5 * HOUR_MS),
        updatedAt: NOW,
      },
      {
        id: 3,
        userId: 1,
        companyNameJa: "C",
        status: "interview_2",
        priority: "medium",
        nextActionAt: new Date(NOW.getTime() + 50 * HOUR_MS),
        updatedAt: NOW,
      },
      {
        id: 4,
        userId: 1,
        companyNameJa: "D",
        status: "researching",
        priority: "low",
        nextActionAt: null,
        updatedAt: NOW,
      },
    ]);
    const tasks = await computeTodayTasks(1, { now: NOW, limit: 2 });
    expect(tasks).toHaveLength(2);
  });
});

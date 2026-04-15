import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getBillingFeatureAccess: vi.fn(),
  getOauthToken: vi.fn(),
  getJobApplications: vi.fn(),
}));

const gmailMocks = vi.hoisted(() => ({
  monitorGmailAndSync: vi.fn(),
  registerGmailPushWatch: vi.fn(),
}));

vi.mock("./db", () => dbMocks);
vi.mock("./gmail", () => gmailMocks);

import { startMailMonitoringAndCheckmail } from "./mailMonitoring";

describe("startMailMonitoringAndCheckmail fullMailboxScan", () => {
  beforeEach(() => {
    dbMocks.getBillingFeatureAccess.mockReset();
    dbMocks.getOauthToken.mockReset();
    dbMocks.getJobApplications.mockReset();
    gmailMocks.monitorGmailAndSync.mockReset();
    gmailMocks.registerGmailPushWatch.mockReset();
  });

  it("forces full mailbox scan when manual mode and existing jobs are few", async () => {
    dbMocks.getBillingFeatureAccess.mockResolvedValue({
      phase: "trial",
      autoMonitoringEnabled: true,
      autoBoardWriteEnabled: true,
      autoWorkflowEnabled: true,
      dayFromTrialStart: 1,
      trackedCompanyCount: 0,
      trialEndsAt: new Date(),
      graceEndsAt: new Date(),
    });
    dbMocks.getOauthToken.mockResolvedValue({ accessToken: "x" });
    dbMocks.getJobApplications.mockResolvedValue([
      { id: 1, companyNameJa: "A" },
      { id: 2, companyNameJa: "B" },
      { id: 3, companyNameJa: "C" },
    ]);
    gmailMocks.monitorGmailAndSync.mockResolvedValue({
      scanned: 0,
      detected: 0,
      calendarEvents: 0,
      events: [],
    });

    await startMailMonitoringAndCheckmail({ userId: 1, mode: "manual" });

    const args = gmailMocks.monitorGmailAndSync.mock.calls[0];
    expect(args[0]).toBe(1);
    expect(args[1]).toBeUndefined();
    expect(args[2]?.fullMailboxScan).toBe(true);
  });

  it("keeps incremental scan when manual mode and existing jobs exceed threshold", async () => {
    dbMocks.getBillingFeatureAccess.mockResolvedValue({
      phase: "trial",
      autoMonitoringEnabled: true,
      autoBoardWriteEnabled: true,
      autoWorkflowEnabled: true,
      dayFromTrialStart: 1,
      trackedCompanyCount: 0,
      trialEndsAt: new Date(),
      graceEndsAt: new Date(),
    });
    dbMocks.getOauthToken.mockResolvedValue({ accessToken: "x" });
    dbMocks.getJobApplications.mockResolvedValue([
      { id: 1, companyNameJa: "A" },
      { id: 2, companyNameJa: "B" },
      { id: 3, companyNameJa: "C" },
      { id: 4, companyNameJa: "D" },
    ]);
    gmailMocks.monitorGmailAndSync.mockResolvedValue({
      scanned: 0,
      detected: 0,
      calendarEvents: 0,
      events: [],
    });

    await startMailMonitoringAndCheckmail({ userId: 1, mode: "manual" });

    const args = gmailMocks.monitorGmailAndSync.mock.calls[0];
    expect(args[2]?.fullMailboxScan).toBeUndefined();
  });
});


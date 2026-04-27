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

import {
  consumeBackgroundScanResult,
  isRealtimeTelegramSuppressed,
  startBackgroundMailScan,
} from "./mailMonitoring";

describe("startBackgroundMailScan", () => {
  beforeEach(() => {
    dbMocks.getBillingFeatureAccess.mockReset();
    dbMocks.getOauthToken.mockReset();
    dbMocks.getJobApplications.mockReset();
    gmailMocks.monitorGmailAndSync.mockReset();
    gmailMocks.registerGmailPushWatch.mockReset();
  });

  it("forces full mailbox scan when job applications are empty (first bootstrap)", async () => {
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
    dbMocks.getJobApplications.mockResolvedValue([]);
    gmailMocks.monitorGmailAndSync.mockResolvedValue({
      scanned: 0,
      detected: 0,
      calendarEvents: 0,
      events: [],
    });

    startBackgroundMailScan(1, { forceFullMailboxScan: true });
    await consumeBackgroundScanResult(1);

    const args = gmailMocks.monitorGmailAndSync.mock.calls[0];
    expect(args[0]).toBe(1);
    expect(args[1]).toBeUndefined();
    expect(args[2]?.fullMailboxScan).toBe(true);
    expect(args[2]?.suppressTelegramItemNotifications).toBe(true);
  });

  it("does not force full mailbox scan when forceFullMailboxScan is false/omitted", async () => {
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
    dbMocks.getJobApplications.mockResolvedValue([]);
    gmailMocks.monitorGmailAndSync.mockResolvedValue({
      scanned: 0,
      detected: 0,
      calendarEvents: 0,
      events: [],
    });

    startBackgroundMailScan(1);
    await consumeBackgroundScanResult(1);

    const args = gmailMocks.monitorGmailAndSync.mock.calls[0];
    expect(args[2]?.fullMailboxScan).toBeUndefined();
    expect(args[2]?.suppressTelegramItemNotifications).toBe(true);
  });

  it("suppresses immediate realtime Telegram bursts after registering a watch", async () => {
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
    gmailMocks.monitorGmailAndSync.mockResolvedValue({
      scanned: 0,
      detected: 0,
      calendarEvents: 0,
      events: [],
    });

    startBackgroundMailScan(777);

    expect(isRealtimeTelegramSuppressed(777)).toBe(true);
    await consumeBackgroundScanResult(777);
  });
});

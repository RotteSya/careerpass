import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  upsertOauthToken: vi.fn(),
  upsertOauthProviderAccount: vi.fn(),
}));

const gmailMocks = vi.hoisted(() => ({
  registerGmailPushWatch: vi.fn(),
}));

const mailMonitoringMocks = vi.hoisted(() => ({
  startBackgroundMailScan: vi.fn(),
}));

vi.mock("./db", () => dbMocks);
vi.mock("./gmail", () => gmailMocks);
vi.mock("./mailMonitoring", () => mailMonitoringMocks);

import { ENV } from "./_core/env";
import { buildOauthSignedState } from "./_core/oauthSignedState";
import { handleOutlookCalendarCallback } from "./calendarOAuth";

function createRes() {
  const res: any = {
    statusCode: 200,
    redirectTo: undefined as string | undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    redirect(url: string) {
      this.statusCode = 302;
      this.redirectTo = url;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

describe("Outlook calendar oauth callback (express)", () => {
  beforeEach(() => {
    dbMocks.upsertOauthToken.mockReset();
    dbMocks.upsertOauthProviderAccount.mockReset();
    gmailMocks.registerGmailPushWatch.mockReset();
    mailMonitoringMocks.startBackgroundMailScan.mockReset();
    vi.restoreAllMocks();
  });

  it("stores outlook token and redirects to dashboard success", async () => {
    const state = buildOauthSignedState(
      { userId: 7, provider: "outlook", exp: Date.now() + 60_000 },
      ENV.cookieSecret
    );

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "a1",
          refresh_token: "r1",
          expires_in: 3600,
          scope: "s1",
        }),
      } as any);

    const req: any = {
      query: { code: "c1", state },
    };
    const res = createRes();
    await handleOutlookCalendarCallback(req, res);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(dbMocks.upsertOauthToken).toHaveBeenCalledTimes(1);
    expect(dbMocks.upsertOauthToken.mock.calls[0][0]).toMatchObject({
      userId: 7,
      provider: "outlook",
      accessToken: "a1",
      refreshToken: "r1",
    });
    expect(res.statusCode).toBe(302);
    expect(res.redirectTo).toContain("/dashboard?calendar=success");
  });
});


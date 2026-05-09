import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findCalendarWatchByChannel: vi.fn(),
  syncCalendarIncremental: vi.fn(),
}));

vi.mock("./calendarWatch", () => ({
  findCalendarWatchByChannel: mocks.findCalendarWatchByChannel,
}));

vi.mock("./calendarIncremental", () => ({
  syncCalendarIncremental: mocks.syncCalendarIncremental,
}));

import { calendarPushRouter } from "./calendarPush";

const SHARED_TOKEN = "calendar-token-test-value";

interface RouteResult {
  status: number;
}

async function postPush(headers: Record<string, string>): Promise<RouteResult> {
  const stack = (calendarPushRouter as unknown as { stack: any[] }).stack;
  const layer = stack.find(item => item.route?.path === "/push");
  if (!layer) throw new Error("calendar /push route was not registered");

  const req = {
    method: "POST",
    url: "/push",
    body: {},
    headers,
    ip: "127.0.0.1",
  };

  return new Promise<RouteResult>((resolve, reject) => {
    let status = 200;
    const res = {
      status(code: number) {
        status = code;
        return res;
      },
      end() {
        resolve({ status });
      },
      json() {
        resolve({ status });
      },
    };
    try {
      layer.handle(req, res, (err: unknown) => {
        if (err) reject(err);
      });
    } catch (e) {
      reject(e);
    }
  });
}

describe("calendarPushRouter POST /push", () => {
  beforeEach(() => {
    process.env.CALENDAR_CHANNEL_TOKEN = SHARED_TOKEN;
    mocks.findCalendarWatchByChannel.mockReset();
    mocks.syncCalendarIncremental.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 503 when CALENDAR_CHANNEL_TOKEN is not configured", async () => {
    delete process.env.CALENDAR_CHANNEL_TOKEN;
    const r = await postPush({
      "x-goog-channel-id": "cp-cal-x",
      "x-goog-channel-token": "anything",
      "x-goog-resource-id": "abc",
      "x-goog-resource-state": "exists",
    });
    expect(r.status).toBe(503);
    expect(mocks.findCalendarWatchByChannel).not.toHaveBeenCalled();
  });

  it("returns 400 when required headers are missing", async () => {
    const r = await postPush({
      "x-goog-channel-token": SHARED_TOKEN,
    });
    expect(r.status).toBe(400);
  });

  it("returns 401 on channel-token mismatch", async () => {
    const r = await postPush({
      "x-goog-channel-id": "cp-cal-x",
      "x-goog-channel-token": "wrong-token",
      "x-goog-resource-id": "abc",
      "x-goog-resource-state": "exists",
    });
    expect(r.status).toBe(401);
    expect(mocks.findCalendarWatchByChannel).not.toHaveBeenCalled();
  });

  it("acks 204 on `sync` and does not call incremental sync", async () => {
    const r = await postPush({
      "x-goog-channel-id": "cp-cal-x",
      "x-goog-channel-token": SHARED_TOKEN,
      "x-goog-resource-id": "abc",
      "x-goog-resource-state": "sync",
    });
    expect(r.status).toBe(204);
    await new Promise(res => setImmediate(res));
    expect(mocks.findCalendarWatchByChannel).not.toHaveBeenCalled();
    expect(mocks.syncCalendarIncremental).not.toHaveBeenCalled();
  });

  it("acks 204 on `exists` and triggers incremental sync for the matched user", async () => {
    mocks.findCalendarWatchByChannel.mockResolvedValueOnce({
      id: 1,
      userId: 42,
      provider: "google",
      calendarId: "primary",
      channelId: "cp-cal-x",
      resourceId: "abc",
    });
    mocks.syncCalendarIncremental.mockResolvedValueOnce({
      scanned: 3,
      detected: 1,
      cancelled: 0,
      mode: "incremental",
      syncTokenAcquired: true,
    });

    const r = await postPush({
      "x-goog-channel-id": "cp-cal-x",
      "x-goog-channel-token": SHARED_TOKEN,
      "x-goog-resource-id": "abc",
      "x-goog-resource-state": "exists",
      "x-goog-message-number": "42",
    });
    expect(r.status).toBe(204);

    for (let i = 0; i < 5; i++) {
      await new Promise(res => setImmediate(res));
      if (mocks.syncCalendarIncremental.mock.calls.length > 0) break;
    }

    expect(mocks.findCalendarWatchByChannel).toHaveBeenCalledWith({
      channelId: "cp-cal-x",
      resourceId: "abc",
    });
    expect(mocks.syncCalendarIncremental).toHaveBeenCalledWith(42, "primary");
  });
});

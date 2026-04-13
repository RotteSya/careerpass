import { describe, expect, it, vi } from "vitest";
import {
  isRealtimeTelegramSuppressed,
  markRealtimeTelegramSuppressedAfterScan,
} from "./mailMonitoring";

describe("mailMonitoring realtime notification suppression", () => {
  it("suppresses realtime Telegram notifications right after scan", () => {
    const userId = 900001;
    markRealtimeTelegramSuppressedAfterScan(userId, 60_000);
    expect(isRealtimeTelegramSuppressed(userId)).toBe(true);
  });

  it("auto-expires suppression window", () => {
    vi.useFakeTimers();
    const userId = 900002;
    markRealtimeTelegramSuppressedAfterScan(userId, 5_000);
    expect(isRealtimeTelegramSuppressed(userId)).toBe(true);
    vi.advanceTimersByTime(5_100);
    expect(isRealtimeTelegramSuppressed(userId)).toBe(false);
    vi.useRealTimers();
  });
});

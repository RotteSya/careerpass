import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { telegramRouter } from "./telegram";

const mocks = vi.hoisted(() => ({
  invokeLLM: vi.fn(),
  sendTelegramBubbles: vi.fn().mockResolvedValue(true),
  sendTelegramMessage: vi.fn().mockResolvedValue(true),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: mocks.invokeLLM,
}));

vi.mock("./telegramMessaging", () => ({
  sendTelegramMessage: mocks.sendTelegramMessage,
  sendTelegramBubbles: mocks.sendTelegramBubbles,
  answerTelegramCallbackQuery: vi.fn(),
  editTelegramMessageText: vi.fn(),
}));

vi.mock("./db", () => ({
  createTelegramBinding: vi.fn(),
  getUserById: vi
    .fn()
    .mockResolvedValue({ id: 1, preferredLanguage: "en", name: "Test User" }),
  getOrCreateAgentSession: vi
    .fn()
    .mockResolvedValue({ id: 11, sessionState: {} }),
  saveAgentMemory: vi.fn(),
  updateAgentSession: vi.fn(),
  getTelegramBindingByTelegramId: vi
    .fn()
    .mockResolvedValue({ userId: 1, isActive: true }),
  getJobApplications: vi.fn().mockResolvedValue([]),
  listJobStatusEvents: vi.fn().mockResolvedValue([]),
  getBillingFeatureAccess: vi
    .fn()
    .mockResolvedValue({ autoMonitoringEnabled: true }),
  setCalendarWriteEnabled: vi.fn(),
  upsertCalendarEventSync: vi.fn(),
}));

vi.mock("./mailMonitoring", () => ({
  startMailMonitoringAndCheckmail: vi.fn(),
  consumeBackgroundScanResult: vi.fn(),
}));

vi.mock("./gmail", () => ({
  registerGmailPushWatch: vi.fn(),
  getValidAccessToken: vi.fn(),
  writeToGoogleCalendar: vi.fn(),
}));

vi.mock("./calendarWriteConsent", () => ({
  takePendingCalendarWrite: vi.fn(),
}));

vi.mock("./billing", () => ({
  collectTrialNudges: vi.fn().mockResolvedValue([]),
  manualScanUpsellLine: vi.fn(),
  markTrialNudgeDelivered: vi.fn(),
}));

describe("telegram webhook dedupe", () => {
  beforeEach(() => {
    mocks.invokeLLM.mockReset();
    mocks.invokeLLM.mockResolvedValue({
      id: "x",
      created: 0,
      model: "test",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
    });
    mocks.sendTelegramBubbles.mockReset();
    mocks.sendTelegramBubbles.mockResolvedValue(true);
    mocks.sendTelegramMessage.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function postWebhook(
    update: unknown
  ): Promise<{ status: number; body: unknown }> {
    const layer = (telegramRouter as any).stack.find(
      (item: any) => item.route?.path === "/webhook"
    );
    if (!layer) throw new Error("telegram webhook route was not registered");

    let status = 200;
    return new Promise((resolve, reject) => {
      const req = {
        method: "POST",
        url: "/webhook",
        body: update,
        headers: { "x-telegram-bot-api-secret-token": "test-telegram-secret" },
        ip: "127.0.0.1",
      };
      const res = {
        status(code: number) {
          status = code;
          return res;
        },
        json(body: unknown) {
          resolve({ status, body });
        },
      };

      layer.handle(req, res, (err: unknown) => {
        if (err) reject(err);
      });
    });
  }

  it("allows Telegram to retry the same update after processing fails", async () => {
    const update = {
      update_id: 4242,
      message: {
        chat: { id: 12345 },
        from: { id: 67890, username: "tester" },
        text: "hello",
      },
    };

    mocks.sendTelegramBubbles
      .mockRejectedValueOnce(new Error("Telegram send transiently failed"))
      .mockResolvedValueOnce(true);

    const first = await postWebhook(update);
    expect(first.status).toBe(500);

    const second = await postWebhook(update);
    expect(second.status).toBe(200);

    expect(mocks.sendTelegramBubbles).toHaveBeenCalledTimes(2);
    expect(mocks.sendTelegramBubbles).toHaveBeenLastCalledWith(12345, "ok");
  });
});

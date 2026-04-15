import { describe, expect, it } from "vitest";
import { assertTelegramWebhookSecret } from "./telegramWebhookAuth";

describe("assertTelegramWebhookSecret", () => {
  it("throws when secret header is missing", () => {
    expect(() =>
      assertTelegramWebhookSecret(
        { "x-telegram-bot-api-secret-token": undefined },
        { requiredSecret: "s1" }
      )
    ).toThrow();
  });

  it("throws when secret header mismatches", () => {
    expect(() =>
      assertTelegramWebhookSecret(
        { "x-telegram-bot-api-secret-token": "nope" },
        { requiredSecret: "s1" }
      )
    ).toThrow();
  });

  it("passes when secret matches", () => {
    expect(() =>
      assertTelegramWebhookSecret(
        { "x-telegram-bot-api-secret-token": "s1" },
        { requiredSecret: "s1" }
      )
    ).not.toThrow();
  });
});


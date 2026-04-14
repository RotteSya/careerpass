import { describe, expect, it } from "vitest";
import { __extractCleanMailTextFromGmailPayloadForTests, __extractGmailBodyFromPayloadForTests } from "./gmail";
import { runRecruitingNlpPipeline } from "./mailNlpPipeline";

function toBase64Url(text: string): string {
  return Buffer.from(text, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("gmail payload extraction compatibility", () => {
  it("extracts nested multipart text/plain body using base64url", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            {
              mimeType: "text/plain",
              body: {
                data: toBase64Url(
                  "この度は選考に参加いただきありがとうございました。残念ながら採用をお見送りとさせていただくことになりました。"
                ),
              },
            },
          ],
        },
      ],
    };

    const body = __extractGmailBodyFromPayloadForTests(payload, "");
    expect(body).toContain("採用をお見送り");
  });

  it("extracts text from html-only payload", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        {
          mimeType: "text/html",
          body: {
            data: toBase64Url(
              "<html><body><p>面接のご案内</p><div>日時：2026年4月10日 14:00<br/>Zoom URL: https://meet.google.com/abc-defg-hij</div><img src=\"cid:123\"/></body></html>"
            ),
          },
        },
      ],
    };

    const body = __extractGmailBodyFromPayloadForTests(payload, "");
    expect(body).toContain("面接のご案内");
    expect(body).toContain("2026年4月10日");
    expect(body).toContain("https://meet.google.com/abc-defg-hij");
    expect(body).not.toContain("<html>");
  });

  it("cleans quoted reply chains and unsubscribe lines", () => {
    const payload = {
      mimeType: "text/plain",
      body: {
        data: toBase64Url(
          [
            "面接のご案内です。",
            "日時：2026年4月10日 14:00",
            "配信停止はこちら: https://example.com/unsubscribe",
            "-----Original Message-----",
            "> older content",
            "From: someone@example.com",
            "Subject: old",
          ].join("\n")
        ),
      },
    };
    const cleaned = __extractCleanMailTextFromGmailPayloadForTests(payload, "");
    expect(cleaned).toContain("面接のご案内です。");
    expect(cleaned).toContain("2026年4月10日");
    expect(cleaned).not.toContain("unsubscribe");
    expect(cleaned).not.toContain("Original Message");
    expect(cleaned).not.toContain("older content");
  });

  it("keeps rejection decision when subject is result notice and body includes rejection phrase", () => {
    const body = "その結果、残念ながらSHE様の採用をお見送りとさせていただくことになりました。";
    const d = runRecruitingNlpPipeline({
      subject: "【オロ】選考結果のご連絡",
      body,
      from: "candidate@orocoltd.n-ats.hrmos.co",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.isJobRelated).toBe(true);
    expect(d.eventType).toBe("rejection");
  });
});

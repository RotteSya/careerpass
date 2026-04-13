import { describe, expect, it } from "vitest";
import { __extractGmailBodyFromPayloadForTests } from "./gmail";
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

import { describe, expect, it } from "vitest";
import { extractForwardedOriginal } from "./forwardedMail";

describe("extractForwardedOriginal", () => {
  it("extracts forwarded headers and body (Gmail style)", () => {
    const r = extractForwardedOriginal({
      subject: "Fwd: 【サンマルクホールディングス】エントリーシートご提出の御礼",
      from: "Me <me@gmail.com>",
      body:
        "intro text\n\n" +
        "From: 株式会社サンマルクホールディングス <noreply@example.co.jp>\n" +
        "Sent: Tuesday, February 17, 2026 8:29 PM\n" +
        "To: Me <me@gmail.com>\n" +
        "Subject: 【サンマルクホールディングス】エントリーシートご提出の御礼\n\n" +
        "本文です。\n",
      date: new Date("2026-04-14T00:00:00Z"),
    });
    expect(r.isForwarded).toBe(true);
    expect(r.subject).toBe("【サンマルクホールディングス】エントリーシートご提出の御礼");
    expect(r.from).toContain("サンマルクホールディングス");
    expect(r.body).toContain("本文です");
    expect(r.body).not.toContain("intro text");
    expect(r.date?.getUTCFullYear()).toBe(2026);
    expect(r.date?.getUTCMonth()).toBe(1);
    expect(r.date?.getUTCDate()).toBe(17);
  });

  it("keeps original mail unchanged when not forwarded", () => {
    const r = extractForwardedOriginal({
      subject: "面接のご案内",
      from: "hr@example.co.jp",
      body: "面接日時：2026年5月1日 10:00",
      date: new Date("2026-04-01T00:00:00Z"),
    });
    expect(r.isForwarded).toBe(false);
    expect(r.subject).toBe("面接のご案内");
    expect(r.from).toBe("hr@example.co.jp");
  });
});


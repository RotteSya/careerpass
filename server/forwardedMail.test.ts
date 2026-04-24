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
    expect(r.date?.getFullYear()).toBe(2026);
    expect(r.date?.getMonth()).toBe(1);
    expect(r.date?.getDate()).toBe(17);
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

  it("recognizes Japanese 転送: subject prefix", () => {
    const r = extractForwardedOriginal({
      subject: "転送: 【ABC株式会社】面接のご案内",
      from: "Me <me@gmail.com>",
      body:
        "（参考情報を転送します）\n\n" +
        "From: 株式会社ABC 採用担当 <hr@abc.co.jp>\n" +
        "件名: 【ABC株式会社】面接のご案内\n" +
        "日付: 2026年4月20日 10:00\n\n" +
        "面接の詳細です。\n",
      date: null,
    });
    expect(r.isForwarded).toBe(true);
    expect(r.from).toContain("株式会社ABC");
    expect(r.subject).toBe("【ABC株式会社】面接のご案内");
    expect(r.body).toContain("面接の詳細です");
    // 2026-04-20 10:00 JST → 2026-04-20 01:00 UTC.
    expect(r.date?.toISOString()).toBe("2026-04-20T01:00:00.000Z");
  });

  it("detects Gmail body divider when subject lacks a prefix", () => {
    const r = extractForwardedOriginal({
      subject: "面接のご案内",
      from: "Me <me@gmail.com>",
      body:
        "FYI\n\n" +
        "---------- Forwarded message ----------\n" +
        "From: HR <hr@example.co.jp>\n" +
        "Subject: 面接のご案内\n" +
        "Sent: 2026-04-18T10:00:00Z\n\n" +
        "ご案内本文。\n",
      date: null,
    });
    expect(r.isForwarded).toBe(true);
    expect(r.from).toContain("hr@example.co.jp");
    expect(r.body).toContain("ご案内本文");
  });

  it("unwraps nested forwards down to the innermost message", () => {
    const r = extractForwardedOriginal({
      subject: "Fwd: Fwd: 【X社】面接",
      from: "friend@gmail.com",
      body:
        "outer wrapper\n\n" +
        "From: Me <me@gmail.com>\n" +
        "Subject: Fwd: 【X社】面接\n\n" +
        "inner wrapper\n\n" +
        "From: HR <hr@x.co.jp>\n" +
        "Subject: 【X社】面接\n" +
        "Sent: 2026年4月22日 14:00\n\n" +
        "最内层原文。\n",
      date: null,
    });
    expect(r.isForwarded).toBe(true);
    expect(r.from).toContain("hr@x.co.jp");
    expect(r.subject).toBe("【X社】面接");
    expect(r.body).toContain("最内层");
  });
});


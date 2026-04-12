import { describe, expect, it } from "vitest";
import { runRecruitingNlpPipeline } from "./mailNlpPipeline";

describe("runRecruitingNlpPipeline", () => {
  it("skips obvious platform noise before LLM", () => {
    const d = runRecruitingNlpPipeline({
      subject: "OpenWork 新着口コミのお知らせ",
      body: "あなたへの新着通知があります",
      from: "noreply@openwork.jp",
      domainSignal: 0.6,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.shouldSkipLlm).toBe(true);
    expect(d.isJobRelated).toBe(false);
    expect(d.eventType).toBe("other");
  });

  it("promotes hard rejection outcomes over uncertain LLM output", () => {
    const d = runRecruitingNlpPipeline(
      {
        subject: "選考結果のご連絡",
        body: "誠に残念ながら今回は見送りとなりました。",
        from: "hr@example.co.jp",
        domainSignal: 0.95,
        fallbackDate: null,
        fallbackTime: null,
      },
      {
        isJobRelated: true,
        confidence: 0.6,
        reason: "llm",
        eventType: "other",
      }
    );
    expect(d.eventType).toBe("rejection");
    expect(d.isJobRelated).toBe(true);
  });

  it("merges date/time fallback when LLM does not provide them", () => {
    const d = runRecruitingNlpPipeline(
      {
        subject: "面接のご案内",
        body: "一次面接のご案内です",
        from: "recruit@sample.co.jp",
        domainSignal: 0.95,
        fallbackDate: "2026-04-20",
        fallbackTime: "13:00",
      },
      {
        isJobRelated: true,
        confidence: 0.9,
        reason: "llm",
        eventType: "interview",
        eventDate: null,
        eventTime: null,
      }
    );
    expect(d.eventDate).toBe("2026-04-20");
    expect(d.eventTime).toBe("13:00");
  });
});

import { describe, expect, it } from "vitest";
import { runRecruitingNlpPipeline } from "./mailNlpPipeline";

describe("runRecruitingNlpPipeline platform seminar promo", () => {
  it("treats マイナビ／グローバル人材紹介 seminar promo as not job-related even if subject contains 最終のご案内", () => {
    const r = runRecruitingNlpPipeline({
      subject:
        "★最終のご案内／申込期限間近★【27卒向け】日本就職のAtoZ ～文系外国人留学生のための就活準備講座_基礎・企業紹介編～／2026年2月13日（金）開催（マイナビ／グローバル人材紹介）",
      from: '"マイナビ／グローバル人材紹介運営事務局" <global-ca@me.mynavi.jp>',
      body: "就活準備講座のご案内です。配信停止はこちら。",
      domainSignal: 0.9,
      fallbackDate: "2026-02-13",
      fallbackTime: null,
    });
    expect(r.isJobRelated).toBe(false);
    expect(r.eventType).toBe("other");
    expect(r.companyName).toBeNull();
  });
});


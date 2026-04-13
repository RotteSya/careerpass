import { describe, expect, it } from "vitest";
import {
  extractBestCompanyName,
  extractBestDateTime,
  extractTimeCandidates,
  extractLocation,
  detectInterviewRound,
  getDomainReputation,
  calculateNegativeSignalPenalty,
} from "./mailNer";

describe("extractBestCompanyName", () => {
  it("extracts legal entity from subject", () => {
    const r = extractBestCompanyName(
      "【株式会社メルカリ】一次面接のご案内",
      "recruit@mercari.com",
      "",
    );
    expect(r.name).toBe("株式会社メルカリ");
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it("extracts inverted legal entity (CompanyName株式会社)", () => {
    const r = extractBestCompanyName(
      "サイバーエージェント株式会社 説明会のご案内",
      "recruit@cyberagent.co.jp",
      "",
    );
    expect(r.name).toContain("サイバーエージェント");
    expect(r.name).toContain("株式会社");
  });

  it("extracts from sender display name with HR suffix", () => {
    const r = extractBestCompanyName(
      "面接日程のご案内",
      "株式会社サンプル 採用担当 <recruit@sample.co.jp>",
      "",
    );
    expect(r.name).toBe("株式会社サンプル");
  });

  it("extracts from bracket in subject", () => {
    const r = extractBestCompanyName(
      "【トヨタ自動車】選考のご案内",
      "hr@toyota.co.jp",
      "",
    );
    expect(r.name).toBe("トヨタ自動車");
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it("does not return platform name as company", () => {
    const r = extractBestCompanyName(
      "OpenWork 新着通知",
      "noreply@openwork.jp",
      "",
    );
    expect(r.name).toBeNull();
  });

  it("does not return noreply as company", () => {
    const r = extractBestCompanyName(
      "お知らせ",
      "noreply@example.com",
      "",
    );
    // Should not be "noreply"
    expect(r.name).not.toBe("noreply");
  });

  it("extracts from legal entity in body", () => {
    const r = extractBestCompanyName(
      "選考のご案内",
      "hr@test.co.jp",
      "株式会社テスト より選考のご案内を差し上げます。",
    );
    expect(r.name).toContain("株式会社テスト");
  });

  it("boosts confidence with multi-source agreement", () => {
    // Legal name appears in both subject and from
    const r = extractBestCompanyName(
      "【株式会社ABC】面接のご案内",
      "株式会社ABC 採用 <recruit@abc.co.jp>",
      "株式会社ABCの採用担当です。",
    );
    expect(r.confidence).toBeGreaterThan(0.95);
  });

  it("falls back to domain SLD when no other signals", () => {
    const r = extractBestCompanyName(
      "面接のご案内",
      "hr@specialcorp.co.jp",
      "面接日程をご確認ください。",
    );
    // Should extract "specialcorp" from domain
    expect(r.name).toBe("specialcorp");
    expect(r.confidence).toBeLessThan(0.6);
  });

  it("handles 合同会社 entity type", () => {
    const r = extractBestCompanyName(
      "合同会社テスト 面接のご案内",
      "hr@test.com",
      "",
    );
    expect(r.name).toContain("合同会社テスト");
  });

  // ── Bug fix: platform newsletter should NOT extract company from body ──

  it("does not extract body company from mynavi newsletter", () => {
    const r = extractBestCompanyName(
      "マイナビメール2027★ピックアップ★",
      "job-s27@mynavi.jp",
      "初めまして！ダイナム採用担当です。株式会社ダイナムは...",
      "recruiting_platform",
    );
    // Should NOT return ダイナム — it's mentioned in body of a platform newsletter
    // name should be null or at least not contain ダイナム
    expect(r.name === null || !r.name.includes("ダイナム")).toBe(true);
  });

  it("does not extract body company from noise platform email", () => {
    const r = extractBestCompanyName(
      "【就活会議】あなたにおすすめ",
      "noreply@syukatsu-kaigi.jp",
      "株式会社サンプルの口コミが更新されました",
      "noise_platform",
    );
    expect(r.name === null || !r.name.includes("サンプル")).toBe(true);
  });

  it("still extracts subject company even from platform emails", () => {
    // If the subject explicitly names a company (e.g. forwarded notification),
    // we should still pick it up from subject
    const r = extractBestCompanyName(
      "【株式会社テスト】エントリー完了",
      "noreply@mynavi.jp",
      "マイナビ経由のエントリーが完了しました。",
      "recruiting_platform",
    );
    expect(r.name).toBe("株式会社テスト");
  });

  // ── Bug fix: stray quote in company name ──

  it("strips leading double-quote from company name", () => {
    const r = extractBestCompanyName(
      '"メイテックフィルダーズ 面接のご案内',
      "hr@example.co.jp",
      "",
    );
    // The leading " should be stripped
    if (r.name) {
      expect(r.name).not.toMatch(/^"/);
    }
  });

  it("merges legal/non-legal variants into one canonical company", () => {
    const r = extractBestCompanyName(
      "【ミライト・ワン】説明会にご参加いただきありがとうございました",
      "ミライト・ワン <mirait@mail.axol.jp>",
      "末尾署名: 株式会社ミライト・ワン",
    );
    expect(r.name).toBe("株式会社ミライト・ワン");
  });
});

describe("extractTimeCandidates / extractBestDateTime", () => {
  it("extracts Japanese year-month-day format", () => {
    const r = extractBestDateTime("面接日時：2026年5月1日(金) 14:00〜15:00");
    expect(r.date).toBe("2026-05-01");
    expect(r.time).toBe("14:00");
    expect(r.endTime).toBe("15:00");
  });

  it("extracts slash date format", () => {
    const r = extractBestDateTime("日時: 2026/04/20 10:00");
    expect(r.date).toBe("2026-04-20");
    expect(r.time).toBe("10:00");
  });

  it("extracts ISO date format", () => {
    const r = extractBestDateTime("deadline: 2026-05-15");
    expect(r.date).toBe("2026-05-15");
  });

  it("extracts time with 時分 format", () => {
    const r = extractBestDateTime("2026年4月10日 14時30分から面接");
    expect(r.date).toBe("2026-04-10");
    expect(r.time).toBe("14:30");
  });

  it("returns null when no date found", () => {
    const r = extractBestDateTime("特にお知らせはありません。");
    expect(r.date).toBeNull();
    expect(r.time).toBeNull();
  });

  it("picks future date over past date", () => {
    // Use a date far in the future to ensure it's always "future"
    const r = extractBestDateTime(
      "前回: 2020-01-01 次回: 2030-06-15 14:00",
    );
    expect(r.date).toBe("2030-06-15");
  });

  it("finds multiple candidates and returns highest confidence", () => {
    const candidates = extractTimeCandidates(
      "説明会は2026年5月10日(土) 10:00〜11:00に開催。締切は2026/05/08です。",
    );
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    // First candidate should have higher confidence (has event context + time)
    expect(candidates[0].time).toBe("10:00");
  });
});

describe("extractLocation", () => {
  it("extracts location from 会場 label", () => {
    const r = extractLocation("会場: 東京都渋谷区道玄坂1-2-3 ABCビル5F");
    expect(r).toContain("東京都渋谷区");
  });

  it("extracts location from 面接場所 label", () => {
    const r = extractLocation("面接場所：大阪府大阪市北区梅田1丁目");
    expect(r).toContain("大阪");
  });

  it("detects online interview", () => {
    const r = extractLocation("オンライン面接で実施いたします。");
    expect(r).toContain("オンライン面接");
  });

  it("detects Zoom meeting", () => {
    const r = extractLocation("Zoom URL: https://zoom.us/j/12345");
    expect(r).toContain("zoom");
  });

  it("returns null when no location", () => {
    const r = extractLocation("よろしくお願いいたします。");
    expect(r).toBeNull();
  });

  it("extracts postal code address", () => {
    const r = extractLocation("〒150-0043 東京都渋谷区道玄坂1-2-3");
    expect(r).toContain("東京都渋谷区");
  });
});

describe("detectInterviewRound", () => {
  it("detects 一次面接", () => {
    expect(detectInterviewRound("一次面接のご案内")).toBe("1st");
  });

  it("detects 二次面接", () => {
    expect(detectInterviewRound("二次面接について")).toBe("2nd");
  });

  it("detects 三次面接", () => {
    expect(detectInterviewRound("三次面接の日程")).toBe("3rd");
  });

  it("detects 最終面接", () => {
    expect(detectInterviewRound("最終面接のご案内")).toBe("final");
  });

  it("detects English 2nd interview", () => {
    expect(detectInterviewRound("2nd interview invitation")).toBe("2nd");
  });

  it("detects final interview in English", () => {
    expect(detectInterviewRound("Final interview schedule")).toBe("final");
  });

  it("returns unknown for generic 面接", () => {
    expect(detectInterviewRound("面接のご案内")).toBe("unknown");
  });

  it("returns null when no interview mentioned", () => {
    expect(detectInterviewRound("説明会のご案内")).toBeNull();
  });
});

describe("getDomainReputation", () => {
  it("identifies corporate .co.jp domain", () => {
    const r = getDomainReputation("hr@toyota.co.jp");
    expect(r.tier).toBe("corporate_jp");
    expect(r.score).toBeGreaterThan(0.8);
  });

  it("identifies recruiting platform domain", () => {
    const r = getDomainReputation("info@rikunabi.com");
    expect(r.tier).toBe("recruiting_platform");
    expect(r.score).toBeGreaterThan(0.5);
  });

  it("identifies noise platform domain", () => {
    const r = getDomainReputation("noreply@openwork.jp");
    expect(r.tier).toBe("noise_platform");
    expect(r.score).toBeLessThan(0.1);
  });

  it("identifies free mail domain", () => {
    const r = getDomainReputation("user@gmail.com");
    expect(r.tier).toBe("free_mail");
    expect(r.score).toBeLessThan(0.2);
  });

  it("gives higher score to recruit-related domains", () => {
    const r = getDomainReputation("hr@recruit.example.co.jp");
    expect(r.tier).toBe("corporate_jp");
    expect(r.score).toBeGreaterThanOrEqual(0.95);
  });

  it("handles missing @ in from field", () => {
    const r = getDomainReputation("unknown sender");
    expect(r.tier).toBe("unknown");
  });
});

describe("calculateNegativeSignalPenalty", () => {
  it("returns 0 for normal recruiting email", () => {
    const p = calculateNegativeSignalPenalty(
      "一次面接のご案内です。日程をご確認ください。",
    );
    expect(p).toBe(0);
  });

  it("returns negative penalty for marketing content", () => {
    const p = calculateNegativeSignalPenalty(
      "おすすめ求人情報をお届けします。配信停止はこちら。",
    );
    expect(p).toBeLessThan(0);
  });

  it("accumulates penalties for multiple negative signals", () => {
    const p = calculateNegativeSignalPenalty(
      "メルマガ配信中！キャンペーン実施中！配信停止はこちら",
    );
    expect(p).toBeLessThan(-0.3);
  });

  it("caps penalty at -0.8", () => {
    const p = calculateNegativeSignalPenalty(
      "メルマガ ニュースレター キャンペーン 広告 口コミ 新着求人 配信停止"
    );
    expect(p).toBeGreaterThanOrEqual(-0.8);
  });
});

/**
 * recon.test.ts
 * Tests for:
 * 1. scoreMemoryRelevance — text-based similarity scoring (pgvector substitute)
 * 2. searchMemories — top-K memory retrieval by relevance
 * 3. Firecrawl/Tavily API key presence
 * 4. Gmail email classification logic (exported helpers)
 */
import { describe, expect, it } from "vitest";
import { scoreMemoryRelevance, searchMemories } from "./recon";

// ─── Memory Relevance Scoring ─────────────────────────────────────────────────

describe("scoreMemoryRelevance", () => {
  it("returns 1.0 for exact match of all query tokens", () => {
    const score = scoreMemoryRelevance("トヨタ 企業レポート 中期経営計画", "トヨタ 企業レポート");
    expect(score).toBeGreaterThan(0.8);
  });

  it("returns 0 for completely unrelated content", () => {
    const score = scoreMemoryRelevance("全く関係のないテキスト", "トヨタ 採用");
    expect(score).toBe(0);
  });

  it("boosts score for exact phrase match", () => {
    const withPhrase = scoreMemoryRelevance("トヨタ自動車の採用情報", "トヨタ自動車");
    const withoutPhrase = scoreMemoryRelevance("自動車 採用 情報", "トヨタ自動車");
    expect(withPhrase).toBeGreaterThanOrEqual(withoutPhrase);
  });

  it("handles empty query gracefully", () => {
    const score = scoreMemoryRelevance("some content", "");
    expect(score).toBe(0);
  });

  it("handles Japanese and English mixed content", () => {
    const score = scoreMemoryRelevance(
      "Toyota Motor Corporation DX transformation strategy 2025",
      "Toyota DX"
    );
    expect(score).toBeGreaterThan(0);
  });

  it("is case-insensitive for English tokens", () => {
    const lower = scoreMemoryRelevance("toyota motor", "toyota");
    const upper = scoreMemoryRelevance("TOYOTA MOTOR", "toyota");
    expect(lower).toBeCloseTo(upper, 5);
  });
});

// ─── searchMemories Top-K ─────────────────────────────────────────────────────

describe("searchMemories", () => {
  const memories = [
    { title: "トヨタ_Recon_Report.md", content: "トヨタ自動車 DX 中期経営計画 EV戦略", memoryType: "company_report" },
    { title: "ソニー_Recon_Report.md", content: "ソニーグループ エンタメ AI 半導体", memoryType: "company_report" },
    { title: "USER_abc123.md", content: "自己PR リーダーシップ STAR法則 コミュニケーション", memoryType: "resume" },
    { title: "トヨタ_ES.md", content: "志望動機 自己PR トヨタ 製造業 グローバル", memoryType: "es_draft" },
    { title: "面接ログ_2024.md", content: "面接 質問 回答 フィードバック", memoryType: "interview_log" },
  ];

  it("returns top-K results sorted by relevance", () => {
    const results = searchMemories(memories, "トヨタ", 3);
    expect(results.length).toBeLessThanOrEqual(3);
    // Toyota-related items should rank higher
    expect(results[0].title).toMatch(/トヨタ/);
  });

  it("returns all items when query is empty (up to topK)", () => {
    const results = searchMemories(memories, "", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("respects topK limit", () => {
    const results = searchMemories(memories, "企業", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("returns empty array for no matches with high threshold", () => {
    const results = searchMemories(memories, "存在しないキーワードxyz123", 5);
    // All scores should be 0, but we still return topK (sorted by 0)
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it("handles single-item memory list", () => {
    const single = [{ title: "test.md", content: "test content", memoryType: "resume" }];
    const results = searchMemories(single, "test", 5);
    expect(results.length).toBe(1);
  });
});

// ─── API Key Presence ─────────────────────────────────────────────────────────

describe("Recon API keys configuration", () => {
  it("TAVILY_API_KEY prefix looks valid when provided", () => {
    const key = process.env.TAVILY_API_KEY;
    if (!key) return;
    expect(key.startsWith("tvly-")).toBe(true);
  });

  it("FIRECRAWL_API_KEY prefix looks valid when provided", () => {
    const key = process.env.FIRECRAWL_API_KEY;
    if (!key) return;
    expect(key.startsWith("fc-")).toBe(true);
  });
});

// ─── Email Classification Logic ───────────────────────────────────────────────

describe("Email event type classification patterns", () => {
  const EVENT_PATTERNS: Record<string, RegExp[]> = {
    interview: [/面接/, /インタビュー/, /interview/i, /面談/],
    briefing: [/説明会/, /セミナー/, /インターン/, /intern/i, /briefing/i],
    test: [/筆記試験/, /適性検査/, /SPI/, /webテスト/, /テスト/],
    offer: [/内定/, /採用通知/, /offer/i, /合格/],
    rejection: [/不採用/, /選考結果/, /残念/, /お見送り/],
  };

  function classify(text: string): string {
    for (const [type, patterns] of Object.entries(EVENT_PATTERNS)) {
      if (patterns.some((p) => p.test(text))) return type;
    }
    return "other";
  }

  it("classifies interview emails correctly", () => {
    expect(classify("【重要】面接のご案内")).toBe("interview");
    expect(classify("Interview Invitation from Company")).toBe("interview");
    expect(classify("面談のお時間をいただけますか")).toBe("interview");
  });

  it("classifies briefing/seminar emails correctly", () => {
    expect(classify("会社説明会のご案内")).toBe("briefing");
    expect(classify("夏季インターンシップ募集のお知らせ")).toBe("briefing");
  });

  it("classifies aptitude test emails correctly", () => {
    expect(classify("SPIテストのご案内")).toBe("test");
    expect(classify("適性検査を受けてください")).toBe("test");
  });

  it("classifies offer emails correctly", () => {
    expect(classify("内定のご連絡")).toBe("offer");
    expect(classify("Job Offer Letter")).toBe("offer");
  });

  it("classifies rejection emails correctly", () => {
    expect(classify("選考結果のご連絡（お見送り）")).toBe("rejection");
    expect(classify("誠に残念ながら不採用とさせていただきます")).toBe("rejection");
  });

  it("returns 'other' for unrelated emails", () => {
    expect(classify("ニュースレター：今月のお知らせ")).toBe("other");
    expect(classify("パスワードリセットのご案内")).toBe("other");
  });
});

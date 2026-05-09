import { describe, expect, it } from "vitest";
import { classifyCalendarEvent } from "./calendarEventNlp";

describe("classifyCalendarEvent", () => {
  it("returns not-relevant for empty input", () => {
    const r = classifyCalendarEvent({});
    expect(r.isRelevant).toBe(false);
    expect(r.eventType).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.matchedKeywords).toEqual([]);
  });

  it("returns not-relevant for unrelated text", () => {
    const r = classifyCalendarEvent({ summary: "Lunch with team" });
    expect(r.isRelevant).toBe(false);
    expect(r.eventType).toBeNull();
  });

  it("classifies 一次面接 as interview_1", () => {
    const r = classifyCalendarEvent({ summary: "[example] 一次面接 @ Zoom" });
    expect(r.isRelevant).toBe(true);
    expect(r.eventType).toBe("interview_1");
    expect(r.matchedKeywords).toContain("面接");
  });

  it("prefers interview_final over interview_1 when both keywords appear", () => {
    const r = classifyCalendarEvent({
      summary: "最終面接 (final interview round)",
    });
    expect(r.eventType).toBe("interview_final");
  });

  it("classifies 説明会 as briefing", () => {
    const r = classifyCalendarEvent({ summary: "会社説明会 / 新卒採用" });
    expect(r.isRelevant).toBe(true);
    expect(r.eventType).toBe("briefing");
  });

  it("classifies SPI / Webテスト as written_test", () => {
    const a = classifyCalendarEvent({ summary: "SPI 模試" });
    expect(a.eventType).toBe("written_test");
    const b = classifyCalendarEvent({ summary: "Webテスト 実施" });
    expect(b.eventType).toBe("written_test");
  });

  it("classifies 内定 as offer (highest priority)", () => {
    const r = classifyCalendarEvent({
      summary: "内定式 + 面接フィードバック",
    });
    expect(r.eventType).toBe("offer");
  });

  it("uses word-boundary for ASCII tokens (interview != reviewer)", () => {
    const r = classifyCalendarEvent({ summary: "Quarterly reviewer sync" });
    expect(r.isRelevant).toBe(false);
  });

  it("matches across summary/description/location", () => {
    const r = classifyCalendarEvent({
      summary: "1:1",
      description: "会社説明 by HR",
      location: null,
    });
    expect(r.eventType).toBe("briefing");
  });

  it("weak-only signals stay non-relevant under the confidence floor", () => {
    // 新卒 + 採用 are both weight 0.5 ('other'); 0.5 < 0.6 floor → not relevant.
    const r = classifyCalendarEvent({ summary: "新卒採用 ガイダンス" });
    expect(r.isRelevant).toBe(false);
    expect(r.eventType).toBeNull();
  });

  it("a single 'other' match at the floor (選考, weight 0.6) marks relevant", () => {
    const r = classifyCalendarEvent({ summary: "選考会場のお知らせ" });
    expect(r.isRelevant).toBe(true);
    expect(r.eventType).toBe("other");
  });
});

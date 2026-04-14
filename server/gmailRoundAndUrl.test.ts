import { describe, expect, it } from "vitest";
import {
  __buildMeetingUrlSearchQueriesForTests,
  __extractMeetingUrlFromTextForTests,
} from "./gmail";
import { detectInterviewRound } from "./mailNer";

describe("gmail helpers", () => {
  it("maps 2次面接 to 2nd", () => {
    const round = detectInterviewRound("2次面接のご案内");
    expect(round).toBe("2nd");
  });

  it("maps 最終選考 to final when selection context exists", () => {
    const round = detectInterviewRound("最終選考のご案内 オンライン面接");
    expect(round).toBe("final");
  });

  it("extracts meeting urls from text", () => {
    const url1 = __extractMeetingUrlFromTextForTests(
      "Please join: https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC?context=xyz"
    );
    expect(url1).toContain("teams.microsoft.com");

    const url2 = __extractMeetingUrlFromTextForTests("Join https://meet.google.com/abc-defg-hij to start");
    expect(url2).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("builds cross-thread queries for meeting url search", () => {
    const queries = __buildMeetingUrlSearchQueriesForTests({
      fromDomain: "hito-link.jp",
      companyName: "テクバン株式会社",
      eventDate: "2026-03-26",
      mailDate: "Mon, 30 Mar 2026 09:00:00 +0900",
      subject: "【テクバン株式会社】2次選考日程確定のご連絡",
      from: "テクバン(株)新卒採用担当 <techvan-saiyo@hito-link.jp>",
    });
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries[0]).toContain("from:hito-link.jp");
    expect(queries[0]).toContain("(teams.microsoft.com OR meet.google.com OR zoom.us OR webex.com)");
    expect(queries[0]).toContain("(テクバン株式会社)");
    expect(queries[0]).toContain("(2026-03-26 OR 2026/03/26 OR 03/26)");
    expect(queries[1]).toContain("after:");
    expect(queries[1]).toContain("before:");
    expect(queries[1]).toContain("from:hito-link.jp");
  });

  it("builds fallback queries even when companyName and eventDate are missing", () => {
    const queries = __buildMeetingUrlSearchQueriesForTests({
      fromDomain: "hito-link.jp",
      companyName: null,
      eventDate: null,
      mailDate: "Mon, 30 Mar 2026 09:00:00 +0900",
      subject: "<最終確認> 2次選考ご予約",
      from: "テクバン(株)新卒採用担当 <techvan-saiyo@hito-link.jp>",
    });
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries[0]).toContain("from:hito-link.jp");
    expect(queries[1]).toContain("after:");
    expect(queries[1]).toContain("before:");
  });
});

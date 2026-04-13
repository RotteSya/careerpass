import { describe, expect, it } from "vitest";
import { __extractMeetingUrlFromTextForTests, __inferInterviewStatusFromTextForTests } from "./gmail";

describe("gmail helpers", () => {
  it("maps 2次選考 to interview_2 when interview context exists", () => {
    const status = __inferInterviewStatusFromTextForTests("2次選考ご予約 Web面接（30～60分）");
    expect(status).toBe("interview_2");
  });

  it("maps 最終選考 to interview_final when selection context exists", () => {
    const status = __inferInterviewStatusFromTextForTests("最終選考のご案内 オンライン面接");
    expect(status).toBe("interview_final");
  });

  it("extracts meeting urls from text", () => {
    const url1 = __extractMeetingUrlFromTextForTests(
      "Please join: https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC?context=xyz"
    );
    expect(url1).toContain("teams.microsoft.com");

    const url2 = __extractMeetingUrlFromTextForTests("Join https://meet.google.com/abc-defg-hij to start");
    expect(url2).toBe("https://meet.google.com/abc-defg-hij");
  });
});


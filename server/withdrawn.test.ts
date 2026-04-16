import { describe, expect, it } from "vitest";
import { runRecruitingNlpPipeline } from "./mailNlpPipeline";

describe("Withdrawn outcome", () => {
  it("detects withdrawn from user", () => {
    const r = runRecruitingNlpPipeline({
      subject: "【辞退のご連絡】株式会社マーキュリー 採用選考",
      body: "大変勝手ながら、この度、選考を辞退させていただきたく、ご連絡差し上げました。",
      from: "Me <me@example.com>",
      domainSignal: 0,
      fallbackDate: null,
      fallbackTime: null
    });
    expect(r.eventType).toBe("rejection");
    expect(r._meta?.hardOutcome).toBe("withdrawn");
  });
});

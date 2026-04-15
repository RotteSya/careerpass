import { describe, expect, it } from "vitest";
import { runRecruitingNlpPipeline } from "./mailNlpPipeline";

describe("runRecruitingNlpPipeline event type overrides", () => {
  it("prefers deadline over interview when subject is an ES submission deadline (even if body mentions 面接)", () => {
    const r = runRecruitingNlpPipeline({
      subject: "【提出締切：5/8(金) 12:00】エントリーシート提出のお願い〈アニメイト〉",
      from: '"アニメイトグループ" <info-job@miws.mynavi.jp>',
      body: "面接の前にエントリーシートをご提出ください。提出期限を過ぎると無効となります。",
      domainSignal: 0.9,
      fallbackDate: "2026-05-08",
      fallbackTime: null,
    });
    expect(r.eventType).toBe("deadline");
  });

  it("prefers test over interview when subject is an assessment invitation (even if body mentions 面接)", () => {
    const r = runRecruitingNlpPipeline({
      subject: "【リコー】総合コース適性検査受検のご案内",
      from: "ricoh2027@e2r.jp",
      body: "面接の前に適性検査を受検してください。受検期限は2026/03/23です。",
      domainSignal: 0.9,
      fallbackDate: "2026-03-23",
      fallbackTime: null,
    });
    expect(r.eventType).toBe("test");
  });

  it("prefers deadline over interview when subject is document submission deadline (even if body mentions 面接)", () => {
    const r = runRecruitingNlpPipeline({
      subject: "【リマインドメール】書類提出期限",
      from: '"ルートイングループ　新卒採用チーム" <route_inn_hotels@saiyo.jp>',
      body: "面接の前に書類をご提出ください。提出期限は本日17:00です。",
      domainSignal: 0.9,
      fallbackDate: "2026-03-18",
      fallbackTime: null,
    });
    expect(r.eventType).toBe("deadline");
  });
});


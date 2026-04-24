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

  it("blocks mynavi interview-prep promos that are not real interview invitations", () => {
    const r = runRecruitingNlpPipeline({
      subject: "【3月27日(金)開催】〈30分で面接対策〉面接での回答例をご紹介します！【マイナビ新卒紹介】",
      from: '"マイナビ新卒紹介" <s-sk-tokyo-career2-cp@mynavi.jp>',
      body: "これから面接を受けられる方におすすめです。配信停止はこちら。",
      domainSignal: 0.9,
      fallbackDate: "2027-03-27",
      fallbackTime: null,
    });
    expect(r.isJobRelated).toBe(false);
    expect(r.eventType).toBe("other");
    expect(r.companyName).toBeNull();
  });

  it("blocks mynavi interview-prep promos even when they mention 一次面接", () => {
    const r = runRecruitingNlpPipeline({
      subject: "【3月19日(木)開催】＼一次面接対策／回答準備はできていますか？頻出質問の回答例をご紹介します！【マイナビ新卒紹介】",
      from: '"マイナビ新卒紹介" <s-sk-tokyo-career1-cp@mynavi.jp>',
      body: "面接対策セミナーのご案内です。配信停止はこちら。",
      domainSignal: 0.9,
      fallbackDate: "2027-03-19",
      fallbackTime: null,
    });
    expect(r.isJobRelated).toBe(false);
    expect(r.eventType).toBe("other");
    expect(r.companyName).toBeNull();
  });

  it("blocks platform learning events routed through applicant systems", () => {
    const r = runRecruitingNlpPipeline({
      subject: "【先着20名】面接対策をしたい方必見！選考通過率を上げる「模擬面接」イベント",
      from: '"グリーンハウス" <info-job@miws.mynavi.jp>',
      body: "模擬面接イベントのご案内です。",
      domainSignal: 0.7,
      fallbackDate: "2026-09-05",
      fallbackTime: null,
    });
    expect(r.isJobRelated).toBe(false);
    expect(r.eventType).toBe("other");
    expect(r.companyName).toBeNull();
  });

  it("blocks career platform forum venue promos", () => {
    const r = runRecruitingNlpPipeline({
      subject: "出展企業が追加決定！コンテンツの予約も開始！＜10/12(日)京都産業会館ホール＞",
      from: '"キャリタス就活フォーラム事務局" <support@career-tasu.jp>',
      body: "就活イベントのご案内です。出展企業の情報をご確認ください。",
      domainSignal: 0.6,
      fallbackDate: "2026-10-12",
      fallbackTime: null,
    });
    expect(r.isJobRelated).toBe(false);
    expect(r.eventType).toBe("other");
    expect(r.companyName).toBeNull();
  });

  it("blocks ITmedia recommended seminar newsletters", () => {
    const r = runRecruitingNlpPipeline({
      subject: "厳選セミナー「AIによる好循環が営業の未来を変える」ほか [おすすめのセミナー情報 2025/03/12]",
      from: '"アイティメディア セミナー事務局" <itmedia-seminar@noreply.itmedia.co.jp>',
      body: "おすすめのセミナー情報をお届けします。配信停止はこちら。",
      domainSignal: 0.85,
      fallbackDate: "2027-03-24",
      fallbackTime: null,
    });
    expect(r.isJobRelated).toBe(false);
    expect(r.eventType).toBe("other");
    expect(r.companyName).toBeNull();
  });
});

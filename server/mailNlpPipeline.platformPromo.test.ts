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

  it("blocks consumer service emails that share vocabulary with recruiting", () => {
    // Each of these previously slipped into the CSV via deadline/entry/
    // rejection rules (締切迫る / 予約受付完了 / 抽選結果 / unfortunately).
    const cases = [
      {
        subject: "【最大2ヶ月無料】締切迫る！この機会に再開しませんか？",
        from: '"chocoZAP" <no-reply@info.chocozap.jp>',
        body: "chocoZAPへの再入会キャンペーン締切迫る。",
      },
      {
        subject: "[LivePocket-Ticket-]抽選結果のお知らせ（81429487）",
        from: '"LivePocket-Ticket-" <noreply@livepocket.jp>',
        body: "抽選結果は残念ながら落選となりました。",
      },
      {
        subject: "[highwaybus.com]予約新規受付報告のお知らせ",
        from: '"highwaybus.com" <info@highwaybus.com>',
        body: "ご予約ありがとうございました。予約受付完了しました。",
      },
      {
        subject: "【e+より】支払期限のご案内",
        from: '"eplus" <info@eplus.co.jp>',
        body: "お支払い期限が迫っています。",
      },
      {
        subject: "WEST.／UVERworld／Saucy Dog 他 豪華アーティスト公演情報",
        from: '"ぴあ/音楽" <mail_info@pia.co.jp>',
        body: "ご縁がなく残念ながら抽選に外れました。",
      },
    ];
    for (const c of cases) {
      const r = runRecruitingNlpPipeline({
        ...c,
        domainSignal: 0.5,
        fallbackDate: "2026-05-01",
        fallbackTime: null,
      });
      expect(r.isJobRelated, `case=${c.subject}`).toBe(false);
      expect(r.eventType, `case=${c.subject}`).toBe("other");
      expect(r.companyName, `case=${c.subject}`).toBeNull();
      expect(r.reason, `case=${c.subject}`).toMatch(/non-recruiting/);
    }
  });

  it("blocks bounce/system sender emails (mailer-daemon, Google Forms receipt)", () => {
    for (const from of [
      '"Mail Delivery Subsystem" <mailer-daemon@googlemail.com>',
      '"Google Forms" <forms-receipts-noreply@google.com>',
    ]) {
      const r = runRecruitingNlpPipeline({
        subject: "Delivery Status Notification (Failure)",
        from,
        body: "Unfortunately the message could not be delivered.",
        domainSignal: 0,
        fallbackDate: null,
        fallbackTime: null,
      });
      expect(r.isJobRelated, from).toBe(false);
      expect(r.companyName, from).toBeNull();
    }
  });

  it("blocks mynavi part-time-job alert feed (mb-noreply-user@mynavi.jp)", () => {
    const r = runRecruitingNlpPipeline({
      subject: "オーケー北赤羽店/パート・アルバイトの求人情報",
      from: "mb-noreply-user@mynavi.jp",
      body: "新着の求人情報をお届けします。",
      domainSignal: 0.5,
      fallbackDate: "2026-05-01",
      fallbackTime: null,
    });
    expect(r.isJobRelated).toBe(false);
    expect(r.companyName).toBeNull();
  });

  it("still classifies real ATS-relay selection emails as job-related", () => {
    // Regression guard: the new non_recruiting gate must NOT swallow
    // applicant-management systems (axol / snar / saiyo.jp / miws / hrmos).
    const r = runRecruitingNlpPipeline({
      subject: "【株式会社サンプル】一次面接のご案内",
      from: '"株式会社サンプル 採用担当" <sample@mail.axol.jp>',
      body: "一次面接の日程調整をお願いします。2026年5月10日 10:00開始予定です。",
      domainSignal: 0.7,
      fallbackDate: "2026-05-10",
      fallbackTime: "10:00",
    });
    expect(r.isJobRelated).toBe(true);
    expect(r.eventType).toBe("interview");
    expect(r.companyName).toContain("株式会社サンプル");
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

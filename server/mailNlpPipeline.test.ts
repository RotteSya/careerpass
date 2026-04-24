import { describe, expect, it } from "vitest";
import { runRecruitingNlpPipeline } from "./mailNlpPipeline";
import { MAX_MAIL_BODY_CHARS } from "./_core/mailText";

describe("runRecruitingNlpPipeline", () => {
  // ─── Existing tests (preserved) ──────────────────────────────────────────

  it("skips obvious platform noise before LLM", () => {
    const d = runRecruitingNlpPipeline({
      subject: "OpenWork 新着口コミのお知らせ",
      body: "あなたへの新着通知があります",
      from: "noreply@openwork.jp",
      domainSignal: 0.6,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.shouldSkipLlm).toBe(true);
    expect(d.isJobRelated).toBe(false);
    expect(d.eventType).toBe("other");
  });

  it("promotes hard rejection outcomes over uncertain LLM output", () => {
    const d = runRecruitingNlpPipeline(
      {
        subject: "選考結果のご連絡",
        body: "誠に残念ながら今回は見送りとなりました。",
        from: "hr@example.co.jp",
        domainSignal: 0.95,
        fallbackDate: null,
        fallbackTime: null,
      },
      {
        isJobRelated: true,
        confidence: 0.6,
        reason: "llm",
        eventType: "other",
      },
    );
    expect(d.eventType).toBe("rejection");
    expect(d.isJobRelated).toBe(true);
  });

  it("merges date/time fallback when LLM does not provide them", () => {
    const d = runRecruitingNlpPipeline(
      {
        subject: "面接のご案内",
        body: "一次面接のご案内です",
        from: "recruit@sample.co.jp",
        domainSignal: 0.95,
        fallbackDate: "2026-04-20",
        fallbackTime: "13:00",
      },
      {
        isJobRelated: true,
        confidence: 0.9,
        reason: "llm",
        eventType: "interview",
        eventDate: null,
        eventTime: null,
      },
    );
    expect(d.eventDate).toBe("2026-04-20");
    expect(d.eventTime).toBe("13:00");
  });

  it("extracts company from hiring display name and normalizes it", () => {
    const d = runRecruitingNlpPipeline(
      {
        subject: "面接日程のご案内",
        body: "日程調整フォームをご確認ください。",
        from: "株式会社サンプル 採用担当 <recruit@sample.co.jp>",
        domainSignal: 0.95,
        fallbackDate: null,
        fallbackTime: null,
      },
      {
        isJobRelated: true,
        confidence: 0.8,
        reason: "llm",
        eventType: "interview",
        companyName: null,
      },
    );
    expect(d.companyName).toBe("株式会社サンプル");
  });

  it("uses stronger test rule for online assessment mails", () => {
    const d = runRecruitingNlpPipeline(
      {
        subject: "Online Assessmentのご案内",
        body: "受検期限までに coding test を完了してください。",
        from: "noreply@careers.example.co.jp",
        domainSignal: 0.9,
        fallbackDate: null,
        fallbackTime: null,
      },
      {
        isJobRelated: true,
        confidence: 0.6,
        reason: "llm",
        eventType: "other",
      },
    );
    expect(d.eventType).toBe("test");
  });

  // ─── New tests: Multi-signal scoring ─────────────────────────────────────

  it("picks rejection over interview when body contains rejection keywords", () => {
    const d = runRecruitingNlpPipeline({
      subject: "面接結果のご連絡",
      body: "先日の面接について、誠に残念ながらご期待に添えない結果となりました。",
      from: "hr@company.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    // Hard rule: rejection beats interview
    expect(d.eventType).toBe("rejection");
  });

  it("detects rejection for 希望に沿いかねる result phrasing", () => {
    const d = runRecruitingNlpPipeline({
      subject: "選考結果のご連絡",
      body:
        "この度はご応募ありがとうございました。厳正な選考の結果、今回はご希望に沿いかねる結果となりました。",
      from: "saiyo@example.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.eventType).toBe("rejection");
  });

  it("picks offer over interview when body contains offer keywords", () => {
    const d = runRecruitingNlpPipeline({
      subject: "最終面接結果のご連絡",
      body: "この度、内定のご連絡をさせていただきます。",
      from: "hr@company.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.eventType).toBe("offer");
  });

  // ─── New tests: Domain reputation ────────────────────────────────────────

  it("boosts confidence for corporate .co.jp domains", () => {
    const d = runRecruitingNlpPipeline({
      subject: "説明会のご案内",
      body: "オンライン説明会を開催いたします",
      from: "recruit@toyota.co.jp",
      domainSignal: 0.85,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.isJobRelated).toBe(true);
    expect(d.eventType).toBe("briefing");
    expect(d._meta?.domainReputation.tier).toBe("corporate_jp");
  });

  it("handles free-mail domain with lower domain reputation", () => {
    const d = runRecruitingNlpPipeline({
      subject: "面接のお願い",
      body: "面接のご案内です",
      from: "tanaka@gmail.com",
      domainSignal: 0.1,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d._meta?.domainReputation.tier).toBe("free_mail");
    // Still detects interview from keyword rules
    expect(d.eventType).toBe("interview");
  });

  // ─── New tests: Negative signal detection ────────────────────────────────

  it("detects negative signals in marketing emails", () => {
    const d = runRecruitingNlpPipeline({
      subject: "あなたにおすすめの求人情報",
      body: "新着求人をお届けします。配信停止はこちら。キャンペーン実施中！",
      from: "newsletter@jobsite.com",
      domainSignal: 0.5,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d._meta?.negPenalty).toBeLessThan(0);
  });

  it("skips noise platform emails with strong negative signals", () => {
    const d = runRecruitingNlpPipeline({
      subject: "【就活会議】年収ランキング更新",
      body: "最新の口コミ・年収データをチェック。配信停止はこちら",
      from: "noreply@syukatsu-kaigi.jp",
      domainSignal: 0.3,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.shouldSkipLlm).toBe(true);
    expect(d.isJobRelated).toBe(false);
  });

  // ─── New tests: NER company name extraction ──────────────────────────────

  it("extracts company from legal entity in subject", () => {
    const d = runRecruitingNlpPipeline({
      subject: "【株式会社メルカリ】一次面接のご案内",
      body: "下記日程で面接を実施いたします。",
      from: "recruit@mercari.com",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.companyName).toBe("株式会社メルカリ");
  });

  it("extracts company from inverted legal name", () => {
    const d = runRecruitingNlpPipeline({
      subject: "サイバーエージェント株式会社 説明会のご案内",
      body: "会社説明会にご参加ください。",
      from: "recruit@cyberagent.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    // Should contain サイバーエージェント
    expect(d.companyName).toContain("サイバーエージェント");
  });

  it("does not use platform name as company name", () => {
    const d = runRecruitingNlpPipeline({
      subject: "リクナビからのお知らせ",
      body: "説明会の予約が確認されました。",
      from: "info@rikunabi.com",
      domainSignal: 0.7,
      fallbackDate: null,
      fallbackTime: null,
    });
    // rikunabi is a platform, not a company
    expect(d.companyName).not.toBe("リクナビ");
    expect(d.companyName).not.toBe("rikunabi");
  });

  // ─── New tests: NER date/time extraction ─────────────────────────────────

  it("extracts date from Japanese format in body", () => {
    const d = runRecruitingNlpPipeline({
      subject: "面接日程のご案内",
      body: "面接日時：2026年5月1日(金) 14:00〜15:00\n場所：オンライン（Zoom）",
      from: "hr@example.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.eventDate).toBe("2026-05-01");
    expect(d.eventTime).toBe("14:00");
  });

  // ─── New tests: NER location extraction ──────────────────────────────────

  it("extracts location from body", () => {
    const d = runRecruitingNlpPipeline({
      subject: "二次面接のご案内",
      body: "面接会場: 東京都渋谷区道玄坂1-2-3 ABCビル5F\n日時: 2026年5月10日 10:00",
      from: "hr@example.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.location).toContain("東京都渋谷区");
  });

  it("detects online interview location", () => {
    const d = runRecruitingNlpPipeline({
      subject: "最終面接のご案内",
      body: "オンライン面接で実施いたします。Zoom URLは追ってお送りします。",
      from: "hr@example.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.location).toContain("オンライン面接");
  });

  // ─── New tests: Interview round detection ────────────────────────────────

  it("detects interview round from text", () => {
    const d = runRecruitingNlpPipeline({
      subject: "二次面接のご案内",
      body: "二次面接の日程をご案内します。",
      from: "hr@example.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d._meta?.interviewRound).toBe("2nd");
  });

  it("detects final interview round", () => {
    const d = runRecruitingNlpPipeline({
      subject: "最終面接のご案内",
      body: "最終面接を実施いたします。",
      from: "hr@example.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d._meta?.interviewRound).toBe("final");
  });

  // ─── New tests: Co-occurrence boosting ───────────────────────────────────

  it("boosts interview confidence when date is present near 面接 keyword", () => {
    const withDate = runRecruitingNlpPipeline({
      subject: "面接のご案内",
      body: "2026年5月10日 14:00に面接を実施いたします。",
      from: "hr@example.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    const withoutDate = runRecruitingNlpPipeline({
      subject: "面接のご案内",
      body: "面接についてご連絡します。",
      from: "hr@example.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    // Both should be interview, but with-date should have higher confidence
    expect(withDate.eventType).toBe("interview");
    expect(withoutDate.eventType).toBe("interview");
    expect(withDate.confidence).toBeGreaterThanOrEqual(withoutDate.confidence);
  });

  // ─── New tests: LLM merge behavior ──────────────────────────────────────

  it("prefers LLM event type over rule when rule is uncertain", () => {
    const d = runRecruitingNlpPipeline(
      {
        subject: "今後の選考についてのご連絡",
        body: "選考プロセスの次のステップをご案内します。",
        from: "hr@example.co.jp",
        domainSignal: 0.9,
        fallbackDate: null,
        fallbackTime: null,
      },
      {
        isJobRelated: true,
        confidence: 0.85,
        reason: "llm:interview-invite",
        eventType: "interview",
      },
    );
    expect(d.eventType).toBe("interview");
  });

  it("hard-rule offer overrides LLM rejection classification", () => {
    const d = runRecruitingNlpPipeline(
      {
        subject: "内定通知",
        body: "この度は内定のご連絡です。",
        from: "hr@example.co.jp",
        domainSignal: 0.9,
        fallbackDate: null,
        fallbackTime: null,
      },
      {
        isJobRelated: true,
        confidence: 0.7,
        reason: "llm",
        eventType: "rejection",
      },
    );
    expect(d.eventType).toBe("offer");
  });

  // ─── New tests: Edge cases ───────────────────────────────────────────────

  it("handles empty body gracefully", () => {
    const d = runRecruitingNlpPipeline({
      subject: "面接のご案内",
      body: "",
      from: "hr@example.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.eventType).toBe("interview");
    expect(d.isJobRelated).toBe(true);
  });

  it("handles English rejection email", () => {
    const d = runRecruitingNlpPipeline({
      subject: "Application Update",
      body: "We regret to inform you that we will not be moving forward with your application.",
      from: "careers@globalcorp.com",
      domainSignal: 0.6,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.eventType).toBe("rejection");
  });

  it("detects entry confirmation", () => {
    const d = runRecruitingNlpPipeline({
      subject: "エントリー完了のお知らせ",
      body: "株式会社テストへのエントリーが完了しました。ご応募ありがとうございます。",
      from: "noreply@test-corp.co.jp",
      domainSignal: 0.85,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.eventType).toBe("entry");
    expect(d.isJobRelated).toBe(true);
  });

  it("detects deadline with specific date", () => {
    const d = runRecruitingNlpPipeline({
      subject: "ES提出期限のお知らせ",
      body: "エントリーシートの提出期限は2026年5月15日です。期限までにご提出ください。",
      from: "hr@example.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.eventType).toBe("deadline");
    expect(d.eventDate).toBe("2026-05-15");
  });

  it("detects SPI/Web test invitation", () => {
    const d = runRecruitingNlpPipeline({
      subject: "適性検査(SPI)受検のご案内",
      body: "下記URLより適性検査を受検してください。受検期限: 2026年5月20日",
      from: "noreply@spi-test.co.jp",
      domainSignal: 0.8,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.eventType).toBe("test");
  });

  // ─── Bug fix: platform newsletter company extraction ─────────────────────

  it("does not extract ダイナム from マイナビ newsletter body", () => {
    const d = runRecruitingNlpPipeline({
      subject: "マイナビメール2027★ピックアップ★",
      body: "初めまして！ダイナム採用担当です。株式会社ダイナムは全国に店舗展開...\n説明会にご参加ください\n配信停止はこちら",
      from: "job-s27@mynavi.jp",
      domainSignal: 0.7,
      fallbackDate: null,
      fallbackTime: null,
    });
    // Should NOT extract ダイナム as company — it's from a platform newsletter
    expect(d.companyName === null || !d.companyName.includes("ダイナム")).toBe(true);
  });

  it("blocks recruiting platform newsletter with negative signals", () => {
    const d = runRecruitingNlpPipeline({
      subject: "マイナビメール2027★ピックアップ★",
      body: "新着求人をお届け！おすすめ企業のご紹介\n配信停止はこちら\n説明会情報あり",
      from: "job-s27@mynavi.jp",
      domainSignal: 0.5,
      fallbackDate: null,
      fallbackTime: null,
    });
    // Should be marked as noise due to recruiting_platform + negative signals
    expect(d.shouldSkipLlm).toBe(true);
    expect(d.isJobRelated).toBe(false);
  });

  it("blocks mynavi survey + incentive mails even if they include a deadline", () => {
    const d = runRecruitingNlpPipeline({
      subject: "【4月18日〆切】抽選で500名にAmazonギフトカード500円分が当たります！ ◆◇2027年卒大学生業界イメージ調査◇◆ご協力のお願い",
      body:
        "こんにちは。こちらはマイナビアンケート事務局です。\n" +
        "業界イメージに関するアンケートの、ご協力のお願いです。\n" +
        "回答者の中から抽選でAmazonギフトコードをプレゼントいたします！\n" +
        "【回答〆切】4月18日（土）23：59\n" +
        "配信の停止 https://job.mynavi.jp/27/pc/jump?key=xxx\n" +
        "回答フォームはこちら https://questant.jp/q/HDK0QA4K",
      from: "マイナビ2027 <job-s27@mynavi.jp>",
      domainSignal: 0.7,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.shouldSkipLlm).toBe(true);
    expect(d.isJobRelated).toBe(false);
    expect(d.eventType).toBe("other");
  });

  it("blocks mynavi pickup newsletters that look like ads even if they mention briefing/selection words", () => {
    const d = runRecruitingNlpPipeline({
      subject:
        "初任給30万円×年休126日へ待遇UP■60分WEB説明会のご案内！人を笑顔にするなら、自分も楽しく！【マイナビメール2027ピックアップ 4/11】",
      body:
        "━━━マイナビメール2027[ピックアップ]━\n" +
        "初めまして！ダイナム採用担当です。\n" +
        "WEB説明会のご案内です。\n" +
        "選考フロー 1次選考→2次選考→最終選考→内々定\n" +
        "配信の停止 https://job.mynavi.jp/27/pc/jump?key=xxx",
      from: "マイナビ2027 <job-s27@mynavi.jp>",
      domainSignal: 0.7,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.shouldSkipLlm).toBe(true);
    expect(d.isJobRelated).toBe(false);
    expect(d.eventType).toBe("other");
  });

  it("detects hrmos rejection mail correctly (オロ)", () => {
    const d = runRecruitingNlpPipeline({
      subject: "【オロ】選考結果のご連絡｜ＳＨＥ ＬＩＮＧＺＨＡＯ様",
      body:
        "株式会社オロ 人事採用チームです。\n" +
        "この度は選考に参加いただき、誠にありがとうございました。\n" +
        "その結果、残念ながらＳＨＥ様の採用をお見送りとさせていただくことになりました。",
      from: "株式会社オロ 採用担当 <2245720181511430144.candidate@orocoltd.n-ats.hrmos.co>",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.shouldSkipLlm).toBe(true);
    expect(d.isJobRelated).toBe(true);
    expect(d.eventType).toBe("rejection");
    expect(d.companyName).toBe("株式会社オロ");
  });

  it("does not misclassify 'inspire' as SPI test", () => {
    const d = runRecruitingNlpPipeline({
      subject: "Meet Slides: Presentations Made Effortless",
      body: "Turn your travel dreams into stunning presentation decks that inspire wanderlust.",
      from: "Manus Team <info@news.manus.im>",
      domainSignal: 0.6,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.eventType).toBe("other");
    expect(d.isJobRelated).toBe(false);
  });

  it("does not treat corporate newsletters as job-related only because they have a date header", () => {
    const d = runRecruitingNlpPipeline({
      subject: "Amazonビジネスはお客様のご意見をお待ちしています",
      body: "アンケートにご協力ください。配信停止はこちら。",
      from: '"Amazonビジネス" <no-reply@business.amazon.co.jp>',
      domainSignal: 0.85,
      fallbackDate: "2026-05-01",
      fallbackTime: null,
    });
    expect(d.eventType).toBe("other");
    expect(d.isJobRelated).toBe(false);
  });

  it("blocks marketing mails with strong negative signals even if they contain the word 'briefing'", () => {
    const d = runRecruitingNlpPipeline({
      subject: "Your Journey Begins Now",
      body:
        "Perfect for pitches, meetings, and briefings.\n" +
        "This is a newsletter campaign email.\n" +
        "Unsubscribe here: https://example.com/unsubscribe",
      from: "Manus Team <info@news.manus.im>",
      domainSignal: 0.6,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.eventType).toBe("other");
    expect(d.isJobRelated).toBe(false);
  });

  it("detects rejection for 希望に添いかねる result phrasing (メイテックフィルダーズ)", () => {
    const d = runRecruitingNlpPipeline({
      subject: "【メイテックフィルダーズ】【重要】一次選考結果のご連絡",
      body:
        "この度は一次面接へのご参加、ありがとうございました。\n" +
        "慎重かつ厳正に検討させていただきました結果、今回は誠に残念ながらご希望に添いかねる結果となりました。",
      from: "メイテックフィルダーズ新卒採用 <meitecgr-recruit@snar.jp>",
      domainSignal: 0.8,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.shouldSkipLlm).toBe(true);
    expect(d.isJobRelated).toBe(true);
    expect(d.eventType).toBe("rejection");
    expect(d.companyName).toContain("メイテックフィルダーズ");
  });

  it("extracts interview datetime + company from hito-link web interview confirmation (テクバン)", () => {
    const d = runRecruitingNlpPipeline({
      subject: "<最終確認> 2次選考ご予約 ※事前に履歴書をご提出ください【テクバン株式会社 新卒採用担当】",
      body:
        "テクバン株式会社 新卒採用担当です。\n" +
        "開催日時\n2026/03/26　11:00 ～ 12:00\n" +
        "■選考内容\nWeb面接（30～60分）\n" +
        "Teamsアプリのダウンロードを事前に行っていただく必要があります。",
      from: "テクバン(株)新卒採用担当 <techvan-saiyo@hito-link.jp>",
      domainSignal: 0.85,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.shouldSkipLlm).toBe(true);
    expect(d.isJobRelated).toBe(true);
    expect(d.eventType).toBe("interview");
    expect(d.companyName).toContain("テクバン");
    expect(d.eventDate).toBe("2026-03-26");
    expect(d.eventTime).toBe("11:00");
    expect(d.location).toContain("Web");
  });

  it("keeps actionable mynavi process mail as job-related instead of noise", () => {
    const d = runRecruitingNlpPipeline({
      subject: "【サンプルホールディングス】エントリーシート提出の御礼",
      body:
        "このメールはマイナビの応募者管理システムです。\n今後のスケジュール:\n・カジュアル面談(Web)\n・適正検査\n・面接(個別)\n・内定",
      from: "株式会社サンプルホールディングス <info-job@miws.mynavi.jp>",
      domainSignal: 0.7,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.shouldSkipLlm).toBe(false);
    expect(d.isJobRelated).toBe(true);
    expect(d.eventType).not.toBe("other");
    expect(d.companyName).toContain("サンプルホールディングス");
  });

  // ─── Bug fix: stray quote in company name ────────────────────────────────

  it("strips leading quote from LLM company name", () => {
    const d = runRecruitingNlpPipeline(
      {
        subject: "面接のご案内",
        body: "面接のご案内です。",
        from: "hr@example.co.jp",
        domainSignal: 0.9,
        fallbackDate: null,
        fallbackTime: null,
      },
      {
        isJobRelated: true,
        confidence: 0.85,
        reason: "llm",
        eventType: "interview",
        companyName: '"メイテックフィルダーズ',
      },
    );
    expect(d.companyName).not.toMatch(/^"/);
    expect(d.companyName).toBe("メイテックフィルダーズ");
  });

  it("normalizes ミライト・ワン variants to canonical company name", () => {
    const d = runRecruitingNlpPipeline({
      subject: "【ミライト・ワン】説明会にご参加いただきありがとうございました",
      body:
        "ミライト・ワン 採用担当です。マイページをご確認ください。\n\n株式会社ミライト・ワン",
      from: "ミライト・ワン <mirait@mail.axol.jp>",
      domainSignal: 0.8,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.companyName).toBe("株式会社ミライト・ワン");
  });

  it("prefers LLM company name when NER confidence is below 0.70", () => {
    // Free-mail sender with only the "display clean" NER strategy available
    // (confidence 0.55 < 0.70) — the LLM-supplied name should take over.
    const d = runRecruitingNlpPipeline(
      {
        subject: "面接のご案内",
        body: "面接のご案内です。",
        from: "Taro Yamada <taro@gmail.com>",
        domainSignal: 0.2,
        fallbackDate: null,
        fallbackTime: null,
      },
      {
        isJobRelated: true,
        confidence: 0.9,
        reason: "llm",
        eventType: "interview",
        companyName: "株式会社テストカンパニー",
      },
    );
    expect(d.companyName).toBe("株式会社テストカンパニー");
  });

  it("marks _meta.inputBodyTruncated when body is too long", () => {
    const body = "x".repeat(MAX_MAIL_BODY_CHARS + 100) + "面接のご案内";
    const d = runRecruitingNlpPipeline({
      subject: "面接のご案内",
      body,
      from: "hr@company.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d._meta?.inputBodyTruncated).toBe(true);
    expect(d._meta?.inputBodyUsedLength).toBe(MAX_MAIL_BODY_CHARS);
  });

  it("still catches offer keyword that lives only in the tail of a long body", () => {
    // 30k of filler followed by the 内定通知 sentence — head-only
    // truncation would drop the decisive keyword.
    const filler = "a".repeat(30_000);
    const body = `${filler}\n本日は誠にありがとうございました。内定通知をお送りいたします。`;
    const d = runRecruitingNlpPipeline({
      subject: "ご連絡",
      body,
      from: "hr@example.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d._meta?.inputBodyTruncated).toBe(true);
    expect(d.eventType).toBe("offer");
  });
});

import type { NudgeRule, ProactiveNudge, UserJobContext } from "../types";

const SUGGESTIONS: Record<string, Record<"ja" | "zh" | "en", { title: string; body: string }>> = {
  researching: {
    ja: { title: "調査中の企業があります", body: "エントリーの期限を確認して、ES の核になる素材を2つ（志望動機・自己PR）準備しましょう。" },
    zh: { title: "有企业在调研中", body: "确认投递岗位与截止时间，准备 ES 的两段核心素材（志望动机/自己PR）。" },
    en: { title: "Company in research", body: "Check the application deadline and prepare two core ES materials: motivation and self-PR." },
  },
  applied: {
    ja: { title: "エントリー済み", body: "網申が完了したか確認して、必要書類と期限をリストアップしましょう。" },
    zh: { title: "已提交申请", body: "确认网申是否完成并保存凭证，补齐后续材料清单与截止日期。" },
    en: { title: "Application submitted", body: "Confirm your online application is complete and list remaining documents and deadlines." },
  },
  briefing: {
    ja: { title: "説明会の予定があります", body: "日程と参加方法を確認して、その企業・岗位に絞った質問を2つ用意しましょう。" },
    zh: { title: "有说明会安排", body: "确认说明会时间与参加方式，准备 2 个聚焦岗位的问题。" },
    en: { title: "Briefing scheduled", body: "Confirm the schedule and format, prepare 2 focused questions about the role." },
  },
  es_preparing: {
    ja: { title: "ES 準備中", body: "志望動機を5文で書き出し（企業の課題→あなたの力→なぜ今）、自己PRに使えるSTAR 実例を1つ整理しましょう。" },
    zh: { title: "ES 准备中", body: "把志望动机写成 5 句（公司痛点→你的能力→为什么现在），整理 1 个可量化 STAR 案例用于自己PR。" },
    en: { title: "ES in progress", body: "Draft your motivation in 5 sentences (company pain → your strength → why now), and prepare one quantifiable STAR example for self-PR." },
  },
  es_submitted: {
    ja: { title: "ES 提出完了！", body: "面接に備えて30秒の自己紹介を準備して、逆質問を3つ用意しましょう。" },
    zh: { title: "ES 已提交！", body: "准备面试用的 30 秒自我介绍，准备 3 个高价值逆質問。" },
    en: { title: "ES submitted!", body: "Prepare a 30-second self-introduction for interviews and 3 strong reverse-questions." },
  },
  document_screening: {
    ja: { title: "書類選考中", body: "選考の目安期間を確認して、面接のよくある質問と根拠エピソードを先に準備しましょう。" },
    zh: { title: "書類選考中", body: "确认筛选周期与反馈时间，先准备常见面试题与案例证据。" },
    en: { title: "Document screening", body: "Check the typical screening period and prepare common interview answers with supporting evidence." },
  },
  written_test: {
    ja: { title: "筆記試験の案内が来ています", body: "試験範囲とプラットフォームを確認して、制限時間付きの模擬問題を1セット解いてみましょう。" },
    zh: { title: "有笔试通知", body: "确认笔试范围与平台，做一套时限模拟题并复盘错题。" },
    en: { title: "Written test notice", body: "Confirm the test scope and platform, then do one timed practice set and review mistakes." },
  },
  interview_1: {
    ja: { title: "一次面接に向けて", body: "動機・強み・失敗経験を整理して、ES の一文一文に深掘りされる覚悟を持ちましょう。" },
    zh: { title: "准备一面", body: "整理面试题库：动机/强项/失败经历，把 ES 的每一句都准备可追问的证据。" },
    en: { title: "Preparing for 1st interview", body: "Organize your answers: motivation, strengths, failure stories. Prepare follow-up evidence for every ES sentence." },
  },
  interview_2: {
    ja: { title: "二次面接に向けて", body: "キャリアプランとポジションの一致を論理的に繋げて、「プロジェクト推進」の深掘り事例を1つ用意しましょう。" },
    zh: { title: "准备二面", body: "补齐职业规划与岗位匹配的逻辑链，准备 1 个'你如何推进项目'的深挖案例。" },
    en: { title: "Preparing for 2nd interview", body: "Build a logical chain between your career plan and the role, and prepare one deep-dive 'project execution' example." },
  },
  interview_3: {
    ja: { title: "三次面接に向けて", body: "チーム間協力とストレス耐性の事例を補強して、ビジネス理解と価値貢献を語れるようにしましょう。" },
    zh: { title: "准备三面", body: "补充跨团队协作与抗压案例，准备对业务理解和价值贡献的回答。" },
    en: { title: "Preparing for 3rd interview", body: "Strengthen cross-team collaboration and stress-resilience examples, and articulate your business understanding and value contribution." },
  },
  interview_4: {
    ja: { title: "四次面接に向けて", body: "経営層が注目する入社動機と長期ビジョンを整理して、最終ラウンドの質問リストと条件確認項を準備しましょう。" },
    zh: { title: "准备四面", body: "准备高层关注点：入社动机与长期发展，确认最后一轮的提问清单和条件确认项。" },
    en: { title: "Preparing for 4th interview", body: "Prepare executive-level talking points: motivation and long-term vision. List final questions and condition confirmations." },
  },
  interview_final: {
    ja: { title: "最終面接に向けて", body: "入社への意欲と価値観の一致を整理して、給与・条件・入社日の確認質問を準備しましょう。" },
    zh: { title: "准备终面", body: "准备入社动机与价值观对齐，准备薪资/条件/入社时间的确认问题。" },
    en: { title: "Preparing for final interview", body: "Clarify your motivation and value alignment, and prepare questions about salary, conditions, and start date." },
  },
  offer: {
    ja: { title: "🎉 内定が出ました！", body: "条件（入社日・勤務地・待遇）を確認して、比較・判断の基準を整理しましょう。" },
    zh: { title: "🎉 收到内定！", body: "确认条件（入社时间/勤務地/待遇），准备对比与决策标准。" },
    en: { title: "🎉 Offer received!", body: "Confirm the conditions (start date, location, compensation) and organize your comparison criteria." },
  },
  rejected: {
    ja: { title: "残念な結果です", body: "1つの重要な反省点を書き直して、その経験を次の企業の応募に活かしましょう。" },
    zh: { title: "遗憾未通过", body: "复盘 1 个关键失分点并改写答案，把经验迁移到下一家公司投递。" },
    en: { title: "Unfortunately not selected", body: "Rewrite one key weakness from your answers and apply that lesson to the next application." },
  },
  withdrawn: {
    ja: { title: "辞退しました", body: "辞退の理由と学んだ選択基準をメモして、投稿優先度リストを更新しましょう。" },
    zh: { title: "已撤回", body: "记录撤回原因与学到的筛选标准，更新投递优先级列表。" },
    en: { title: "Application withdrawn", body: "Note your reason and selection criteria learned, and update your application priority list." },
  },
};

const STATUS_TRANSITION_WINDOW_HOURS = 24;
const TERMINAL_STATUSES = new Set(["offer", "rejected", "withdrawn"]);

export const statusSuggestionsRule: NudgeRule = {
  id: "status_suggestion",
  category: "status_suggestion",

  evaluate(context: UserJobContext): ProactiveNudge[] {
    const nudges: ProactiveNudge[] = [];
    const cutoff = new Date(context.now.getTime() - STATUS_TRANSITION_WINDOW_HOURS * 60 * 60 * 1000);

    for (const app of context.applications) {
      if (TERMINAL_STATUSES.has(app.status) && app.status !== "offer") continue;

      const lastEvent = app.lastStatusEventAt ?? app.updatedAt;
      if (lastEvent < cutoff) continue;

      const lang = context.preferredLanguage;
      const suggestion = SUGGESTIONS[app.status];
      if (!suggestion) continue;

      const localized = suggestion[lang] ?? suggestion.zh;
      nudges.push({
        userId: context.userId,
        category: "status_suggestion",
        jobApplicationId: app.id,
        companyName: app.companyNameJa,
        priority: TERMINAL_STATUSES.has(app.status) ? "high" : "medium",
        title: localized.title,
        body: localized.body,
        scheduledAt: context.now,
        expiresAt: new Date(context.now.getTime() + 48 * 60 * 60 * 1000),
      });
    }

    return nudges;
  },
};

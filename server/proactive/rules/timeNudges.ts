import type { NudgeRule, ProactiveNudge, UserJobContext } from "../types";

const TERMINAL_STATUSES = new Set(["offer", "rejected", "withdrawn"]);
const INTERVIEW_STATUSES = new Set([
  "interview_1", "interview_2", "interview_3", "interview_4", "interview_final",
]);

const STALE_APP_DAYS = 14;
const ABANDON_SUGGESTION_DAYS = 30;
const INACTIVITY_DAYS = 7;
const DEADLINE_WARNING_DAYS = 3;
const POST_INTERVIEW_SILENCE_DAYS = 5;

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000);
}

const MESSAGES = {
  stale: {
    ja: { title: "選考が止まっていませんか？", body: "「{company}」のステータスが{days}日更新されていません。進捗を確認するか、フォローアップの連絡を検討しましょう。" },
    zh: { title: "某公司选考停滞了？", body: "「{company}」已经 {days} 天没有状态更新，建议确认进度或主动跟进。" },
    en: { title: "Application stalled?", body: "No update on \"{company}\" for {days} days. Consider checking the status or sending a follow-up." },
  },
  inactive: {
    ja: { title: "最近活動がありません", body: "ここ{days}日間、新しい投稿や更新がありません。気になる企業を調べて、次の一歩を踏み出しましょう。" },
    zh: { title: "最近没有活动", body: "已经 {days} 天没有新的投递或更新了，看看感兴趣的企业，迈出下一步吧。" },
    en: { title: "No recent activity", body: "No new applications or updates in {days} days. Explore companies you're interested in and take the next step." },
  },
  deadline: {
    ja: { title: "⏰ 期限が近づいています", body: "「{company}」の次のアクション期限まであと{days}日です。準備を進めましょう。" },
    zh: { title: "⏰ 截止日期临近", body: "「{company}」的下一步行动截止还有 {days} 天，抓紧准备吧。" },
    en: { title: "⏰ Deadline approaching", body: "Only {days} days left for the next action on \"{company}\". Get ready!" },
  },
  postInterview: {
    ja: { title: "面接後のフォローアップ", body: "「{company}」の面接から{days}日経ちました。お礼メールや進捗確認の連絡を検討しましょう。" },
    zh: { title: "面试后跟进", body: "「{company}」面试后已过 {days} 天，考虑发送感谢信或确认进度。" },
    en: { title: "Post-interview follow-up", body: "It's been {days} days since your interview with \"{company}\". Consider sending a thank-you note or checking the status." },
  },
  abandonSuggestion: {
    ja: { title: "放置中の選考があります", body: "「{company}」は{days}日以上ステータス更新がありません。まだ進めるならフォローアップ、動かさないなら辞退済みとして整理するか確認しましょう。" },
    zh: { title: "有公司可能该整理了", body: "「{company}」已经 {days} 天以上没有状态进展。还想继续就跟进一下；不打算继续的话，可以确认后标记为放弃。" },
    en: { title: "Application may need cleanup", body: "No status progress on \"{company}\" for {days}+ days. Follow up if you're still pursuing it, or confirm and mark it withdrawn if not." },
  },
};

function localize(
  msgs: Record<"ja" | "zh" | "en", { title: string; body: string }>,
  lang: "ja" | "zh" | "en",
  vars: Record<string, string | number>
): { title: string; body: string } {
  const m = msgs[lang] ?? msgs.zh;
  let title = m.title;
  let body = m.body;
  for (const [k, v] of Object.entries(vars)) {
    title = title.replace(`{${k}}`, String(v));
    body = body.replace(`{${k}}`, String(v));
  }
  return { title, body };
}

// Stale application: non-terminal with no status change for 14+ days
const staleAppRule: NudgeRule = {
  id: "time_nudge_stale",
  category: "time_nudge",
  evaluate(context: UserJobContext): ProactiveNudge[] {
    const nudges: ProactiveNudge[] = [];
    for (const app of context.applications) {
      if (TERMINAL_STATUSES.has(app.status)) continue;
      const lastEvent = app.lastStatusEventAt ?? app.updatedAt;
      const daysSince = daysBetween(lastEvent, context.now);
      if (daysSince < STALE_APP_DAYS || daysSince >= ABANDON_SUGGESTION_DAYS) continue;

      const msg = localize(MESSAGES.stale, context.preferredLanguage, {
        company: app.companyNameJa,
        days: Math.floor(daysSince),
      });
      nudges.push({
        userId: context.userId,
        category: "time_nudge",
        jobApplicationId: app.id,
        companyName: app.companyNameJa,
        priority: "medium",
        ...msg,
        scheduledAt: context.now,
        expiresAt: new Date(context.now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });
    }
    return nudges;
  },
};

// Abandon suggestion: non-terminal with no status progress for 30+ days.
// This does not mutate the board; it asks the user to confirm whether to
// follow up or mark the application as withdrawn.
const abandonSuggestionRule: NudgeRule = {
  id: "follow_up_abandon_suggestion",
  category: "follow_up",
  evaluate(context: UserJobContext): ProactiveNudge[] {
    const nudges: ProactiveNudge[] = [];
    for (const app of context.applications) {
      if (TERMINAL_STATUSES.has(app.status)) continue;
      if (app.nextActionAt && app.nextActionAt > context.now) continue;

      const lastEvent = app.lastStatusEventAt ?? app.updatedAt;
      const daysSince = daysBetween(lastEvent, context.now);
      if (daysSince < ABANDON_SUGGESTION_DAYS) continue;

      const msg = localize(MESSAGES.abandonSuggestion, context.preferredLanguage, {
        company: app.companyNameJa,
        days: ABANDON_SUGGESTION_DAYS,
      });
      nudges.push({
        userId: context.userId,
        category: "follow_up",
        jobApplicationId: app.id,
        companyName: app.companyNameJa,
        priority: "low",
        ...msg,
        scheduledAt: context.now,
        expiresAt: new Date(context.now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });
    }
    return nudges;
  },
};

// Inactivity: no active applications with updates in the last 7 days
const inactivityRule: NudgeRule = {
  id: "time_nudge_inactivity",
  category: "inactivity",
  evaluate(context: UserJobContext): ProactiveNudge[] {
    if (context.applications.length === 0) return [];
    const hasActive = context.applications.some((app) => {
      const lastEvent = app.lastStatusEventAt ?? app.updatedAt;
      return daysBetween(lastEvent, context.now) < INACTIVITY_DAYS;
    });
    if (hasActive) return [];

    const msg = localize(MESSAGES.inactive, context.preferredLanguage, {
      days: INACTIVITY_DAYS,
    });
    return [{
      userId: context.userId,
      category: "inactivity",
      priority: "low",
      ...msg,
      scheduledAt: context.now,
      expiresAt: new Date(context.now.getTime() + 3 * 24 * 60 * 60 * 1000),
    }];
  },
};

// Deadline approaching: nextActionAt within 3 days
const deadlineRule: NudgeRule = {
  id: "deadline_warning",
  category: "deadline_warning",
  evaluate(context: UserJobContext): ProactiveNudge[] {
    const nudges: ProactiveNudge[] = [];
    for (const app of context.applications) {
      if (!app.nextActionAt) continue;
      if (TERMINAL_STATUSES.has(app.status)) continue;
      const daysUntil = daysBetween(context.now, app.nextActionAt);
      if (daysUntil > DEADLINE_WARNING_DAYS || daysUntil < 0) continue;

      const msg = localize(MESSAGES.deadline, context.preferredLanguage, {
        company: app.companyNameJa,
        days: Math.max(0, Math.ceil(daysUntil)),
      });
      nudges.push({
        userId: context.userId,
        category: "deadline_warning",
        jobApplicationId: app.id,
        companyName: app.companyNameJa,
        priority: "high",
        ...msg,
        scheduledAt: context.now,
        expiresAt: app.nextActionAt,
      });
    }
    return nudges;
  },
};

// Post-interview silence: interview status with no change for 5+ days
const postInterviewRule: NudgeRule = {
  id: "follow_up_post_interview",
  category: "follow_up",
  evaluate(context: UserJobContext): ProactiveNudge[] {
    const nudges: ProactiveNudge[] = [];
    for (const app of context.applications) {
      if (!INTERVIEW_STATUSES.has(app.status)) continue;
      const lastEvent = app.lastStatusEventAt ?? app.updatedAt;
      const daysSince = daysBetween(lastEvent, context.now);
      if (daysSince < POST_INTERVIEW_SILENCE_DAYS) continue;

      const msg = localize(MESSAGES.postInterview, context.preferredLanguage, {
        company: app.companyNameJa,
        days: Math.floor(daysSince),
      });
      nudges.push({
        userId: context.userId,
        category: "follow_up",
        jobApplicationId: app.id,
        companyName: app.companyNameJa,
        priority: "medium",
        ...msg,
        scheduledAt: context.now,
        expiresAt: new Date(context.now.getTime() + 7 * 24 * 60 * 60 * 1000),
      });
    }
    return nudges;
  },
};

export const timeNudgeRules: NudgeRule[] = [
  staleAppRule,
  abandonSuggestionRule,
  inactivityRule,
  deadlineRule,
  postInterviewRule,
];

import type { NudgeRule, ProactiveNudge, UserJobContext } from "../types";

const TERMINAL_STATUSES = new Set(["offer", "rejected", "withdrawn"]);
const DAY_MS = 24 * 60 * 60 * 1000;

const MESSAGES: Record<"ja" | "zh" | "en", { title: string; body: string }> = {
  ja: {
    title: "マイページを確認しましょう",
    body: "「{company}」の採用マイページを{days}日確認していません。選考結果や新着メッセージがないか見ておきましょう。",
  },
  zh: {
    title: "该查一下招聘官网了",
    body: "「{company}」的招聘网站已经 {days} 天没确认了。去看看有没有选考结果或新消息。",
  },
  en: {
    title: "Check the recruiting portal",
    body: "You have not checked \"{company}\"'s recruiting portal for {days} days. Look for result updates or new messages.",
  },
};

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / DAY_MS;
}

function localize(
  lang: "ja" | "zh" | "en",
  vars: Record<string, string | number>
): { title: string; body: string } {
  const m = MESSAGES[lang] ?? MESSAGES.zh;
  let title = m.title;
  let body = m.body;
  for (const [k, v] of Object.entries(vars)) {
    title = title.replace(`{${k}}`, String(v));
    body = body.replace(`{${k}}`, String(v));
  }
  return { title, body };
}

export const portalCheckRule: NudgeRule = {
  id: "portal_check",
  category: "follow_up",

  evaluate(context: UserJobContext): ProactiveNudge[] {
    const nudges: ProactiveNudge[] = [];

    for (const app of context.applications) {
      if (TERMINAL_STATUSES.has(app.status)) continue;
      if (!app.portalStatusCheckEnabled || !app.portalUrl) continue;

      const lastChecked = app.lastPortalCheckedAt ?? app.updatedAt;
      const daysSince = daysBetween(lastChecked, context.now);
      if (daysSince < app.portalCheckIntervalDays) continue;

      const msg = localize(context.preferredLanguage, {
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
        expiresAt: new Date(context.now.getTime() + app.portalCheckIntervalDays * DAY_MS),
      });
    }

    return nudges;
  },
};

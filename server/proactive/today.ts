/**
 * "今日やるべき3つ" — top-three task ranker.
 *
 * Pulls active job applications and upcoming calendar events for a user,
 * scores each candidate task per the rubric in 改造计划书 §11.1, returns the
 * top three with a short reason string in the user's preferred language.
 *
 * Pure read + score. No persistence. Used by Telegram `/today`.
 */

import { and, asc, eq, gte, lte } from "drizzle-orm";
import { calendarEventIngestions } from "../../drizzle/schema";
import { getDb, getJobApplications, getUserById } from "../db";
import type { CalendarEventType } from "../calendarEventNlp";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type TodayTaskKind =
  | "deadline"
  | "interview"
  | "briefing"
  | "written_test"
  | "status_followup"
  | "research"
  | "stale_wait";

export interface TodayTask {
  kind: TodayTaskKind;
  score: number;
  signals: string[];
  jobApplicationId?: number;
  calendarEventId?: number;
  companyName?: string | null;
  title: string;
  reason: string;
  whenAt?: Date | null;
}

interface UpcomingCalendarEvent {
  id: number;
  summary: string | null;
  description: string | null;
  startAt: Date | null;
  endAt: Date | null;
  parsedJson: unknown;
}

async function fetchUpcomingEvents(
  userId: number,
  windowMs = 7 * DAY_MS,
  now: Date = new Date()
): Promise<UpcomingCalendarEvent[]> {
  const db = await getDb();
  if (!db) return [];
  const horizon = new Date(now.getTime() + windowMs);
  const rows = await db
    .select({
      id: calendarEventIngestions.id,
      summary: calendarEventIngestions.summary,
      description: calendarEventIngestions.description,
      startAt: calendarEventIngestions.startAt,
      endAt: calendarEventIngestions.endAt,
      parsedJson: calendarEventIngestions.parsedJson,
    })
    .from(calendarEventIngestions)
    .where(
      and(
        eq(calendarEventIngestions.userId, userId),
        eq(calendarEventIngestions.isRelevant, true),
        gte(calendarEventIngestions.startAt, now),
        lte(calendarEventIngestions.startAt, horizon)
      )
    )
    .orderBy(asc(calendarEventIngestions.startAt));
  return rows;
}

function eventTypeOf(parsedJson: unknown): CalendarEventType | null {
  if (!parsedJson || typeof parsedJson !== "object") return null;
  const t = (parsedJson as { eventType?: unknown }).eventType;
  if (typeof t === "string") return t as CalendarEventType;
  return null;
}

function isInterviewStatus(s: string | null | undefined): boolean {
  if (!s) return false;
  return (
    s === "interview_1" ||
    s === "interview_2" ||
    s === "interview_3" ||
    s === "interview_4" ||
    s === "interview_final"
  );
}

function isPrepStatus(s: string | null | undefined): boolean {
  return s === "es_preparing" || s === "written_test";
}

function lang(
  user: { preferredLanguage?: string | null } | null
): "ja" | "zh" | "en" {
  const v = user?.preferredLanguage;
  if (v === "zh" || v === "en" || v === "ja") return v;
  return "ja";
}

function fmtCompany(c: string | null | undefined): string {
  return c?.trim() || "—";
}

export interface ComputeTodayTasksOptions {
  /** Cap on returned tasks. Default 3. */
  limit?: number;
  /** Override "now" for tests. */
  now?: Date;
}

export async function computeTodayTasks(
  userId: number,
  options: ComputeTodayTasksOptions = {}
): Promise<TodayTask[]> {
  const limit = options.limit ?? 3;
  const now = options.now ?? new Date();
  const nowMs = now.getTime();

  const [user, apps, events] = await Promise.all([
    getUserById(userId),
    getJobApplications(userId),
    fetchUpcomingEvents(userId, 7 * DAY_MS, now),
  ]);

  const language = lang(user ?? null);
  const candidates: TodayTask[] = [];

  // ── job_applications driven candidates ────────────────────────────────────
  for (const app of apps) {
    const status = app.status ?? null;
    if (status === "offer" || status === "rejected" || status === "withdrawn") {
      continue;
    }

    const company = app.companyNameJa ?? app.companyNameEn ?? null;
    let score = 0;
    const signals: string[] = [];

    const nextActionAt = app.nextActionAt ? new Date(app.nextActionAt) : null;
    let kind: TodayTaskKind = "status_followup";
    if (nextActionAt) {
      const dt = nextActionAt.getTime() - nowMs;
      if (dt > 0 && dt <= 24 * HOUR_MS) {
        score += 100;
        signals.push("nextActionAt<24h");
        kind = "deadline";
      } else if (dt > 0 && dt <= 72 * HOUR_MS) {
        score += 70;
        signals.push("nextActionAt<72h");
        kind = "deadline";
      }
    }

    if (isPrepStatus(status)) {
      score += 40;
      signals.push(`status=${status}`);
      if (kind === "status_followup") kind = "written_test";
    }
    if (isInterviewStatus(status)) {
      score += 50;
      signals.push(`status=${status}`);
      if (kind === "status_followup") kind = "interview";
    }
    if (status === "researching") {
      score += 10;
      signals.push("status=researching");
      if (kind === "status_followup") kind = "research";
    }

    if (app.priority === "high") {
      score += 30;
      signals.push("priority=high");
    }

    if (
      (status === "es_submitted" ||
        status === "document_screening" ||
        status === "applied") &&
      app.updatedAt
    ) {
      const daysSince = (nowMs - new Date(app.updatedAt).getTime()) / DAY_MS;
      if (daysSince >= 7) {
        score += 20;
        signals.push("waiting>=7d");
        if (kind === "status_followup") kind = "stale_wait";
      }
    }

    if (score <= 0) continue;

    const title =
      language === "zh"
        ? `${fmtCompany(company)}：${labelForKind(kind, "zh")}`
        : language === "en"
          ? `${fmtCompany(company)}: ${labelForKind(kind, "en")}`
          : `${fmtCompany(company)}：${labelForKind(kind, "ja")}`;

    const reason = buildAppReason({
      language,
      kind,
      signals,
      nextActionAt,
      now,
    });

    candidates.push({
      kind,
      score,
      signals,
      jobApplicationId: app.id,
      companyName: company,
      title,
      reason,
      whenAt: nextActionAt,
    });
  }

  // ── calendar event driven candidates ──────────────────────────────────────
  for (const ev of events) {
    if (!ev.startAt) continue;
    const dt = new Date(ev.startAt).getTime() - nowMs;
    if (dt < 0) continue;
    const eventType = eventTypeOf(ev.parsedJson);
    let score = 0;
    const signals: string[] = [];
    let kind: TodayTaskKind = "interview";

    if (dt <= 24 * HOUR_MS) {
      score += 100;
      signals.push("event<24h");
    } else if (dt <= 72 * HOUR_MS) {
      score += 60;
      signals.push("event<72h");
    } else {
      score += 25;
      signals.push("event<7d");
    }

    if (eventType === "interview_final") {
      score += 50;
      kind = "interview";
    } else if (eventType === "interview_1") {
      score += 50;
      kind = "interview";
    } else if (eventType === "written_test") {
      score += 40;
      kind = "written_test";
    } else if (eventType === "briefing") {
      score += 25;
      kind = "briefing";
    } else if (eventType === "offer") {
      score += 60;
      kind = "deadline";
    }

    const title =
      language === "zh"
        ? labelForKind(kind, "zh") + (ev.summary ? `：${ev.summary}` : "")
        : language === "en"
          ? labelForKind(kind, "en") + (ev.summary ? `: ${ev.summary}` : "")
          : labelForKind(kind, "ja") + (ev.summary ? `：${ev.summary}` : "");
    const reason = buildEventReason({
      language,
      whenAt: new Date(ev.startAt),
      now,
    });

    candidates.push({
      kind,
      score,
      signals,
      calendarEventId: ev.id,
      title,
      reason,
      whenAt: new Date(ev.startAt),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}

function labelForKind(kind: TodayTaskKind, l: "ja" | "zh" | "en"): string {
  const t: Record<TodayTaskKind, { ja: string; zh: string; en: string }> = {
    deadline: { ja: "締切対応", zh: "截止前推进", en: "Deadline action" },
    interview: { ja: "面接準備", zh: "面试准备", en: "Interview prep" },
    briefing: { ja: "説明会参加", zh: "宣讲会参加", en: "Briefing attendance" },
    written_test: {
      ja: "Webテスト対策",
      zh: "笔试准备",
      en: "Written test prep",
    },
    status_followup: { ja: "状況確認", zh: "状态跟进", en: "Status follow-up" },
    research: { ja: "企業研究", zh: "企业调研", en: "Company research" },
    stale_wait: {
      ja: "結果待ちフォロー",
      zh: "结果跟进",
      en: "Result follow-up",
    },
  };
  return t[kind][l];
}

function buildAppReason(params: {
  language: "ja" | "zh" | "en";
  kind: TodayTaskKind;
  signals: string[];
  nextActionAt: Date | null;
  now: Date;
}): string {
  const { language, signals, nextActionAt, now } = params;
  const dueIn = nextActionAt
    ? Math.max(
        0,
        Math.round((nextActionAt.getTime() - now.getTime()) / HOUR_MS)
      )
    : null;

  const reasons: string[] = [];
  if (signals.includes("nextActionAt<24h")) {
    reasons.push(
      language === "zh"
        ? `截止只剩约 ${dueIn ?? "?"} 小时。`
        : language === "en"
          ? `Deadline in ~${dueIn ?? "?"} hours.`
          : `締切まで残り約 ${dueIn ?? "?"} 時間です。`
    );
  } else if (signals.includes("nextActionAt<72h")) {
    reasons.push(
      language === "zh"
        ? `截止还有约 3 天。`
        : language === "en"
          ? `Deadline in ~3 days.`
          : `締切まであと約 3 日です。`
    );
  }
  if (signals.includes("waiting>=7d")) {
    reasons.push(
      language === "zh"
        ? `已等结果超过 7 天，可以主动跟进。`
        : language === "en"
          ? `Waiting on a result for 7+ days; consider a follow-up.`
          : `結果待ちが 7 日以上です。フォロー連絡を検討してください。`
    );
  }
  if (signals.includes("priority=high")) {
    reasons.push(
      language === "zh"
        ? `这家公司优先级高。`
        : language === "en"
          ? `Marked high priority.`
          : `優先度が高い企業です。`
    );
  }
  if (reasons.length === 0) {
    reasons.push(
      language === "zh"
        ? `当前阶段需要持续推进。`
        : language === "en"
          ? `Keep this one moving.`
          : `現在の段階で継続的な対応が必要です。`
    );
  }
  return reasons.join(" ");
}

function buildEventReason(params: {
  language: "ja" | "zh" | "en";
  whenAt: Date;
  now: Date;
}): string {
  const { language, whenAt, now } = params;
  const hours = Math.max(
    0,
    Math.round((whenAt.getTime() - now.getTime()) / HOUR_MS)
  );
  if (hours <= 24) {
    return language === "zh"
      ? `${hours} 小时后开始，今天就要准备好。`
      : language === "en"
        ? `Starts in ${hours} hour(s); prep today.`
        : `開始まで約 ${hours} 時間。今日のうちに準備しましょう。`;
  }
  const days = Math.max(1, Math.round(hours / 24));
  return language === "zh"
    ? `还有约 ${days} 天，最好提前准备。`
    : language === "en"
      ? `In ~${days} days; prep ahead.`
      : `あと約 ${days} 日。早めに準備しましょう。`;
}

import { getUserById, getJobApplications, getActiveMessagingBinding, listLatestJobStatusEventTimes } from "../db";
import { dispatchNotification } from "../_core/messaging";
import { evaluateAllRules } from "./rules";
import type { ProactiveNudge, UserJobContext, NudgeCategory } from "./types";
import { collectTrialNudges, markTrialNudgeDelivered } from "../billing";
import { isNotificationAllowed } from "./quietHours";
import { humanizeNudgeBody } from "./humanize";

const NUDGE_COOLDOWN_MS = 23 * 60 * 60 * 1000;
const deliveredNudges = new Map<string, number>();

function isCategoryEnabled(
  category: NudgeCategory,
  prefs: Record<string, boolean> | null | undefined
): boolean {
  if (!prefs) return true; // No prefs = all enabled
  return prefs[category] !== false;
}

function nudgeDeliveryKey(nudge: ProactiveNudge): string {
  const target = nudge.jobApplicationId ?? "global";
  const relevantDate = nudge.expiresAt?.toISOString().slice(0, 10) ?? nudge.scheduledAt.toISOString().slice(0, 10);
  return [
    nudge.userId,
    nudge.category,
    target,
    nudge.title,
    nudge.companyName ?? "",
    relevantDate,
  ].join(":");
}

function shouldDeliverNudge(nudge: ProactiveNudge, now: Date): boolean {
  const key = nudgeDeliveryKey(nudge);
  const lastDeliveredAt = deliveredNudges.get(key);
  if (lastDeliveredAt && now.getTime() - lastDeliveredAt < NUDGE_COOLDOWN_MS) {
    return false;
  }
  return true;
}

function markNudgeDelivered(nudge: ProactiveNudge, now: Date): void {
  deliveredNudges.set(nudgeDeliveryKey(nudge), now.getTime());
}

export async function runProactiveCheckForUser(userId: number): Promise<ProactiveNudge[]> {
  const user = await getUserById(userId);
  if (!user) return [];

  const binding = await getActiveMessagingBinding(userId);
  if (!binding) return [];

  // Check quiet hours
  if (!isNotificationAllowed(user.notificationSchedule ?? null)) {
    console.info(`[Proactive] User ${userId} is in quiet hours, skipping`);
    return [];
  }

  const nudgePrefs = user.nudgeCategoriesEnabled as Record<string, boolean> | null;

  const applications = await getJobApplications(userId);
  const lang = (user.preferredLanguage ?? "zh") as "ja" | "zh" | "en";

  const context: UserJobContext = {
    userId,
    preferredLanguage: lang,
    applications: applications.map((app) => ({
      id: app.id,
      companyNameJa: app.companyNameJa,
      status: app.status,
      updatedAt: app.updatedAt,
      nextActionAt: app.nextActionAt ?? null,
      lastStatusEventAt: null,
    })),
    now: new Date(),
  };

  const latestStatusEventTimes = await listLatestJobStatusEventTimes(userId);
  for (const app of context.applications) {
    app.lastStatusEventAt = latestStatusEventTimes.get(app.id) ?? app.updatedAt;
  }

  const nudges = evaluateAllRules(context)
    .filter((n) => isCategoryEnabled(n.category, nudgePrefs))
    .filter((n) => shouldDeliverNudge(n, context.now));

  // Also check billing trial nudges
  try {
    const trialNudges = await collectTrialNudges(userId);
    for (const nudge of trialNudges) {
      await dispatchNotification({ userId, body: nudge.text });
      await markTrialNudgeDelivered(userId, nudge.kind);
    }
  } catch (err) {
    console.error("[Proactive] Failed to send trial nudges:", err);
  }

  // Humanize all nudge bodies in parallel before dispatching, so the message
  // sounds like a colleague rather than a CRM alert.
  const humanizedBodies = await Promise.all(
    nudges.map((n) => humanizeNudgeBody(n, lang))
  );

  // Dispatch proactive nudges
  for (let i = 0; i < nudges.length; i++) {
    const nudge = nudges[i];
    const body = humanizedBodies[i] ?? nudge.body;
    try {
      const prefix = nudge.companyName ? `【${nudge.companyName}】` : "";
      await dispatchNotification({
        userId,
        title: nudge.title,
        body: `${prefix}${body}`,
      });
      markNudgeDelivered(nudge, context.now);
    } catch (err) {
      console.error(`[Proactive] Failed to dispatch nudge for user ${userId}:`, err);
    }
  }

  return nudges;
}

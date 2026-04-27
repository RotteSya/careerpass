import { getUserById, getJobApplications, getActiveMessagingBinding, listLatestJobStatusEventTimes } from "../db";
import { dispatchNotification } from "../_core/messaging";
import { evaluateAllRules } from "./rules";
import type { ProactiveNudge, UserJobContext, NudgeCategory } from "./types";
import { collectTrialNudges, markTrialNudgeDelivered } from "../billing";
import { isNotificationAllowed } from "./quietHours";
import { humanizeNudgeBody } from "./humanize";
import { getNudgeLastDeliveredAt, recordNudgeDelivered } from "./deliveredNudges";

const NUDGE_COOLDOWN_MS = 23 * 60 * 60 * 1000;

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

async function shouldDeliverNudge(nudge: ProactiveNudge, now: Date): Promise<boolean> {
  const lastDeliveredAt = await getNudgeLastDeliveredAt(
    nudge.userId,
    nudgeDeliveryKey(nudge)
  );
  if (lastDeliveredAt && now.getTime() - lastDeliveredAt.getTime() < NUDGE_COOLDOWN_MS) {
    return false;
  }
  return true;
}

async function markNudgeDelivered(nudge: ProactiveNudge, now: Date): Promise<void> {
  await recordNudgeDelivered(nudge.userId, nudgeDeliveryKey(nudge), now);
}

function canPierceQuietHours(nudge: ProactiveNudge): boolean {
  return nudge.category === "deadline_warning" && nudge.priority === "high";
}

export async function runProactiveCheckForUser(userId: number): Promise<ProactiveNudge[]> {
  const user = await getUserById(userId);
  if (!user) return [];

  const binding = await getActiveMessagingBinding(userId);
  if (!binding) return [];

  const inQuietHours = !isNotificationAllowed(user.notificationSchedule ?? null);

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
      portalUrl: app.portalUrl ?? null,
      lastPortalCheckedAt: app.lastPortalCheckedAt ?? null,
      portalCheckIntervalDays: app.portalCheckIntervalDays ?? 7,
      portalStatusCheckEnabled: app.portalStatusCheckEnabled ?? false,
    })),
    now: new Date(),
  };

  const latestStatusEventTimes = await listLatestJobStatusEventTimes(userId);
  for (const app of context.applications) {
    app.lastStatusEventAt = latestStatusEventTimes.get(app.id) ?? app.updatedAt;
  }

  const candidates = evaluateAllRules(context)
    .filter((n) => isCategoryEnabled(n.category, nudgePrefs))
    .filter((n) => !inQuietHours || canPierceQuietHours(n));

  if (inQuietHours && candidates.length === 0) {
    console.info(`[Proactive] User ${userId} is in quiet hours, skipping`);
  } else if (inQuietHours) {
    console.info(
      `[Proactive] User ${userId} in quiet hours; ${candidates.length} high-priority deadline nudge(s) bypassing`
    );
  }

  const cooldownChecks = await Promise.all(
    candidates.map((n) => shouldDeliverNudge(n, context.now))
  );
  const nudges = candidates.filter((_, i) => cooldownChecks[i]);

  // Trial nudges are billing-related — important but not urgent enough to
  // wake someone up. Suppress during quiet hours; they'll fire next tick.
  if (!inQuietHours) {
    try {
      const trialNudges = await collectTrialNudges(userId);
      for (const nudge of trialNudges) {
        await dispatchNotification({ userId, body: nudge.text });
        await markTrialNudgeDelivered(userId, nudge.kind);
      }
    } catch (err) {
      console.error("[Proactive] Failed to send trial nudges:", err);
    }
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
      await markNudgeDelivered(nudge, context.now);
    } catch (err) {
      console.error(`[Proactive] Failed to dispatch nudge for user ${userId}:`, err);
    }
  }

  return nudges;
}

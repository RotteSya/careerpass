import { getUserById, getJobApplications, getActiveMessagingBinding, listLatestJobStatusEventTimes } from "../db";
import { dispatchNotification } from "../_core/messaging";
import { evaluateAllRules } from "./rules";
import type { ProactiveNudge, UserJobContext, NudgeCategory } from "./types";
import { collectTrialNudges, markTrialNudgeDelivered } from "../billing";
import { isNotificationAllowed } from "./quietHours";

function isCategoryEnabled(
  category: NudgeCategory,
  prefs: Record<string, boolean> | null | undefined
): boolean {
  if (!prefs) return true; // No prefs = all enabled
  return prefs[category] !== false;
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

  const nudges = evaluateAllRules(context).filter(
    (n) => isCategoryEnabled(n.category, nudgePrefs)
  );

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

  // Dispatch proactive nudges
  for (const nudge of nudges) {
    try {
      const prefix = nudge.companyName ? `【${nudge.companyName}】` : "";
      await dispatchNotification({
        userId,
        title: nudge.title,
        body: `${prefix}${nudge.body}`,
      });
    } catch (err) {
      console.error(`[Proactive] Failed to dispatch nudge for user ${userId}:`, err);
    }
  }

  return nudges;
}

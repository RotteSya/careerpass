import { getBillingFeatureAccess, getOauthToken } from "./db";
import { monitorGmailAndSync, registerGmailPushWatch } from "./gmail";

export async function startMailMonitoringAndCheckmail(params: {
  userId: number;
  telegramChatId?: string;
  mode?: "auto" | "manual";
}) {
  const access = await getBillingFeatureAccess(params.userId);
  const mode = params.mode ?? "manual";
  if (mode === "auto" && !access.autoMonitoringEnabled) {
    return {
      needsOAuth: false as const,
      watchOk: false,
      result: null,
      access,
      blockedByBilling: true as const,
    };
  }

  const token = await getOauthToken(params.userId, "google");
  if (!token) {
    return {
      needsOAuth: true as const,
      watchOk: false,
      result: null,
      access,
      blockedByBilling: false as const,
    };
  }

  const watchOk =
    mode === "auto" && access.autoMonitoringEnabled
      ? await registerGmailPushWatch(params.userId)
      : false;
  const result = await monitorGmailAndSync(params.userId, params.telegramChatId, {
    enableAutoBoardWrite: access.autoBoardWriteEnabled,
    enableAutoWorkflow: access.autoWorkflowEnabled,
  });
  return {
    needsOAuth: false as const,
    watchOk,
    result,
    access,
    blockedByBilling: false as const,
  };
}

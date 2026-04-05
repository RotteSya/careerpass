import { getOauthToken } from "./db";
import { monitorGmailAndSync, registerGmailPushWatch } from "./gmail";

export async function startMailMonitoringAndCheckmail(params: {
  userId: number;
  telegramChatId: string;
}) {
  const token = await getOauthToken(params.userId, "google");
  if (!token) {
    return { needsOAuth: true as const, watchOk: false, result: null };
  }

  const watchOk = await registerGmailPushWatch(params.userId);
  const result = await monitorGmailAndSync(params.userId, params.telegramChatId);
  return { needsOAuth: false as const, watchOk, result };
}

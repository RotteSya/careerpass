import {
  getBillingFeatureAccess,
  getBillingNotificationState,
  markBillingNotificationSent,
  getJobApplications,
} from "./db";

export interface TrialNudge {
  kind: "day10" | "day13" | "suspension";
  text: string;
}

function buildDay10Text(trackedCompanyCount: number): string {
  return `免费体验还剩 4 天，我为你追踪了 ${trackedCompanyCount} 家公司。继续开通后，我会持续自动盯邮箱、更新看板。`;
}

function buildDay13Text(params: {
  trackedCompanyCount: number;
  activeCount: number;
  offerCount: number;
  rejectedCount: number;
}) {
  const planHint =
    params.trackedCompanyCount <= 10
      ? "按公司数方案：10家公司 1980"
      : params.trackedCompanyCount <= 20
      ? "按公司数方案：20家公司 3980"
      : "可切换月订阅制，解锁不限公司数";
  return (
    `看板摘要：已追踪 ${params.trackedCompanyCount} 家，进行中 ${params.activeCount} 家，` +
    `拿到 offer ${params.offerCount} 家，未通过/辞退 ${params.rejectedCount} 家。\n` +
    `试用期还剩 1 天。建议你现在开通，避免自动监控中断。\n` +
    `${planHint}`
  );
}

function buildSuspensionText(): string {
  return "免费期已结束：自动邮箱监控与自动写入看板已暂停。历史数据仍可查看；你也可以手动触发邮箱扫描。";
}

export async function collectTrialNudges(userId: number): Promise<TrialNudge[]> {
  const access = await getBillingFeatureAccess(userId);
  const notif = await getBillingNotificationState(userId);
  const jobs = await getJobApplications(userId);
  const activeCount = jobs.filter((j) => !["offer", "rejected", "withdrawn"].includes(j.status)).length;
  const offerCount = jobs.filter((j) => j.status === "offer").length;
  const rejectedCount = jobs.filter((j) => ["rejected", "withdrawn"].includes(j.status)).length;

  const nudges: TrialNudge[] = [];
  if (access.dayFromTrialStart >= 10 && !notif?.day10SentAt) {
    nudges.push({
      kind: "day10",
      text: buildDay10Text(access.trackedCompanyCount),
    });
  }
  if (access.dayFromTrialStart >= 13 && !notif?.day13SentAt) {
    nudges.push({
      kind: "day13",
      text: buildDay13Text({
        trackedCompanyCount: access.trackedCompanyCount,
        activeCount,
        offerCount,
        rejectedCount,
      }),
    });
  }
  if (access.phase === "suspended" && !notif?.suspensionSentAt) {
    nudges.push({
      kind: "suspension",
      text: buildSuspensionText(),
    });
  }
  return nudges;
}

export async function markTrialNudgeDelivered(userId: number, kind: TrialNudge["kind"]) {
  await markBillingNotificationSent(userId, kind);
}

export function manualScanUpsellLine(): string {
  return "开通订阅，自动帮你盯着邮箱 →";
}

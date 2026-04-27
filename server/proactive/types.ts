export type NudgeCategory =
  | "status_suggestion"
  | "time_nudge"
  | "deadline_warning"
  | "inactivity"
  | "follow_up";

export type NudgePriority = "high" | "medium" | "low";

export interface ProactiveNudge {
  userId: number;
  category: NudgeCategory;
  jobApplicationId?: number;
  companyName?: string;
  priority: NudgePriority;
  title: string;
  body: string;
  scheduledAt: Date;
  expiresAt?: Date;
}

export interface UserJobContext {
  userId: number;
  preferredLanguage: "ja" | "zh" | "en";
  applications: Array<{
    id: number;
    companyNameJa: string;
    status: string;
    updatedAt: Date;
    nextActionAt: Date | null;
    lastStatusEventAt: Date | null;
    portalUrl: string | null;
    lastPortalCheckedAt: Date | null;
    portalCheckIntervalDays: number;
    portalStatusCheckEnabled: boolean;
  }>;
  now: Date;
}

export interface NudgeRule {
  id: string;
  category: NudgeCategory;
  evaluate(context: UserJobContext): ProactiveNudge[];
}

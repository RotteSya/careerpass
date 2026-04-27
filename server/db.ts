import { and, asc, count, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  InsertOauthToken,
  InsertTelegramBinding,
  InsertJobApplication,
  InsertJobStatusEvent,
  InsertAgentMemory,
  InsertAgentSession,
  agentMemory,
  agentSessions,
  agentUserTraits,
  jobApplications,
  jobStatusEvents,
  oauthTokens,
  oauthProviderAccounts,
  telegramBindings,
  users,
  emailAuth,
  messagingBindings,
  billingAccounts,
  billingCompanyLedger,
  billingNotifications,
  calendarEventSyncs,
  InsertCalendarEventSync,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { normalizeCompanyKey, resolveCanonicalCompanyName } from "./companyName";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ─────────────────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const fields = ["name", "email", "loginMethod", "birthDate", "universityName"] as const;
  for (const f of fields) {
    const v = user[f];
    if (v !== undefined) { values[f] = v ?? null; updateSet[f] = v ?? null; }
  }

  const enumFields = ["education", "preferredLanguage"] as const;
  for (const f of enumFields) {
    const v = user[f];
    if (v !== undefined) { values[f] = v as any; updateSet[f] = v; }
  }

  if (user.profileCompleted !== undefined) {
    values.profileCompleted = user.profileCompleted;
    updateSet.profileCompleted = user.profileCompleted;
  }
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0] ?? undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] ?? undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0] ?? undefined;
}

export async function updateUserProfile(
  userId: number,
  data: Partial<Pick<InsertUser, "name" | "birthDate" | "education" | "universityName" | "preferredLanguage" | "profileCompleted" | "calendarColorBriefing" | "calendarColorInterview" | "calendarColorDeadline" | "calendarWriteEnabled" | "notificationSchedule" | "nudgeCategoriesEnabled">>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, userId));
}

export interface UserCalendarColorPrefs {
  briefing: string;
  interview: string;
  deadline: string;
}

export async function getUserCalendarColorPrefs(userId: number): Promise<UserCalendarColorPrefs> {
  const user = await getUserById(userId);
  return {
    briefing: user?.calendarColorBriefing ?? "9",
    interview: user?.calendarColorInterview ?? "6",
    deadline: user?.calendarColorDeadline ?? "11",
  };
}

export async function updateUserCalendarColorPrefs(
  userId: number,
  updates: Partial<UserCalendarColorPrefs>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(users)
    .set({
      calendarColorBriefing: updates.briefing,
      calendarColorInterview: updates.interview,
      calendarColorDeadline: updates.deadline,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function getCalendarWriteEnabled(userId: number): Promise<boolean> {
  const user = await getUserById(userId);
  return !!user?.calendarWriteEnabled;
}

export async function setCalendarWriteEnabled(userId: number, enabled: boolean): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(users)
    .set({ calendarWriteEnabled: enabled, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function deleteUserAccountData(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(billingCompanyLedger).where(eq(billingCompanyLedger.userId, userId));
  await db.delete(billingNotifications).where(eq(billingNotifications.userId, userId));
  await db.delete(billingAccounts).where(eq(billingAccounts.userId, userId));
  await db.delete(jobStatusEvents).where(eq(jobStatusEvents.userId, userId));
  await db.delete(jobApplications).where(eq(jobApplications.userId, userId));
  await db.delete(agentMemory).where(eq(agentMemory.userId, userId));
  await db.delete(agentSessions).where(eq(agentSessions.userId, userId));
  await db.delete(telegramBindings).where(eq(telegramBindings.userId, userId));
  await db.delete(messagingBindings).where(eq(messagingBindings.userId, userId));
  await db.delete(oauthProviderAccounts).where(eq(oauthProviderAccounts.userId, userId));
  await db.delete(oauthTokens).where(eq(oauthTokens.userId, userId));
  await db.delete(emailAuth).where(eq(emailAuth.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

const TRIAL_DAYS = 14;
const TRIAL_GRACE_DAYS = 1;

export async function getOrCreateBillingAccount(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0];

  const now = new Date();
  const trialEndsAt = addDays(now, TRIAL_DAYS);
  const graceEndsAt = addDays(trialEndsAt, TRIAL_GRACE_DAYS);
  await db.insert(billingAccounts).values({
    userId,
    billingMode: "company",
    companyPlanLimit: 10,
    cycleStartedAt: now,
    cycleEndsAt: null,
    trialStartedAt: now,
    trialEndsAt,
    graceEndsAt,
  });
  const created = await db
    .select()
    .from(billingAccounts)
    .where(eq(billingAccounts.userId, userId))
    .limit(1);
  return created[0]!;
}

export interface BillingFeatureAccess {
  phase: "trial" | "grace" | "paid" | "suspended";
  autoMonitoringEnabled: boolean;
  autoBoardWriteEnabled: boolean;
  autoWorkflowEnabled: boolean;
  dayFromTrialStart: number;
  trackedCompanyCount: number;
  trialEndsAt: Date;
  graceEndsAt: Date;
}

export async function countTrackedCompaniesInCurrentCycle(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const account = await getOrCreateBillingAccount(userId);
  const baseConditions = [
    eq(billingCompanyLedger.userId, userId),
    eq(billingCompanyLedger.countable, true),
    gte(billingCompanyLedger.firstSeenAt, account.cycleStartedAt),
  ];
  if (account.cycleEndsAt) {
    baseConditions.push(lte(billingCompanyLedger.firstSeenAt, account.cycleEndsAt));
  }
  const rows = await db
    .select({ id: billingCompanyLedger.id })
    .from(billingCompanyLedger)
    .where(and(...baseConditions));
  return rows.length;
}

export async function getBillingFeatureAccess(userId: number): Promise<BillingFeatureAccess> {
  const account = await getOrCreateBillingAccount(userId);
  const now = new Date();
  const trialStartMs = account.trialStartedAt.getTime();
  const dayFromTrialStart = Math.max(1, Math.floor((now.getTime() - trialStartMs) / (24 * 60 * 60 * 1000)) + 1);
  const trackedCompanyCount = await countTrackedCompaniesInCurrentCycle(userId);

  let phase: BillingFeatureAccess["phase"] = "suspended";
  if (now <= account.trialEndsAt) {
    phase = "trial";
  } else if (now <= account.graceEndsAt) {
    phase = "grace";
  } else if (account.cycleEndsAt && now <= account.cycleEndsAt) {
    phase = "paid";
  }

  const autoEnabled = phase === "trial" || phase === "grace" || phase === "paid";
  return {
    phase,
    autoMonitoringEnabled: autoEnabled,
    autoBoardWriteEnabled: autoEnabled,
    autoWorkflowEnabled: autoEnabled,
    dayFromTrialStart,
    trackedCompanyCount,
    trialEndsAt: account.trialEndsAt,
    graceEndsAt: account.graceEndsAt,
  };
}

export function normalizeCompanyKeyForBilling(companyName: string): string {
  return normalizeCompanyKey(companyName) ?? companyName.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function trackCompanyForBilling(params: {
  userId: number;
  companyName: string;
  firstStatus?: string | null;
  occurredAt?: Date | null;
}) {
  const db = await getDb();
  if (!db) return;
  const account = await getOrCreateBillingAccount(params.userId);
  const companyName = (resolveCanonicalCompanyName(params.companyName) ?? params.companyName).trim();
  if (!companyName) return;
  const companyKey = normalizeCompanyKeyForBilling(companyName);

  const occurredAt = params.occurredAt ?? new Date();
  const status = (params.firstStatus ?? "").toLowerCase();
  const terminal = status === "offer" || status === "rejected" || status === "withdrawn";
  const countable = !(terminal && occurredAt < account.cycleStartedAt);
  await db
    .insert(billingCompanyLedger)
    .values({
      userId: params.userId,
      companyKey,
      companyName,
      firstStatus: params.firstStatus ?? null,
      firstSeenAt: occurredAt,
      countable,
    })
    .onDuplicateKeyUpdate({
      set: { updatedAt: new Date() },
    });
}

export async function getBillingNotificationState(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(billingNotifications)
    .where(eq(billingNotifications.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function markBillingNotificationSent(
  userId: number,
  kind: "day10" | "day13" | "suspension"
) {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  const patch =
    kind === "day10"
      ? { day10SentAt: now }
      : kind === "day13"
      ? { day13SentAt: now }
      : { suspensionSentAt: now };
  await db
    .insert(billingNotifications)
    .values({
      userId,
      day10SentAt: kind === "day10" ? now : null,
      day13SentAt: kind === "day13" ? now : null,
      suspensionSentAt: kind === "suspension" ? now : null,
    })
    .onDuplicateKeyUpdate({
      set: patch,
    });
}

export async function getCalendarEventSync(params: {
  userId: number;
  provider: "google" | "outlook";
  mailMessageId: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(calendarEventSyncs)
    .where(
      and(
        eq(calendarEventSyncs.userId, params.userId),
        eq(calendarEventSyncs.provider, params.provider),
        eq(calendarEventSyncs.mailMessageId, params.mailMessageId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertCalendarEventSync(sync: InsertCalendarEventSync) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(calendarEventSyncs)
    .values(sync)
    .onDuplicateKeyUpdate({
      set: {
        calendarEventId: sync.calendarEventId,
        updatedAt: new Date(),
      },
    });
}

// ─── OAuth Tokens ──────────────────────────────────────────────────────────
export async function upsertOauthToken(token: InsertOauthToken) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(oauthTokens).values(token).onDuplicateKeyUpdate({
    set: {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? null,
      expiresAt: token.expiresAt ?? null,
      scope: token.scope ?? null,
      updatedAt: new Date(),
    },
  });
}

export async function getOauthToken(userId: number, provider: "google" | "outlook") {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider)))
    .limit(1);
  return result[0] ?? undefined;
}

export async function patchOauthTokenScope(params: {
  userId: number;
  provider: "google" | "outlook";
  patch: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const current = await getOauthToken(params.userId, params.provider);
  const base: Record<string, unknown> =
    current?.scope
      ? (() => {
          try {
            const parsed = JSON.parse(current.scope) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
            return {};
          } catch {
            return {};
          }
        })()
      : {};
  const next = { ...base, ...params.patch };
  await db
    .update(oauthTokens)
    .set({ scope: JSON.stringify(next), updatedAt: new Date() })
    .where(and(eq(oauthTokens.userId, params.userId), eq(oauthTokens.provider, params.provider)));
}

export async function deleteOauthToken(userId: number, provider: "google" | "outlook") {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, provider)));
}

export async function listUserIdsByOauthProvider(provider: "google" | "outlook"): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ userId: oauthTokens.userId })
    .from(oauthTokens)
    .where(eq(oauthTokens.provider, provider));
  return Array.from(new Set(rows.map(r => r.userId)));
}

export async function upsertOauthProviderAccount(params: {
  userId: number;
  provider: "google" | "outlook";
  accountEmail: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const normalizedEmail = params.accountEmail.trim().toLowerCase();
  await db
    .insert(oauthProviderAccounts)
    .values({
      userId: params.userId,
      provider: params.provider,
      accountEmail: normalizedEmail,
    })
    .onDuplicateKeyUpdate({
      set: {
        userId: params.userId,
        accountEmail: normalizedEmail,
        updatedAt: new Date(),
      },
    });
}

export async function getUserIdByOauthProviderAccount(
  provider: "google" | "outlook",
  accountEmail: string
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const normalizedEmail = accountEmail.trim().toLowerCase();
  const result = await db
    .select({ userId: oauthProviderAccounts.userId })
    .from(oauthProviderAccounts)
    .where(and(eq(oauthProviderAccounts.provider, provider), eq(oauthProviderAccounts.accountEmail, normalizedEmail)))
    .limit(1);
  return result[0]?.userId ?? null;
}

export interface GoogleAccountSyncState {
  accountEmail: string;
  lastHistoryId: string | null;
  watchExpiration: Date | null;
}

export async function getGoogleAccountSyncState(userId: number): Promise<GoogleAccountSyncState | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select({
      accountEmail: oauthProviderAccounts.accountEmail,
      lastHistoryId: oauthProviderAccounts.lastHistoryId,
      watchExpiration: oauthProviderAccounts.watchExpiration,
    })
    .from(oauthProviderAccounts)
    .where(and(eq(oauthProviderAccounts.provider, "google"), eq(oauthProviderAccounts.userId, userId)))
    .limit(1);
  if (!result[0]) return null;
  return {
    accountEmail: result[0].accountEmail,
    lastHistoryId: result[0].lastHistoryId ?? null,
    watchExpiration: result[0].watchExpiration ?? null,
  };
}

export async function updateGoogleAccountSyncState(
  userId: number,
  updates: Partial<Pick<GoogleAccountSyncState, "lastHistoryId" | "watchExpiration">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const set: { lastHistoryId?: string | null; watchExpiration?: Date | null } = {};
  if (updates.lastHistoryId !== undefined) set.lastHistoryId = updates.lastHistoryId;
  if (updates.watchExpiration !== undefined) set.watchExpiration = updates.watchExpiration;
  if (Object.keys(set).length === 0) return;
  await db
    .update(oauthProviderAccounts)
    .set(set)
    .where(and(eq(oauthProviderAccounts.provider, "google"), eq(oauthProviderAccounts.userId, userId)));
}

export async function updateGoogleLastHistoryIdIfNewer(userId: number, newHistoryId: string): Promise<void> {
  const state = await getGoogleAccountSyncState(userId);
  if (!state) return;
  const current = state.lastHistoryId;
  if (!current) {
    await updateGoogleAccountSyncState(userId, { lastHistoryId: newHistoryId });
    return;
  }
  try {
    const next = BigInt(newHistoryId);
    const prev = BigInt(current);
    if (next > prev) {
      await updateGoogleAccountSyncState(userId, { lastHistoryId: newHistoryId });
    }
  } catch {
    if (newHistoryId !== current) {
      await updateGoogleAccountSyncState(userId, { lastHistoryId: newHistoryId });
    }
  }
}

// ─── Telegram Bindings ─────────────────────────────────────────────────────
export async function getTelegramBinding(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(telegramBindings)
    .where(eq(telegramBindings.userId, userId))
    .limit(1);
  return result[0] ?? undefined;
}

export async function getTelegramBindingByTelegramId(telegramId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(telegramBindings)
    .where(eq(telegramBindings.telegramId, telegramId))
    .limit(1);
  return result[0] ?? undefined;
}

export async function createTelegramBinding(binding: InsertTelegramBinding) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Rebind strategy: clear any row that conflicts on either unique key
  // (userId or telegramId), then insert a single canonical binding row.
  await db
    .delete(telegramBindings)
    .where(
      or(
        eq(telegramBindings.userId, binding.userId),
        eq(telegramBindings.telegramId, binding.telegramId)
      )
    );

  await db.insert(telegramBindings).values({
    ...binding,
    isActive: true,
    boundAt: new Date(),
  });
}

// ─── Job Applications ──────────────────────────────────────────────────────
type JobApplicationStatus = NonNullable<InsertJobApplication["status"]>;

function jobStatusRankForWrite(status: JobApplicationStatus): number {
  const ranks: Record<JobApplicationStatus, number> = {
    researching: 10,
    applied: 20,
    briefing: 30,
    es_preparing: 40,
    es_submitted: 45,
    document_screening: 50,
    written_test: 55,
    interview_1: 60,
    interview_2: 70,
    interview_3: 75,
    interview_4: 80,
    interview_final: 85,
    offer: 90,
    rejected: 90,
    withdrawn: 90,
  };
  return ranks[status] ?? 0;
}

export async function getJobApplications(userId: number) {
  const db = await getDb();
  if (!db) return [];

  const latestEventIds = db
    .select({
      jobApplicationId: jobStatusEvents.jobApplicationId,
      latestId: sql<number>`max(${jobStatusEvents.id})`.as("latestId"),
    })
    .from(jobStatusEvents)
    .where(eq(jobStatusEvents.userId, userId))
    .groupBy(jobStatusEvents.jobApplicationId)
    .as("latest_event_ids");

  const rows = await db
    .select({
      job: jobApplications,
      latestEvent: {
        mailSubject: jobStatusEvents.mailSubject,
        mailFrom: jobStatusEvents.mailFrom,
        reason: jobStatusEvents.reason,
      },
    })
    .from(jobApplications)
    .leftJoin(
      latestEventIds,
      eq(jobApplications.id, latestEventIds.jobApplicationId)
    )
    .leftJoin(
      jobStatusEvents,
      eq(jobStatusEvents.id, latestEventIds.latestId)
    )
    .where(eq(jobApplications.userId, userId))
    .orderBy(desc(jobApplications.updatedAt));

  return rows.map(row => ({
    ...row.job,
    _latestMailSubject: row.latestEvent?.mailSubject ?? null,
    _latestMailFrom: row.latestEvent?.mailFrom ?? null,
    _latestReason: row.latestEvent?.reason ?? null,
  }));
}

export async function createJobApplication(data: InsertJobApplication) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(jobApplications).values(data);
  return { id: result.insertId };
}

export async function updateJobApplicationStatus(
  id: number,
  userId: number,
  status: InsertJobApplication["status"]
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(jobApplications)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(jobApplications.id, id), eq(jobApplications.userId, userId)));
}

export async function updateJobApplicationDetails(
  id: number,
  userId: number,
  updates: {
    status?: InsertJobApplication["status"];
    position?: string | null;
    contactInfo?: string | null;
    priority?: "high" | "medium" | "low" | null;
    nextActionAt?: Date | null;
  }
) {
  const db = await getDb();
  if (!db) return;
  const setObj: Record<string, any> = {};
  if (updates.status !== undefined) setObj.status = updates.status;
  if (updates.position !== undefined && updates.position !== null) setObj.position = updates.position;
  if (updates.contactInfo !== undefined && updates.contactInfo !== null) setObj.contactInfo = updates.contactInfo;
  if (updates.priority !== undefined && updates.priority !== null) setObj.priority = updates.priority;
  if (updates.nextActionAt !== undefined) setObj.nextActionAt = updates.nextActionAt;
  
  if (Object.keys(setObj).length === 0) return;

  await db
    .update(jobApplications)
    .set(setObj)
    .where(and(eq(jobApplications.id, id), eq(jobApplications.userId, userId)));
}

export async function updateJobApplicationPortalInfo(
  id: number,
  userId: number,
  updates: {
    portalUrl?: string | null;
    portalAccountHint?: string | null;
    portalCheckIntervalDays?: number;
    portalStatusCheckEnabled?: boolean;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const setObj: Record<string, any> = { updatedAt: new Date() };
  if (updates.portalUrl !== undefined) setObj.portalUrl = updates.portalUrl;
  if (updates.portalAccountHint !== undefined) setObj.portalAccountHint = updates.portalAccountHint;
  if (updates.portalCheckIntervalDays !== undefined) setObj.portalCheckIntervalDays = updates.portalCheckIntervalDays;
  if (updates.portalStatusCheckEnabled !== undefined) setObj.portalStatusCheckEnabled = updates.portalStatusCheckEnabled;

  await db
    .update(jobApplications)
    .set(setObj)
    .where(and(eq(jobApplications.id, id), eq(jobApplications.userId, userId)));
}

export async function markJobApplicationPortalChecked(params: {
  id: number;
  userId: number;
  checkedAt: Date;
  reason: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.transaction(async (tx) => {
    const target = await tx
      .select()
      .from(jobApplications)
      .where(and(eq(jobApplications.id, params.id), eq(jobApplications.userId, params.userId)))
      .limit(1);

    if (!target[0]) throw new Error("Job application not found");

    await tx
      .update(jobApplications)
      .set({
        lastPortalCheckedAt: params.checkedAt,
        updatedAt: params.checkedAt,
      })
      .where(and(eq(jobApplications.id, params.id), eq(jobApplications.userId, params.userId)));

    await tx.insert(jobStatusEvents).values({
      userId: params.userId,
      jobApplicationId: params.id,
      source: "portal",
      prevStatus: target[0].status,
      nextStatus: target[0].status,
      reason: params.reason,
      createdAt: params.checkedAt,
    });
  });
}

export async function createJobStatusEvent(event: InsertJobStatusEvent) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .insert(jobStatusEvents)
    .values(event)
    .onDuplicateKeyUpdate({
      set: {
        jobApplicationId: event.jobApplicationId ?? null,
        prevStatus: event.prevStatus ?? null,
        nextStatus: event.nextStatus ?? null,
        mailFrom: event.mailFrom ?? null,
        mailSubject: event.mailSubject ?? null,
        mailSnippet: event.mailSnippet ?? null,
        reason: event.reason ?? null,
      },
    });
}

export async function applyAgentJobStatusUpdate(params: {
  userId: number;
  jobApplicationId: number;
  prevStatus: JobApplicationStatus;
  nextStatus: JobApplicationStatus;
  reason: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.transaction(async (tx) => {
    await tx
      .update(jobApplications)
      .set({ status: params.nextStatus, updatedAt: new Date() })
      .where(and(eq(jobApplications.id, params.jobApplicationId), eq(jobApplications.userId, params.userId)));

    await tx.insert(jobStatusEvents).values({
      userId: params.userId,
      jobApplicationId: params.jobApplicationId,
      source: "agent",
      prevStatus: params.prevStatus,
      nextStatus: params.nextStatus,
      reason: params.reason,
    });
  });
}

export async function createConfirmedAgentJobApplication(params: {
  userId: number;
  companyName: string;
  status: JobApplicationStatus;
  reason: string;
}): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async (tx) => {
    const [created] = await tx.insert(jobApplications).values({
      userId: params.userId,
      companyNameJa: params.companyName,
      status: params.status,
    });
    const id = created.insertId;

    await tx.insert(jobStatusEvents).values({
      userId: params.userId,
      jobApplicationId: id,
      source: "agent",
      prevStatus: null,
      nextStatus: params.status,
      reason: params.reason,
    });

    return { id };
  });
}

export async function applyGmailJobStatusEvent(params: {
  userId: number;
  companyName: string;
  nextStatus: JobApplicationStatus;
  mailMessageId: string;
  mailFrom: string;
  mailSubject: string;
  mailSnippet: string;
  reason: string;
}): Promise<{ changed: boolean; duplicate: boolean; jobId: number | null; nextStatus: JobApplicationStatus }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async (tx) => {
    const existingEvent = await tx
      .select()
      .from(jobStatusEvents)
      .where(and(eq(jobStatusEvents.userId, params.userId), eq(jobStatusEvents.mailMessageId, params.mailMessageId)))
      .limit(1);
    if (existingEvent[0]) {
      return {
        changed: false,
        duplicate: true,
        jobId: existingEvent[0].jobApplicationId ?? null,
        nextStatus: params.nextStatus,
      };
    }

    const targetKey = normalizeCompanyKey(params.companyName);
    const existingJobs = await tx
      .select()
      .from(jobApplications)
      .where(eq(jobApplications.userId, params.userId));
    let existingJob = existingJobs.find((job) => {
      const jaKey = normalizeCompanyKey(job.companyNameJa);
      const enKey = normalizeCompanyKey(job.companyNameEn);
      return targetKey && (jaKey === targetKey || enKey === targetKey);
    });

    let prevStatus: JobApplicationStatus | null = null;
    let changed = false;
    let jobId: number;
    let finalStatus = params.nextStatus;

    if (!existingJob) {
      const [created] = await tx.insert(jobApplications).values({
        userId: params.userId,
        companyNameJa: params.companyName,
        status: params.nextStatus,
      });
      jobId = created.insertId;
      changed = true;
    } else {
      jobId = existingJob.id;
      prevStatus = existingJob.status as JobApplicationStatus;
      changed = jobStatusRankForWrite(params.nextStatus) > jobStatusRankForWrite(prevStatus);
      finalStatus = changed ? params.nextStatus : prevStatus;
      if (changed) {
        await tx
          .update(jobApplications)
          .set({ status: params.nextStatus, updatedAt: new Date() })
          .where(and(eq(jobApplications.id, existingJob.id), eq(jobApplications.userId, params.userId)));
      }
    }

    await tx.insert(jobStatusEvents).values({
      userId: params.userId,
      jobApplicationId: jobId,
      source: "gmail",
      prevStatus,
      nextStatus: finalStatus,
      mailMessageId: params.mailMessageId,
      mailFrom: params.mailFrom,
      mailSubject: params.mailSubject,
      mailSnippet: params.mailSnippet,
      reason: params.reason,
    });

    return { changed, duplicate: false, jobId, nextStatus: finalStatus };
  });
}

export async function listJobStatusEvents(userId: number, jobApplicationId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(jobStatusEvents)
    .where(and(eq(jobStatusEvents.userId, userId), eq(jobStatusEvents.jobApplicationId, jobApplicationId)))
    .orderBy(desc(jobStatusEvents.createdAt))
    .limit(limit);
}

export async function listLatestJobStatusEventTimes(userId: number): Promise<Map<number, Date>> {
  const db = await getDb();
  if (!db) return new Map();
  const rows = await db
    .select({
      jobApplicationId: jobStatusEvents.jobApplicationId,
      latestCreatedAt: sql<Date>`max(${jobStatusEvents.createdAt})`.as("latestCreatedAt"),
    })
    .from(jobStatusEvents)
    .where(eq(jobStatusEvents.userId, userId))
    .groupBy(jobStatusEvents.jobApplicationId);

  const result = new Map<number, Date>();
  for (const row of rows) {
    if (typeof row.jobApplicationId === "number" && row.latestCreatedAt) {
      result.set(row.jobApplicationId, row.latestCreatedAt);
    }
  }
  return result;
}

// ─── Messaging Bindings ────────────────────────────────────────────────────
export async function getActiveMessagingBinding(userId: number): Promise<{
  provider: string;
  externalId: string;
} | null> {
  const db = await getDb();
  if (!db) return null;

  // Prefer unified messagingBindings table
  const unified = await db
    .select({ provider: messagingBindings.provider, externalId: messagingBindings.externalId })
    .from(messagingBindings)
    .where(and(eq(messagingBindings.userId, userId), eq(messagingBindings.isActive, true)))
    .limit(1);
  if (unified[0]) return unified[0];

  // Fallback to legacy telegramBindings
  const legacy = await getTelegramBinding(userId);
  if (legacy?.isActive && legacy.telegramId) {
    return { provider: "telegram", externalId: legacy.telegramId };
  }

  return null;
}

export async function listUserIdsWithActiveMessagingBinding(): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const ids = new Set<number>();

  const unified = await db
    .select({ userId: messagingBindings.userId })
    .from(messagingBindings)
    .where(eq(messagingBindings.isActive, true));
  for (const row of unified) ids.add(row.userId);

  const legacy = await db
    .select({ userId: telegramBindings.userId })
    .from(telegramBindings)
    .where(eq(telegramBindings.isActive, true));
  for (const row of legacy) ids.add(row.userId);

  return Array.from(ids);
}

// ─── Agent Memory ──────────────────────────────────────────────────────────
export async function saveAgentMemory(memory: InsertAgentMemory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(agentMemory).values(memory);
  return result;
}

export async function getAgentMemory(userId: number, memoryType?: InsertAgentMemory["memoryType"]) {
  const db = await getDb();
  if (!db) return [];
  const conditions = memoryType
    ? and(eq(agentMemory.userId, userId), eq(agentMemory.memoryType, memoryType))
    : eq(agentMemory.userId, userId);
  return db
    .select()
    .from(agentMemory)
    .where(conditions)
    .orderBy(desc(agentMemory.updatedAt));
}

// ── Memory cap helpers (Harness Pattern: bounded memory index) ───────────
export async function countAgentMemory(userId: number, memoryType: InsertAgentMemory["memoryType"]): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ value: count() })
    .from(agentMemory)
    .where(and(eq(agentMemory.userId, userId), eq(agentMemory.memoryType, memoryType)));
  return row?.value ?? 0;
}

export async function deleteOldestAgentMemory(userId: number, memoryType: InsertAgentMemory["memoryType"], deleteCount: number): Promise<void> {
  const db = await getDb();
  if (!db || deleteCount <= 0) return;
  const oldest = await db
    .select({ id: agentMemory.id })
    .from(agentMemory)
    .where(and(eq(agentMemory.userId, userId), eq(agentMemory.memoryType, memoryType)))
    .orderBy(asc(agentMemory.updatedAt))
    .limit(deleteCount);
  if (oldest.length === 0) return;
  await db
    .delete(agentMemory)
    .where(inArray(agentMemory.id, oldest.map((r) => r.id)));
}

// ─── Agent User Traits ──────────────────────────────────────────────────────
export async function getAgentUserTraits(userId: number): Promise<{
  nickname: string | null;
  notes: unknown | null;
} | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ nickname: agentUserTraits.nickname, notes: agentUserTraits.notes })
    .from(agentUserTraits)
    .where(eq(agentUserTraits.userId, userId))
    .limit(1);
  if (!rows[0]) return null;
  return { nickname: rows[0].nickname ?? null, notes: rows[0].notes ?? null };
}

export async function setAgentNickname(userId: number, nickname: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const trimmed = nickname.trim();
  if (!trimmed) return;
  await db
    .insert(agentUserTraits)
    .values({ userId, nickname: trimmed })
    .onDuplicateKeyUpdate({ set: { nickname: trimmed } });
}

// ─── Agent Sessions ────────────────────────────────────────────────────────
export async function getOrCreateAgentSession(userId: number, telegramChatId?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0];
  await db.insert(agentSessions).values({
    userId,
    telegramChatId: telegramChatId ?? null,
    currentAgent: "careerpass",
    interviewMode: false,
  });
  const created = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.userId, userId))
    .limit(1);
  return created[0]!;
}

export async function updateAgentSession(
  userId: number,
  data: Partial<InsertAgentSession>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(agentSessions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(agentSessions.userId, userId));
}

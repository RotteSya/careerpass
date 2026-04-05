import { and, desc, eq } from "drizzle-orm";
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
  jobApplications,
  jobStatusEvents,
  oauthTokens,
  oauthProviderAccounts,
  telegramBindings,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

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
  data: Partial<Pick<InsertUser, "name" | "birthDate" | "education" | "universityName" | "preferredLanguage" | "profileCompleted" | "calendarColorBriefing" | "calendarColorInterview" | "calendarColorDeadline">>
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

// ─── OAuth Tokens ──────────────────────────────────────────────────────────
export async function upsertOauthToken(token: InsertOauthToken) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete existing token for this user+provider, then insert fresh
  await db
    .delete(oauthTokens)
    .where(and(eq(oauthTokens.userId, token.userId), eq(oauthTokens.provider, token.provider)));
  await db.insert(oauthTokens).values(token);
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

  const existing = await db
    .select({
      lastHistoryId: oauthProviderAccounts.lastHistoryId,
      watchExpiration: oauthProviderAccounts.watchExpiration,
    })
    .from(oauthProviderAccounts)
    .where(and(eq(oauthProviderAccounts.provider, params.provider), eq(oauthProviderAccounts.userId, params.userId)))
    .limit(1);

  await db
    .delete(oauthProviderAccounts)
    .where(and(eq(oauthProviderAccounts.provider, params.provider), eq(oauthProviderAccounts.userId, params.userId)));

  await db.insert(oauthProviderAccounts).values({
    userId: params.userId,
    provider: params.provider,
    accountEmail: normalizedEmail,
    lastHistoryId: existing[0]?.lastHistoryId ?? null,
    watchExpiration: existing[0]?.watchExpiration ?? null,
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
  await db
    .insert(telegramBindings)
    .values(binding)
    .onDuplicateKeyUpdate({
      set: {
        telegramId: binding.telegramId,
        telegramUsername: binding.telegramUsername,
        isActive: true,
        boundAt: new Date(),
      },
    });
}

// ─── Job Applications ──────────────────────────────────────────────────────
export async function getJobApplications(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(jobApplications)
    .where(eq(jobApplications.userId, userId))
    .orderBy(desc(jobApplications.updatedAt));
}

export async function createJobApplication(app: InsertJobApplication) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(jobApplications).values(app);
  return result;
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

export async function createJobStatusEvent(event: InsertJobStatusEvent) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(jobStatusEvents).values(event);
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

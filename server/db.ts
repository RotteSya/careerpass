import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  InsertOauthToken,
  InsertTelegramBinding,
  InsertJobApplication,
  InsertAgentMemory,
  InsertAgentSession,
  agentMemory,
  agentSessions,
  jobApplications,
  oauthTokens,
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

export async function updateUserProfile(
  userId: number,
  data: Partial<Pick<InsertUser, "name" | "birthDate" | "education" | "universityName" | "preferredLanguage" | "profileCompleted">>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, userId));
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

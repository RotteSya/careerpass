import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  boolean,
  json,
} from "drizzle-orm/mysql-core";

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  // Extended profile for job seekers
  birthDate: varchar("birthDate", { length: 20 }), // YYYY-MM-DD
  education: mysqlEnum("education", [
    "high_school",
    "associate",
    "bachelor",
    "master",
    "doctor",
    "other",
  ]),
  universityName: varchar("universityName", { length: 255 }),
  preferredLanguage: mysqlEnum("preferredLanguage", ["zh", "ja", "en"]).default("ja"),
  // Google Calendar colorId defaults:
  // blue=9, orange=6, red=11
  calendarColorBriefing: varchar("calendarColorBriefing", { length: 2 }).default("9"),
  calendarColorInterview: varchar("calendarColorInterview", { length: 2 }).default("6"),
  calendarColorDeadline: varchar("calendarColorDeadline", { length: 2 }).default("11"),
  profileCompleted: boolean("profileCompleted").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
// ─── Email Auth (自建邮筱注册/登录) ──────────────────────────────────────────────────
export const emailAuth = mysqlTable("email_auth", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  verifyToken: varchar("verifyToken", { length: 128 }),
  verifyTokenExpiresAt: timestamp("verifyTokenExpiresAt"),
  verifiedAt: timestamp("verifiedAt"),
  resetToken: varchar("resetToken", { length: 128 }),
  resetTokenExpiresAt: timestamp("resetTokenExpiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type EmailAuth = typeof emailAuth.$inferSelect;
export type InsertEmailAuth = typeof emailAuth.$inferInsert;

// ─── OAuth Tokens (Google / Outlook Calendar) ──────────────────────────────
export const oauthTokens = mysqlTable("oauth_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: mysqlEnum("provider", ["google", "outlook"]).notNull(),
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken"),
  expiresAt: timestamp("expiresAt"),
  scope: text("scope"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OauthToken = typeof oauthTokens.$inferSelect;
export type InsertOauthToken = typeof oauthTokens.$inferInsert;

// ─── OAuth Provider Account Mapping (provider email -> user) ─────────────────
export const oauthProviderAccounts = mysqlTable("oauth_provider_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: mysqlEnum("provider", ["google", "outlook"]).notNull(),
  accountEmail: varchar("accountEmail", { length: 320 }).notNull(),
  lastHistoryId: varchar("lastHistoryId", { length: 64 }),
  watchExpiration: timestamp("watchExpiration"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OauthProviderAccount = typeof oauthProviderAccounts.$inferSelect;
export type InsertOauthProviderAccount = typeof oauthProviderAccounts.$inferInsert;

// ─── Messaging Channel Bindings (Telegram / Line / WhatsApp / WeChat) ─────────
/**
 * Unified multi-channel messaging binding table.
 * Supports Telegram (active), and is pre-architected for Line, WhatsApp, WeChat.
 * Each user can have at most one active binding per provider.
 * provider enum can be extended without schema changes to existing rows.
 */
export const messagingBindings = mysqlTable("messaging_bindings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  // Extensible provider enum: add 'line' | 'whatsapp' | 'wechat' when ready
  provider: mysqlEnum("provider", ["telegram", "line", "whatsapp", "wechat"]).notNull(),
  // Provider-specific external user ID (telegramId / lineUserId / waId / openid)
  externalId: varchar("externalId", { length: 128 }).notNull(),
  // Optional display handle (username, display name, phone number, etc.)
  externalHandle: varchar("externalHandle", { length: 256 }),
  boundAt: timestamp("boundAt").defaultNow().notNull(),
  isActive: boolean("isActive").default(true).notNull(),
});

export type MessagingBinding = typeof messagingBindings.$inferSelect;
export type InsertMessagingBinding = typeof messagingBindings.$inferInsert;

/**
 * @deprecated Use messagingBindings with provider='telegram' instead.
 * Kept for backward compatibility with existing Telegram Webhook code.
 * Will be removed in a future migration once all references are updated.
 */
export const telegramBindings = mysqlTable("telegram_bindings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  telegramId: varchar("telegramId", { length: 64 }).notNull().unique(),
  telegramUsername: varchar("telegramUsername", { length: 128 }),
  boundAt: timestamp("boundAt").defaultNow().notNull(),
  isActive: boolean("isActive").default(true).notNull(),
});

export type TelegramBinding = typeof telegramBindings.$inferSelect;
export type InsertTelegramBinding = typeof telegramBindings.$inferInsert;

// ─── Job Applications (求職状態追跡) ──────────────────────────────────────────
export const jobApplications = mysqlTable("job_applications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  companyNameJa: varchar("companyNameJa", { length: 255 }).notNull(),
  companyNameEn: varchar("companyNameEn", { length: 255 }),
  position: varchar("position", { length: 255 }),
  status: mysqlEnum("status", [
    "researching",
    "es_preparing",
    "es_submitted",
    "interview_1",
    "interview_2",
    "interview_final",
    "offer",
    "rejected",
    "withdrawn",
  ]).default("researching").notNull(),
  reconReportPath: varchar("reconReportPath", { length: 512 }),
  esFilePath: varchar("esFilePath", { length: 512 }),
  notes: text("notes"),
  nextActionAt: timestamp("nextActionAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type JobApplication = typeof jobApplications.$inferSelect;
export type InsertJobApplication = typeof jobApplications.$inferInsert;

// ─── Agent Memory (記憶庫) ────────────────────────────────────────────────────
export const agentMemory = mysqlTable("agent_memory", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  memoryType: mysqlEnum("memoryType", [
    "resume",
    "company_report",
    "conversation",
    "es_draft",
    "interview_log",
  ]).notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  content: text("content").notNull(),
  metadata: json("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AgentMemory = typeof agentMemory.$inferSelect;
export type InsertAgentMemory = typeof agentMemory.$inferInsert;

// ─── Agent Sessions (Telegram conversation state) ────────────────────────────
export const agentSessions = mysqlTable("agent_sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  telegramChatId: varchar("telegramChatId", { length: 64 }),
  currentAgent: mysqlEnum("currentAgent", [
    "careerpass",
    "careerpassrecon",
    "careerpasses",
    "careerpassinterview",
  ]).default("careerpass").notNull(),
  sessionState: json("sessionState"),
  interviewMode: boolean("interviewMode").default(false).notNull(),
  targetCompanyId: int("targetCompanyId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AgentSession = typeof agentSessions.$inferSelect;
export type InsertAgentSession = typeof agentSessions.$inferInsert;

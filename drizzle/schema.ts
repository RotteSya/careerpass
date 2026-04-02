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
  // Basic profile (collected at registration)
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
  // Preferred language for AI coaching
  preferredLanguage: mysqlEnum("preferredLanguage", ["zh", "ja", "en"]).default("ja"),
  // Profile completion flag
  profileCompleted: boolean("profileCompleted").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── OAuth Tokens (Google / Outlook Calendar) ─────────────────────────────────
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

// ─── Telegram Bindings ────────────────────────────────────────────────────────
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
  companyNameJa: varchar("companyNameJa", { length: 255 }).notNull(), // Japanese company name
  companyNameEn: varchar("companyNameEn", { length: 255 }),
  position: varchar("position", { length: 255 }),
  status: mysqlEnum("status", [
    "researching",   // 調査中
    "es_preparing",  // ES準備中
    "es_submitted",  // ES提出済
    "interview_1",   // 一次面接
    "interview_2",   // 二次面接
    "interview_final",// 最終面接
    "offer",         // 内定
    "rejected",      // 不採用
    "withdrawn",     // 辞退
  ]).default("researching").notNull(),
  reconReportPath: varchar("reconReportPath", { length: 512 }), // path to Recon_Report.md
  esFilePath: varchar("esFilePath", { length: 512 }),           // path to ES file
  notes: text("notes"),
  nextActionAt: timestamp("nextActionAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type JobApplication = typeof jobApplications.$inferSelect;
export type InsertJobApplication = typeof jobApplications.$inferInsert;

// ─── Agent Memory (记忆库 - text content, vector handled separately) ──────────
export const agentMemory = mysqlTable("agent_memory", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  memoryType: mysqlEnum("memoryType", [
    "resume",         // USER_<SessionID>.md content
    "company_report", // [公司日文名]_Recon_Report.md content
    "conversation",   // STAR conversation history
    "es_draft",       // Entry Sheet draft
    "interview_log",  // Interview simulation log
  ]).notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  content: text("content").notNull(),
  metadata: json("metadata"), // { sessionId, companyName, jobId, etc. }
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
  sessionState: json("sessionState"), // LangGraph state snapshot
  interviewMode: boolean("interviewMode").default(false).notNull(),
  targetCompanyId: int("targetCompanyId"), // FK to job_applications
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AgentSession = typeof agentSessions.$inferSelect;
export type InsertAgentSession = typeof agentSessions.$inferInsert;

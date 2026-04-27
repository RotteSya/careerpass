import {
  int,
  index,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
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
  // Opt-in toggle for writing detected events to Google Calendar.
  // Off by default; flipped to true via Dashboard toggle or Telegram consent.
  calendarWriteEnabled: boolean("calendarWriteEnabled").default(false).notNull(),
  notificationSchedule: varchar("notificationSchedule", { length: 20 }),
  nudgeCategoriesEnabled: json("nudgeCategoriesEnabled"),
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

// ─── OAuth Tokens (Google / Outlook) ───────────────────────────────────────
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
}, (table) => {
  return {
    userProviderUnique: uniqueIndex("oauth_tokens_user_provider_unique").on(table.userId, table.provider),
  };
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
}, (table) => {
  return {
    userProviderUnique: uniqueIndex("oauth_provider_accounts_user_provider_unique").on(table.userId, table.provider),
    providerEmailUnique: uniqueIndex("oauth_provider_accounts_provider_email_unique").on(table.provider, table.accountEmail),
  };
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
  contactInfo: varchar("contactInfo", { length: 255 }),
  priority: mysqlEnum("priority", ["high", "medium", "low"]).default("medium").notNull(),
  status: mysqlEnum("status", [
    "researching",
    "applied",
    "briefing",
    "es_preparing",
    "es_submitted",
    "document_screening",
    "written_test",
    "interview_1",
    "interview_2",
    "interview_3",
    "interview_4",
    "interview_final",
    "offer",
    "rejected",
    "withdrawn",
  ]).default("researching").notNull(),
  reconReportPath: varchar("reconReportPath", { length: 512 }),
  esFilePath: varchar("esFilePath", { length: 512 }),
  portalUrl: varchar("portalUrl", { length: 1024 }),
  portalAccountHint: varchar("portalAccountHint", { length: 255 }),
  lastPortalCheckedAt: timestamp("lastPortalCheckedAt"),
  portalCheckIntervalDays: int("portalCheckIntervalDays").default(7).notNull(),
  portalStatusCheckEnabled: boolean("portalStatusCheckEnabled").default(false).notNull(),
  notes: text("notes"),
  nextActionAt: timestamp("nextActionAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => {
  return {
    userUpdatedIdx: index("job_applications_user_updated_idx").on(table.userId, table.updatedAt),
    userCompanyIdx: index("job_applications_user_company_idx").on(table.userId, table.companyNameJa),
  };
});

export type JobApplication = typeof jobApplications.$inferSelect;
export type InsertJobApplication = typeof jobApplications.$inferInsert;

export const jobStatusEvents = mysqlTable("job_status_events", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  jobApplicationId: int("jobApplicationId"),
  source: mysqlEnum("source", ["gmail", "manual", "agent", "portal"]).notNull(),
  prevStatus: varchar("prevStatus", { length: 32 }),
  nextStatus: varchar("nextStatus", { length: 32 }),
  mailMessageId: varchar("mailMessageId", { length: 128 }),
  mailFrom: text("mailFrom"),
  mailSubject: text("mailSubject"),
  mailSnippet: text("mailSnippet"),
  reason: text("reason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => {
  return {
    userJobCreatedIdx: index("job_status_events_user_job_created_idx").on(table.userId, table.jobApplicationId, table.createdAt),
    userMailMessageUnique: uniqueIndex("job_status_events_user_mail_message_unique").on(table.userId, table.mailMessageId),
  };
});

export type JobStatusEvent = typeof jobStatusEvents.$inferSelect;
export type InsertJobStatusEvent = typeof jobStatusEvents.$inferInsert;

// ─── Agent Memory (記憶庫) ────────────────────────────────────────────────────
export const agentMemory = mysqlTable("agent_memory", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  memoryType: mysqlEnum("memoryType", [
    "resume",
    "company_report",
    "conversation",
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
  ]).default("careerpass").notNull(),
  sessionState: json("sessionState"),
  interviewMode: boolean("interviewMode").default(false).notNull(),
  targetCompanyId: int("targetCompanyId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AgentSession = typeof agentSessions.$inferSelect;
export type InsertAgentSession = typeof agentSessions.$inferInsert;

// ─── Billing & Trial ──────────────────────────────────────────────────────────
export const billingAccounts = mysqlTable("billing_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  billingMode: mysqlEnum("billingMode", ["monthly", "company"]).default("company").notNull(),
  companyPlanLimit: int("companyPlanLimit").default(10), // 10 or 20 for company-based pricing
  cycleStartedAt: timestamp("cycleStartedAt").notNull(),
  cycleEndsAt: timestamp("cycleEndsAt"),
  trialStartedAt: timestamp("trialStartedAt").notNull(),
  trialEndsAt: timestamp("trialEndsAt").notNull(),
  graceEndsAt: timestamp("graceEndsAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BillingAccount = typeof billingAccounts.$inferSelect;
export type InsertBillingAccount = typeof billingAccounts.$inferInsert;

export const billingCompanyLedger = mysqlTable("billing_company_ledger", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  companyKey: varchar("companyKey", { length: 255 }).notNull(),
  companyName: varchar("companyName", { length: 255 }).notNull(),
  firstStatus: varchar("firstStatus", { length: 32 }),
  countable: boolean("countable").default(true).notNull(),
  firstSeenAt: timestamp("firstSeenAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => {
  return {
    userCompanyUnique: uniqueIndex("billing_company_ledger_user_company_unique").on(table.userId, table.companyKey),
    userFirstSeenIdx: index("billing_company_ledger_user_first_seen_idx").on(table.userId, table.firstSeenAt),
  };
});

export type BillingCompanyLedger = typeof billingCompanyLedger.$inferSelect;
export type InsertBillingCompanyLedger = typeof billingCompanyLedger.$inferInsert;

export const calendarEventSyncs = mysqlTable("calendar_event_syncs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: mysqlEnum("provider", ["google", "outlook"]).notNull(),
  mailMessageId: varchar("mailMessageId", { length: 128 }).notNull(),
  calendarEventId: varchar("calendarEventId", { length: 256 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => {
  return {
    userProviderMessageUnique: uniqueIndex("calendar_event_syncs_user_provider_message_unique").on(table.userId, table.provider, table.mailMessageId),
  };
});

export type CalendarEventSync = typeof calendarEventSyncs.$inferSelect;
export type InsertCalendarEventSync = typeof calendarEventSyncs.$inferInsert;

export const billingNotifications = mysqlTable("billing_notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  day10SentAt: timestamp("day10SentAt"),
  day13SentAt: timestamp("day13SentAt"),
  suspensionSentAt: timestamp("suspensionSentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BillingNotification = typeof billingNotifications.$inferSelect;
export type InsertBillingNotification = typeof billingNotifications.$inferInsert;

// ─── Proactive delivered nudges ──────────────────────────────────────────────
// Persists which proactive nudges we have already pushed, so the cooldown
// survives server restarts and works across multiple processes. The
// deliveryKey column holds a SHA-256 hex digest of the nudge identity tuple
// (userId, category, target, title, companyName, relevantDate).
export const deliveredNudges = mysqlTable("delivered_nudges", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  deliveryKey: varchar("deliveryKey", { length: 64 }).notNull(),
  deliveredAt: timestamp("deliveredAt").defaultNow().notNull(),
}, (table) => {
  return {
    userKeyUnique: uniqueIndex("delivered_nudges_user_key_unique").on(table.userId, table.deliveryKey),
    deliveredAtIdx: index("delivered_nudges_delivered_at_idx").on(table.deliveredAt),
  };
});

export type DeliveredNudge = typeof deliveredNudges.$inferSelect;
export type InsertDeliveredNudge = typeof deliveredNudges.$inferInsert;

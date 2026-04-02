import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// mockLLM must be declared with vi.hoisted so it's available when vi.mock is hoisted
const { mockLLM } = vi.hoisted(() => ({
  mockLLM: vi.fn().mockResolvedValue({ choices: [{ message: { content: "テスト回答です。" } }] }),
}));

vi.mock("./db", () => ({
  getUserById: vi.fn().mockResolvedValue({
    id: 1,
    openId: "test-user",
    name: "テストユーザー",
    email: "test@example.com",
    birthDate: "1998-01-01",
    education: "master",
    universityName: "立命館大学",
    preferredLanguage: "ja",
    profileCompleted: true,
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  }),
  upsertUser: vi.fn().mockResolvedValue(undefined),
  updateUserProfile: vi.fn().mockResolvedValue(undefined),
  upsertOauthToken: vi.fn().mockResolvedValue(undefined),
  getOauthToken: vi.fn().mockResolvedValue(null),
  deleteOauthToken: vi.fn().mockResolvedValue(undefined),
  getTelegramBinding: vi.fn().mockResolvedValue(null),
  getJobApplications: vi.fn().mockResolvedValue([]),
  createJobApplication: vi.fn().mockResolvedValue(undefined),
  updateJobApplicationStatus: vi.fn().mockResolvedValue(undefined),
  saveAgentMemory: vi.fn().mockResolvedValue(undefined),
  getAgentMemory: vi.fn().mockResolvedValue([]),
  createTelegramBinding: vi.fn().mockResolvedValue(undefined),
  getOrCreateAgentSession: vi.fn().mockResolvedValue({ id: 1, chatId: "12345" }),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: mockLLM,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockContext(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
      openId: "test-user",
      email: "test@example.com",
      name: "テストユーザー",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function llmReply(content: string) {
  return { choices: [{ message: { content } }] };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe("auth", () => {
  it("me returns current user", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeDefined();
    expect(result?.id).toBe(1);
  });

  it("logout clears cookie and returns success", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result.success).toBe(true);
  });
});

// ─── User Profile ─────────────────────────────────────────────────────────────

describe("user.getProfile", () => {
  it("returns user profile for authenticated user", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const profile = await caller.user.getProfile();
    expect(profile).toBeDefined();
    expect(profile?.name).toBe("テストユーザー");
  });
});

describe("user.completeRegistration", () => {
  it("accepts valid registration data", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.user.completeRegistration({
      name: "山田太郎",
      birthDate: "1998-04-01",
      education: "master",
      universityName: "立命館大学",
      preferredLanguage: "ja",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid birthDate format", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.user.completeRegistration({
        name: "山田太郎",
        birthDate: "1998/04/01",
        education: "master",
        universityName: "立命館大学",
        preferredLanguage: "ja",
      })
    ).rejects.toThrow();
  });
});

// ─── Telegram ─────────────────────────────────────────────────────────────────

describe("telegram.getDeepLink", () => {
  it("generates correct deep link format for user_42", async () => {
    const ctx = createMockContext(42);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.telegram.getDeepLink();
    expect(result.deepLink).toBe("https://t.me/CareerpassBot?start=user_42");
  });

  it("deep link contains user id in payload", async () => {
    const ctx = createMockContext(999);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.telegram.getDeepLink();
    expect(result.deepLink).toContain("user_999");
  });

  it("binding status returns unbound when no binding exists", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const status = await caller.telegram.getBindingStatus();
    expect(status.bound).toBe(false);
    expect(status.telegramId).toBeNull();
  });
});

// ─── Calendar OAuth ────────────────────────────────────────────────────────────

describe("calendar.getAuthUrl", () => {
  it("generates Google OAuth URL with calendar scope", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.calendar.getAuthUrl({
      provider: "google",
      origin: "https://example.com",
    });
    expect(result.url).toContain("accounts.google.com");
    expect(result.url).toContain("calendar");
  });

  it("generates Outlook OAuth URL with graph.microsoft.com", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.calendar.getAuthUrl({
      provider: "outlook",
      origin: "https://example.com",
    });
    expect(result.url).toContain("microsoftonline.com");
    expect(result.url).toContain("Calendars");
  });

  it("encodes redirectUri in OAuth URL", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.calendar.getAuthUrl({
      provider: "google",
      origin: "https://myapp.example.com",
    });
    expect(result.url).toContain("redirect_uri");
    expect(result.url).toContain("myapp.example.com");
  });
});

describe("calendar.getStatus", () => {
  it("returns disconnected status when no tokens", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const status = await caller.calendar.getStatus();
    expect(status.google).toBe(false);
    expect(status.outlook).toBe(false);
  });
});

// ─── Jobs ─────────────────────────────────────────────────────────────────────

describe("jobs", () => {
  it("lists empty job applications", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const jobs = await caller.jobs.list();
    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs.length).toBe(0);
  });

  it("creates a job application with Japanese company name", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.jobs.create({
      companyNameJa: "株式会社テスト",
      position: "エンジニア",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty company name", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.jobs.create({ companyNameJa: "" })
    ).rejects.toThrow();
  });
});

// ─── Agent Chat ────────────────────────────────────────────────────────────────

describe("agent.chat", () => {
  beforeEach(() => {
    mockLLM.mockReset();
    mockLLM.mockResolvedValue(llmReply("テスト回答です。"));
  });

  it("returns a reply from LLM", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agent.chat({
      message: "こんにちは",
      sessionId: "test-session",
      history: [],
    });
    expect(result.reply).toBe("テスト回答です。");
    expect(result.sessionId).toBeDefined();
  });

  it("saves conversation to memory", async () => {
    const { saveAgentMemory } = await import("./db");
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    await caller.agent.chat({ message: "テスト", sessionId: "s1", history: [] });
    expect(saveAgentMemory).toHaveBeenCalledWith(
      expect.objectContaining({ memoryType: "conversation" })
    );
  });
});

// ─── Agent ES Generation ───────────────────────────────────────────────────────

describe("agent.generateES", () => {
  it("generates ES with both required sections", async () => {
    mockLLM.mockResolvedValue(
      llmReply("## 志望動機\nテスト志望動機です。\n\n## 自己PR\nテスト自己PRです。")
    );
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agent.generateES({
      companyName: "株式会社テスト",
      position: "エンジニア",
      sessionId: "es-session",
    });
    expect(result.es).toContain("志望動機");
    expect(result.es).toContain("自己PR");
  });

  it("retries when ES is missing required sections", async () => {
    // First call returns incomplete ES, second call returns complete ES
    mockLLM
      .mockResolvedValueOnce(llmReply("不完全なES内容"))
      .mockResolvedValueOnce(llmReply("## 志望動機\n志望動機です。\n\n## 自己PR\n自己PRです。"));

    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agent.generateES({
      companyName: "株式会社テスト",
      position: "エンジニア",
      sessionId: "es-retry-session",
    });
    // Should have called LLM at least twice (initial + retry)
    expect(mockLLM.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.es).toContain("志望動機");
  });
});

// ─── Agent Interview (Single Question Enforcement) ────────────────────────────

describe("agent.startInterview", () => {
  it("starts interview with first question", async () => {
    mockLLM.mockResolvedValue(llmReply("本日はお越しいただきありがとうございます。まず、自己紹介をお願いできますか？"));
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agent.startInterview({
      companyName: "株式会社テスト",
      position: "エンジニア",
      history: [],
    });
    expect(result.question).toBeDefined();
    expect(result.isFirstMessage).toBe(true);
  });

  it("enforces single question rule when LLM returns multiple questions", async () => {
    mockLLM.mockResolvedValue(
      llmReply("自己紹介をお願いします。また、なぜ弊社を志望されましたか？さらに、強みは何ですか？")
    );
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agent.startInterview({
      companyName: "株式会社テスト",
      position: "エンジニア",
      history: [],
    });
    // Count question marks in result - should be 1 or fewer
    const qMarks = (result.question.match(/[？?]/g) ?? []).length;
    expect(qMarks).toBeLessThanOrEqual(1);
  });

  it("continues interview with user answer", async () => {
    mockLLM.mockResolvedValue(llmReply("ご回答ありがとうございます。次に、チームでの経験について教えていただけますか？"));
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.agent.startInterview({
      companyName: "株式会社テスト",
      position: "エンジニア",
      history: [
        { role: "assistant", content: "自己紹介をお願いします。" },
        { role: "user", content: "山田太郎と申します。立命館大学の修士課程に在籍しています。" },
      ],
      userAnswer: "山田太郎と申します。立命館大学の修士課程に在籍しています。",
    });
    expect(result.question).toBeDefined();
    expect(result.isFirstMessage).toBe(false);
  });
});

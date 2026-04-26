import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import { handleAgentChat } from "./agents";
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
  createJobApplication: vi.fn().mockResolvedValue({ id: 99 }),
  updateJobApplicationStatus: vi.fn().mockResolvedValue(undefined),
  createJobStatusEvent: vi.fn().mockResolvedValue(undefined),
  saveAgentMemory: vi.fn().mockResolvedValue(undefined),
  getAgentMemory: vi.fn().mockResolvedValue([]),
  createTelegramBinding: vi.fn().mockResolvedValue(undefined),
  getOrCreateAgentSession: vi.fn().mockResolvedValue({ id: 1, chatId: "12345" }),
  countAgentMemory: vi.fn().mockResolvedValue(0),
  deleteOldestAgentMemory: vi.fn().mockResolvedValue(undefined),
  listLatestJobStatusEventTimes: vi.fn().mockResolvedValue(new Map()),
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
    const result = await caller.calendar.getAuthUrl();
    expect(result.url).toContain("accounts.google.com");
    expect(result.url).toContain("calendar");
  });

  it("encodes redirectUri in OAuth URL using fixed production domain", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.calendar.getAuthUrl();
    expect(result.url).toContain("redirect_uri");
    // redirect_uri must always point to the canonical production domain
    // to prevent redirect_uri_mismatch when users access via alternate URLs (e.g. Cloud Run preview)
    expect(result.url).toContain("careerpax.com");
  });
});

describe("calendar.getStatus", () => {
  it("returns disconnected status when no tokens", async () => {
    const ctx = createMockContext();
    const caller = appRouter.createCaller(ctx);
    const status = await caller.calendar.getStatus();
    expect(status.google).toBe(false);
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

// ─── Telegram Agent Chat ──────────────────────────────────────────────────────

describe("handleAgentChat", () => {
  beforeEach(async () => {
    const db = await import("./db");
    mockLLM.mockReset();
    mockLLM.mockResolvedValue(llmReply("テスト回答です。"));
    vi.mocked(db.getJobApplications).mockClear();
    vi.mocked(db.getJobApplications).mockResolvedValue([]);
    vi.mocked(db.createJobApplication).mockClear();
    vi.mocked(db.createJobApplication).mockResolvedValue({ id: 99 });
    vi.mocked(db.updateJobApplicationStatus).mockClear();
    vi.mocked(db.createJobStatusEvent).mockClear();
    vi.mocked(db.listLatestJobStatusEventTimes).mockClear();
    vi.mocked(db.listLatestJobStatusEventTimes).mockResolvedValue(new Map());
  });

  it("returns the fixed opening only for /start onboarding", async () => {
    const result = await handleAgentChat(1, "/start user_1", "test-session", []);
    expect(result.reply).toContain("勤務開始");
    expect(result.sessionId).toBeDefined();
    expect(mockLLM).not.toHaveBeenCalled();
  });

  it("uses LLM for a normal first message even when history is empty", async () => {
    const result = await handleAgentChat(1, "ソニーを調べて", "test-session", []);
    expect(result.reply).toBe("テスト回答です。");
    expect(mockLLM).toHaveBeenCalledOnce();
  });

  it("does not treat a non-start command prefix as onboarding", async () => {
    const result = await handleAgentChat(1, "/startup企業を調べて", "test-session", []);
    expect(result.reply).toBe("テスト回答です。");
    expect(mockLLM).toHaveBeenCalledOnce();
  });

  it("returns a reply from LLM", async () => {
    const result = await handleAgentChat(1, "こんにちは", "test-session", [
      { role: "assistant", content: "ウェルカム" },
    ]);
    expect(result.reply).toBe("テスト回答です。");
    expect(result.sessionId).toBeDefined();
  });

  it("passes SOUL-first user-facing guidance to the LLM", async () => {
    await handleAgentChat(1, "次に何をすればいい？", "test-session", [
      { role: "assistant", content: "ウェルカム" },
    ]);

    const call = mockLLM.mock.calls[0]?.[0];
    const systemMessage = call?.messages?.[0]?.content;
    expect(systemMessage).toContain("[SOUL]");
    expect(systemMessage).toContain("[面向用户表达优先级]");
    expect(systemMessage).toContain("每条回复都要像一个真实同事");
  });

  it("passes current job board context to the LLM", async () => {
    const db = await import("./db");
    vi.mocked(db.getJobApplications).mockResolvedValueOnce([
      {
        id: 10,
        userId: 1,
        companyNameJa: "株式会社テスト",
        companyNameEn: "Test Inc",
        position: null,
        contactInfo: null,
        priority: "medium",
        status: "interview_1",
        reconReportPath: null,
        esFilePath: null,
        notes: null,
        nextActionAt: new Date("2026-04-30T01:00:00.000Z"),
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-20T00:00:00.000Z"),
        _latestMailSubject: "一次面接のご案内",
        _latestMailFrom: "recruit@example.com",
        _latestReason: "interview notice",
      },
    ]);
    vi.mocked(db.listLatestJobStatusEventTimes).mockResolvedValueOnce(
      new Map([[10, new Date("2026-04-21T00:00:00.000Z")]])
    );

    await handleAgentChat(1, "次に何をすればいい？", "test-session", [
      { role: "assistant", content: "ウェルカム" },
    ]);

    const systemMessage = mockLLM.mock.calls[0]?.[0]?.messages?.[0]?.content;
    expect(systemMessage).toContain("現在の就活ボード");
    expect(systemMessage).toContain("株式会社テスト / Test Inc");
    expect(systemMessage).toContain("status=interview_1");
    expect(systemMessage).toContain("一次面接のご案内");
  });

  it("prioritizes upcoming actions in job board context even when they are older than the first 20 rows", async () => {
    const db = await import("./db");
    const apps = Array.from({ length: 20 }, (_, idx) => ({
      id: idx + 1,
      userId: 1,
      companyNameJa: `通常株式会社${idx + 1}`,
      companyNameEn: null,
      position: null,
      contactInfo: null,
      priority: "medium",
      status: "document_screening",
      reconReportPath: null,
      esFilePath: null,
      notes: null,
      nextActionAt: null,
      createdAt: new Date(`2026-04-${String(20 - idx).padStart(2, "0")}T00:00:00.000Z`),
      updatedAt: new Date(`2026-04-${String(20 - idx).padStart(2, "0")}T00:00:00.000Z`),
      _latestMailSubject: null,
      _latestMailFrom: null,
      _latestReason: null,
    }));
    apps.push({
      id: 99,
      userId: 1,
      companyNameJa: "締切株式会社",
      companyNameEn: null,
      position: null,
      contactInfo: null,
      priority: "medium",
      status: "es_preparing",
      reconReportPath: null,
      esFilePath: null,
      notes: null,
      nextActionAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // always in the future
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
      updatedAt: new Date("2026-03-01T00:00:00.000Z"),
      _latestMailSubject: "ES締切のお知らせ",
      _latestMailFrom: null,
      _latestReason: null,
    });
    vi.mocked(db.getJobApplications).mockResolvedValueOnce(apps);

    await handleAgentChat(1, "次に何をすればいい？", "test-session", [
      { role: "assistant", content: "ウェルカム" },
    ]);

    const systemMessage = mockLLM.mock.calls[0]?.[0]?.messages?.[0]?.content;
    expect(systemMessage).toContain("締切株式会社");
    expect(systemMessage).toContain("ES締切のお知らせ");
  });

  it("does not create a new job application from an unmatched status update tool call", async () => {
    const db = await import("./db");
    vi.mocked(db.getJobApplications).mockResolvedValue([]);
    mockLLM
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: {
                name: "updateJobStatus",
                arguments: JSON.stringify({ companyName: "未知株式会社", status: "applied" }),
              },
            }],
          },
        }],
      })
      .mockResolvedValueOnce(llmReply("その会社はまだ看板にないので、追加して更新していいですか？"));

    const result = await handleAgentChat(1, "未知株式会社に応募した", "test-session", [
      { role: "assistant", content: "ウェルカム" },
    ]);

    expect(db.createJobApplication).not.toHaveBeenCalled();
    expect(db.updateJobApplicationStatus).not.toHaveBeenCalled();
    expect(result.reply).toContain("追加して更新していいですか");
  });

  it("does not write a status event when the tracked application is already at that status", async () => {
    const db = await import("./db");
    vi.mocked(db.getJobApplications).mockResolvedValue([
      {
        id: 11,
        userId: 1,
        companyNameJa: "株式会社テスト",
        companyNameEn: "Test Inc",
        position: null,
        contactInfo: null,
        priority: "medium",
        status: "applied",
        reconReportPath: null,
        esFilePath: null,
        notes: null,
        nextActionAt: null,
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-20T00:00:00.000Z"),
        _latestMailSubject: null,
        _latestMailFrom: null,
        _latestReason: null,
      },
    ]);
    mockLLM
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: {
                name: "updateJobStatus",
                arguments: JSON.stringify({ companyName: "株式会社テスト", status: "applied" }),
              },
            }],
          },
        }],
      })
      .mockResolvedValueOnce(llmReply("すでに応募済みとして記録されています。"));

    const result = await handleAgentChat(1, "テストに応募済み", "test-session", [
      { role: "assistant", content: "ウェルカム" },
    ]);

    expect(db.updateJobApplicationStatus).not.toHaveBeenCalled();
    expect(db.createJobStatusEvent).not.toHaveBeenCalled();
    expect(result.reply).toContain("すでに応募済み");
  });

  it("asks for confirmation instead of updating when an exact company match is ambiguous", async () => {
    const db = await import("./db");
    vi.mocked(db.getJobApplications).mockResolvedValue([
      {
        id: 11,
        userId: 1,
        companyNameJa: "株式会社テスト",
        companyNameEn: "Test Inc",
        position: "Engineer",
        contactInfo: null,
        priority: "medium",
        status: "researching",
        reconReportPath: null,
        esFilePath: null,
        notes: null,
        nextActionAt: null,
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-20T00:00:00.000Z"),
        _latestMailSubject: null,
        _latestMailFrom: null,
        _latestReason: null,
      },
      {
        id: 12,
        userId: 1,
        companyNameJa: "株式会社テスト",
        companyNameEn: "Test Inc",
        position: "Business",
        contactInfo: null,
        priority: "medium",
        status: "researching",
        reconReportPath: null,
        esFilePath: null,
        notes: null,
        nextActionAt: null,
        createdAt: new Date("2026-04-02T00:00:00.000Z"),
        updatedAt: new Date("2026-04-21T00:00:00.000Z"),
        _latestMailSubject: null,
        _latestMailFrom: null,
        _latestReason: null,
      },
    ]);
    mockLLM
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: {
                name: "updateJobStatus",
                arguments: JSON.stringify({ companyName: "株式会社テスト", status: "applied" }),
              },
            }],
          },
        }],
      })
      .mockResolvedValueOnce(llmReply("同じ会社名の記録が複数あります。どちらを更新しますか？"));

    const result = await handleAgentChat(1, "テストに応募した", "test-session", [
      { role: "assistant", content: "ウェルカム" },
    ]);

    expect(db.updateJobApplicationStatus).not.toHaveBeenCalled();
    expect(db.createJobStatusEvent).not.toHaveBeenCalled();
    expect(result.reply).toContain("どちら");
  });

  it("does not create a job application when create tool lacks recent user confirmation", async () => {
    const db = await import("./db");
    vi.mocked(db.getJobApplications).mockResolvedValue([]);
    mockLLM
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: {
                name: "createJobApplication",
                arguments: JSON.stringify({
                  companyName: "未知株式会社",
                  status: "applied",
                  confirmedByUser: true,
                }),
              },
            }],
          },
        }],
      })
      .mockResolvedValueOnce(llmReply("この会社を看板に追加してよいか、先に確認します。"));

    const result = await handleAgentChat(1, "未知株式会社に応募した", "test-session", [
      { role: "assistant", content: "ウェルカム" },
    ]);

    expect(db.createJobApplication).not.toHaveBeenCalled();
    expect(db.createJobStatusEvent).not.toHaveBeenCalled();
    expect(result.reply).toContain("確認");
  });

  it("does not create a job application when the latest user message is a negative confirmation", async () => {
    const db = await import("./db");
    vi.mocked(db.getJobApplications).mockResolvedValue([]);
    mockLLM
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: {
                name: "createJobApplication",
                arguments: JSON.stringify({
                  companyName: "未知株式会社",
                  status: "applied",
                  confirmedByUser: true,
                }),
              },
            }],
          },
        }],
      })
      .mockResolvedValueOnce(llmReply("追加はしません。必要なら会社名を確認してから進めます。"));

    const result = await handleAgentChat(1, "好的，但不要添加", "test-session", [
      {
        role: "assistant",
        content: "未知株式会社はまだ看板にないので、追加して更新していいですか？",
      },
    ]);

    expect(db.createJobApplication).not.toHaveBeenCalled();
    expect(db.createJobStatusEvent).not.toHaveBeenCalled();
    expect(result.reply).toContain("追加はしません");
  });

  it("creates a job application after a recent explicit confirmation", async () => {
    const db = await import("./db");
    vi.mocked(db.getJobApplications).mockResolvedValue([]);
    vi.mocked(db.createJobApplication).mockResolvedValue({ id: 22 });
    mockLLM
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: "",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: {
                name: "createJobApplication",
                arguments: JSON.stringify({
                  companyName: "未知株式会社",
                  status: "applied",
                  confirmedByUser: true,
                }),
              },
            }],
          },
        }],
      })
      .mockResolvedValueOnce(llmReply("未知株式会社を応募済みとして看板に追加しました。"));

    const result = await handleAgentChat(1, "はい、追加してください", "test-session", [
      {
        role: "assistant",
        content: "未知株式会社はまだ看板にないので、追加して更新していいですか？",
      },
    ]);

    expect(db.createJobApplication).toHaveBeenCalledWith({
      userId: 1,
      companyNameJa: "未知株式会社",
      status: "applied",
    });
    expect(db.createJobStatusEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        jobApplicationId: 22,
        source: "agent",
        prevStatus: null,
        nextStatus: "applied",
      })
    );
    expect(result.reply).toContain("追加しました");
  });

  it("saves conversation to memory", async () => {
    const { saveAgentMemory } = await import("./db");
    await handleAgentChat(1, "テスト", "s1", []);
    expect(saveAgentMemory).toHaveBeenCalledWith(
      expect.objectContaining({ memoryType: "conversation" })
    );
  });
});

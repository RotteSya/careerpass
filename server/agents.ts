import { invokeLLM, Tool } from "./_core/llm";
import {
  getUserById,
  getAgentMemory,
  saveAgentMemory,
  updateAgentSession,
  updateJobApplicationStatus,
  createJobApplication,
  getJobApplications,
  updateUserCalendarColorPrefs,
  countAgentMemory,
  deleteOldestAgentMemory,
} from "./db";
import { reconCompany as runRecon } from "./recon";
import crypto from "crypto";
import { loadAgentAgents, loadAgentSoul } from "./_core/soul";

// ── Harness Pattern: Per-call concurrency classification ─────────────────────
const CONCURRENT_SAFE_TOOLS = new Set(["runRecon", "setCalendarColor"]);

function classifyConcurrency<T extends { function: { name: string } }>(
  toolCalls: T[]
): { parallel: T[]; serial: T[] } {
  const parallel = toolCalls.filter((tc) => CONCURRENT_SAFE_TOOLS.has(tc.function.name));
  const serial = toolCalls.filter((tc) => !CONCURRENT_SAFE_TOOLS.has(tc.function.name));
  return { parallel, serial };
}

// ── Harness Pattern: Memory cap ──────────────────────────────────────────────
const MEMORY_CAP: Record<string, number> = {
  conversation: 100,
  company_report: 50,
};

type MemoryType = Parameters<typeof countAgentMemory>[1];

async function enforceMemoryCap(userId: number, memoryType: MemoryType): Promise<void> {
  const cap = MEMORY_CAP[memoryType];
  if (!cap) return;
  const currentCount = await countAgentMemory(userId, memoryType);
  if (currentCount > cap) {
    await deleteOldestAgentMemory(userId, memoryType, currentCount - cap);
  }
}

async function saveMemoryWithCap(memory: Parameters<typeof saveAgentMemory>[0]) {
  await saveAgentMemory(memory);
  await enforceMemoryCap(memory.userId, memory.memoryType);
}

async function buildSystemPrompt(params: { agentId: string; base: string; extraSystemInstruction?: string }) {
  const soul = await loadAgentSoul(params.agentId);
  const agents = await loadAgentAgents(params.agentId);
  const withSoul = soul.content ? `${params.base}\n\n[SOUL]\n${soul.content}` : params.base;
  const withSoulAndAgents = agents.content ? `${withSoul}\n\n[AGENTS]\n${agents.content}` : withSoul;
  return params.extraSystemInstruction
    ? `${withSoulAndAgents}\n\n[运行时附加指令]\n${params.extraSystemInstruction}`
    : withSoulAndAgents;
}

function normalizeCalendarColor(input: string): string | null {
  const v = input.trim().toLowerCase();
  const map: Record<string, string> = {
    blue: "9",
    蓝色: "9",
    藍色: "9",
    青: "9",
    orange: "6",
    橙色: "6",
    オレンジ: "6",
    red: "11",
    红色: "11",
    紅色: "11",
    赤: "11",
  };
  if (map[v]) return map[v];
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    if (n >= 1 && n <= 11) return String(n);
  }
  return null;
}

// ── Tool Registry ────────────────────────────────────────────────────────────

const TOOL_REGISTRY: Record<string, Tool> = {
  updateJobStatus: {
    type: "function",
    function: {
      name: "updateJobStatus",
      description: "Update the status of a job application (e.g., ES submitted, 1st interview, etc.)",
      parameters: {
        type: "object",
        properties: {
          companyName: { type: "string", description: "Name of the company" },
          status: {
            type: "string",
            enum: [
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
            ],
          },
        },
        required: ["companyName", "status"],
      },
    },
  },
  runRecon: {
    type: "function",
    function: {
      name: "runRecon",
      description: "Research a company's IR, pain points, and culture",
      parameters: {
        type: "object",
        properties: {
          companyName: { type: "string", description: "Name of the company to research" },
        },
        required: ["companyName"],
      },
    },
  },
  setCalendarColor: {
    type: "function",
    function: {
      name: "setCalendarColor",
      description: "Set user's auto-created calendar event color preference by category",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["briefing", "interview", "deadline"],
            description: "Event category to update color for",
          },
          color: {
            type: "string",
            description: "Color name or Google Calendar colorId (1-11)",
          },
        },
        required: ["category", "color"],
      },
    },
  },
};

const AGENT_TOOL_SETS: Record<string, string[]> = {
  careerpass: ["updateJobStatus", "runRecon", "setCalendarColor"],
  careerpassrecon: [],
};

function getToolsForAgent(agentId: string): Tool[] {
  const allowList = AGENT_TOOL_SETS[agentId] ?? [];
  return allowList.map((name) => TOOL_REGISTRY[name]).filter(Boolean);
}

const AGENT_TOOLS = getToolsForAgent("careerpass");

export function buildFixedOpening(
  user: Awaited<ReturnType<typeof getUserById>>,
  _sessionId: string
) {
  const lang = (user?.preferredLanguage ?? "ja") as "ja" | "zh" | "en";
  const name =
    user?.name ?? (lang === "zh" ? "同学" : lang === "en" ? "there" : "ユーザーさん");

  if (lang === "zh") {
    return (
      `您好 ${name}，我是您的贴身求职秘书。我帮您留意邮箱，记着每家公司走到哪一步，提醒您接下来该干什么。\n` +
      `我能帮您做这些事：\n` +
      `- 帮您留意邮箱，说明会 / 笔试 / 面试 / 截止日期一个不漏，第一时间告诉您\n` +
      `- 记着每家公司的进度，让您随时掌握全局\n` +
      `- 帮您做企业调研，面试前帮您整理好重点\n` +
      `- 提醒您接下来该做什么——比如"这家公司3天没回复了""明天有面试，记得准备"\n` +
      `- 把面试 / 截止自动写进您的 Google 日历\n` +
      `咱们开始吧——先告诉我，我应该怎么称呼您？`
    );
  }

  if (lang === "en") {
    return (
      `Hi ${name}, I'm your personal job search assistant. I keep an eye on your inbox, track every company's progress, and remind you what to do next.\n` +
      `Here's what I do for you:\n` +
      `- Watch your inbox and surface every briefing / test / interview / deadline the moment it lands\n` +
      `- Keep track of each company's progress so you always know where things stand\n` +
      `- Research companies before your interviews\n` +
      `- Remind you what's next — like "No response from this company in 3 days" or "Interview tomorrow, time to prep"\n` +
      `- Auto-write interviews and deadlines into your Google Calendar\n` +
      `Let's get started — what should I call you?`
    );
  }

  return (
    `${name}さん、はじめまして。私は就活パスの専属就活アシスタントです。あなたのメールを見守り、各社の進捗を管理し、次に何をすべきかをお知らせするのが私の仕事です。\n` +
    `私ができること：\n` +
    `- メールを見守って、説明会・Webテスト・面接・締切を検知したらすぐ通知\n` +
    `- 各社の進捗を常に把握し、最新の状態をお伝え\n` +
    `- 面接前に企業調査をして、要点を整理してお届け\n` +
    `- 次にやるべきことをリマインド——「この会社3日連絡なし」「明日面接、準備は？」など\n` +
    `- 面接や締切を Google カレンダーへ自動登録\n` +
    `さて、まず最初に——あなたのことは何とお呼びすればよいですか？`
  );
}

export async function handleAgentChat(
  userId: number,
  message: string,
  sessionId?: string,
  history: any[] = [],
  extraSystemInstruction?: string
) {
  const user = await getUserById(userId);
  const lang = user?.preferredLanguage ?? "ja";

  const sid = sessionId ?? crypto.randomUUID();

  if (history.length === 0) {
    const opening = buildFixedOpening(user, sid);
    await saveMemoryWithCap({
      userId,
      memoryType: "conversation",
      title: `Chat ${new Date().toISOString()}`,
      content: `User: ${message}\nAssistant: ${opening}`,
      metadata: {
        sessionId: sid,
        dialogue: [
          { role: "user", content: message },
          { role: "assistant", content: opening },
        ],
      },
    });
    return { reply: opening, sessionId: sid };
  }

  const educationMapJa: Record<string, string> = {
    high_school: "高校卒", associate: "短大・専門卒", bachelor: "大学卒（学士）",
    master: "大学院修士課程", doctor: "大学院博士課程", other: "その他",
  };
  const educationMapZh: Record<string, string> = {
    high_school: "高中毕业", associate: "专科/短大", bachelor: "本科",
    master: "硕士研究生", doctor: "博士研究生", other: "其他",
  };
  const birthYear = user?.birthDate ? parseInt(user.birthDate.split("-")[0]) : null;
  const age = birthYear ? new Date().getFullYear() - birthYear : null;
  const eduJa = user?.education ? (educationMapJa[user.education] ?? user.education) : "未記入";
  const eduZh = user?.education ? (educationMapZh[user.education] ?? user.education) : "未填写";

  const profileContextZh = `
【用户已知信息 — 禁止重复询问以下任何内容】
- 姓名: ${user?.name ?? "未填写"}
- 年龄: ${age ? `${age}岁` : "未填写"}
- 最终学历: ${eduZh}
- 学校名称: ${user?.universityName ?? "未填写"}
- 沟通语言偏好: 中文`;

  const profileContextEn = `
[User's Known Profile — DO NOT ask about any of the following]
- Name: ${user?.name ?? "not provided"}
- Age: ${age ? `${age} years old` : "not provided"}
- Education: ${user?.education ?? "not provided"}
- University: ${user?.universityName ?? "not provided"}
- Language preference: English`;

  const profileContextJa = `
【ユーザーの既知情報 — 以下の情報は絶対に再度質問しないこと】
- 氏名: ${user?.name ?? "未記入"}
- 年齢: ${age ? `${age}歳` : "未記入"}
- 最終学歴: ${eduJa}
- 大学・学校名: ${user?.universityName ?? "未記入"}
- 希望言語: 日本語`;

  const systemPrompt =
    lang === "zh"
      ? `你是"就活パス"的专属AI求职陪伴助手，像一位贴身秘书一样帮助用户。你的核心职责是帮用户留意邮箱、追踪求职进度、主动建议下一步行动。
1. 当用户提到面试或投递进度时，调用 updateJobStatus 工具更新数据库。
2. 当用户想要了解某家公司时，调用 runRecon 工具进行企业侦察。
3. 不要重复询问用户语言偏好和/register里已有的基础信息（姓名、生日、学历、学校）。
4. 当用户要求修改自动日程颜色时，调用 setCalendarColor（类别: 说明会/面试/締切）。
5. 当用户问"我该做什么"或提到求职进度时，基于他们的求职状态，主动给出具体建议（例如"这家公司3天没回复了""明天有面试，建议先看看侦察报告"）。
6. 排版要求：你的回复会被系统按空行切成多个 Telegram 气泡。请用空行（\n\n）把消息分成 2–5 个短气泡，每个气泡 1–3 句话，绝不要把一大段话挤在一起。短回复不需要分。
请用中文与用户交流。
${profileContextZh}`
      : lang === "en"
      ? `You are CareerPass, an AI job search companion assistant. Your core role is to monitor the user's inbox, track their job progress, and proactively suggest next steps.
1. Update job status via updateJobStatus tool when progress is mentioned.
2. Research companies via runRecon tool when requested.
3. Never re-ask language preference or basic profile fields already filled in /register.
4. If user asks to change auto-calendar event colors, call setCalendarColor.
5. When the user asks "what should I do?" or discusses their job search, proactively suggest concrete next steps based on their job board status (e.g., "No response from this company in 3 days", "Interview tomorrow — check the recon report").
6. Formatting: your reply will be split into Telegram bubbles by blank lines. Use \n\n to break a long message into 2–5 short bubbles (1–3 sentences each). Never cram everything into one paragraph. Short replies need no splitting.
Please communicate in English.
${profileContextEn}`
      : `あなたは「就活パス」専属のAI就活陪伴アシスタントです。メールの監視、就活の進捗管理、次のアクションの提案があなたの主な役割です。
1. 面接やエントリーの進捗が語られたら、updateJobStatusツールでデータベースを更新する。
2. 企業について知りたいと言われたら、runReconツールで調査を行う。
3. /registerで入力済みの言語設定・基本プロフィール（氏名、生年月日、学歴、学校名）を再質問しない。
4. 自動作成カレンダー予定の色変更を依頼されたら、setCalendarColorを使う（説明会/面接/締切）。
5. ユーザーが「次に何をすべき？」と聞いたり、就活の進捗について話したりしたら、求人ボードの状況に基づいて具体的なアドバイスを提案する（例：「この会社3日連絡なし」「明日面接——リサーチレポートを確認しましょう」）。
6. 表示ルール：返信はシステムが空行で分割し、Telegram の複数の吹き出しとして送信されます。長めの返信は \n\n で 2〜5 個の短い吹き出しに分けてください（各吹き出しは 1〜3 文）。一つの段落に詰め込まないこと。短い返信は分割不要です。
日本語でユーザーとコミュニケーションしてください。
${profileContextJa}`;

  const effectiveSystemPrompt = await buildSystemPrompt({
    agentId: "careerpass",
    base: systemPrompt,
    extraSystemInstruction,
  });

  const messages = [
    { role: "system" as const, content: effectiveSystemPrompt },
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: message },
  ];

  const response = await invokeLLM({ messages, tools: AGENT_TOOLS, tool_choice: "auto" });
  const choice = response.choices?.[0]?.message;

  if (choice?.tool_calls && choice.tool_calls.length > 0) {
    const { parallel, serial } = classifyConcurrency(choice.tool_calls);
    const resultMap = new Map<string, string>();

    const executeTool = async (toolCall: { id: string; function: { name: string; arguments: string } }): Promise<void> => {
      const args = JSON.parse(toolCall.function.arguments);
      if (toolCall.function.name === "updateJobStatus") {
        const apps = await getJobApplications(userId);
        let app = apps.find(a => a.companyNameJa === args.companyName || a.companyNameEn === args.companyName);
        if (!app) {
          await createJobApplication({ userId, companyNameJa: args.companyName });
          const freshApps = await getJobApplications(userId);
          app = freshApps.find(a => a.companyNameJa === args.companyName);
        }
        if (app) {
          await updateJobApplicationStatus(app.id, userId, args.status as any);
          resultMap.set(toolCall.id, `Updated ${args.companyName} status to ${args.status}`);
        }
      } else if (toolCall.function.name === "runRecon") {
        const report = await reconCompany(userId, args.companyName);
        resultMap.set(toolCall.id, `Generated recon report for ${args.companyName}:\n${report.slice(0, 500)}...`);
      } else if (toolCall.function.name === "setCalendarColor") {
        const category = args.category as "briefing" | "interview" | "deadline";
        const colorId = normalizeCalendarColor(String(args.color ?? ""));
        if (!colorId) {
          resultMap.set(toolCall.id, `Invalid color: ${args.color}. Use blue/orange/red or colorId(1-11).`);
        } else {
          await updateUserCalendarColorPrefs(userId, { [category]: colorId });
          resultMap.set(toolCall.id, `Updated ${category} calendar color to ${colorId}`);
        }
      }
    }

    if (parallel.length > 0) {
      await Promise.all(parallel.map(executeTool));
    }
    for (const tc of serial) {
      await executeTool(tc);
    }

    const followUpMessages = [
      ...messages,
      { role: "assistant" as const, content: "", tool_calls: choice.tool_calls },
      ...choice.tool_calls.map((tc) => ({
        role: "tool" as const,
        tool_call_id: tc.id,
        content: resultMap.get(tc.id) || "Success",
      })),
    ];
    const finalResponse = await invokeLLM({ messages: followUpMessages });
    const finalReply = finalResponse.choices?.[0]?.message?.content;
    const reply = typeof finalReply === "string" ? finalReply : "Done";

    await saveMemoryWithCap({
      userId,
      memoryType: "conversation",
      title: `Chat ${new Date().toISOString()}`,
      content: `User: ${message}\nAssistant: ${reply}`,
      metadata: {
        sessionId: sid,
        dialogue: [
          { role: "user", content: message },
          { role: "assistant", content: reply },
        ],
      },
    });
    return { reply, sessionId: sid };
  }

  const rawReply = choice?.content;
  const reply = typeof rawReply === "string" ? rawReply : "Error";

  await saveMemoryWithCap({
    userId,
    memoryType: "conversation",
    title: `Chat ${new Date().toISOString()}`,
    content: `User: ${message}\nAssistant: ${reply}`,
    metadata: {
      sessionId: sid,
      dialogue: [
        { role: "user", content: message },
        { role: "assistant", content: reply },
      ],
    },
  });

  return { reply, sessionId: sid };
}

export async function reconCompany(userId: number, companyName: string, jobApplicationId?: number) {
  const reconResult = await runRecon(companyName);

  const strategyLabel: Record<string, string> = {
    firecrawl: "Firecrawl深度スクレイピング",
    tavily: "Tavily AI検索",
    llm_only: "LLM内部知識のみ",
  };

  const systemPrompt = `あなたは日本の就活コンサルタントです。以下の情報源を分析し、就活生向けの《企業深度簡報》を作成してください。

情報収集戦略: ${strategyLabel[reconResult.strategy]}

${reconResult.rawText ? `収集した情報源:
${reconResult.rawText.slice(0, 8000)}` : `情報源なし。内部知識のみで分析してください。`}

レポート形式（${companyName}_Recon_Report.md）に必ず以下4セクションを含めてください：

## 【基本情報と中期戦略】
## 【内部の実態・黒料】
## 【求める人間像（核心推論）】
## 【高価値逆質問設計】`;
  const effectiveSystemPrompt = await buildSystemPrompt({ agentId: "careerpassrecon", base: systemPrompt });

  const response = await invokeLLM({
    messages: [
      { role: "system", content: effectiveSystemPrompt },
      { role: "user", content: `${companyName}の《企業深度簡報》を作成してください。` },
    ],
  });

  const rawReport = response.choices?.[0]?.message?.content;
  const reportContent = typeof rawReport === "string" ? rawReport : "Failed to generate report.";

  await saveMemoryWithCap({
    userId,
    memoryType: "company_report",
    title: `${companyName}_Recon_Report.md`,
    content: reportContent,
    metadata: {
      companyName,
      jobApplicationId,
      reconStrategy: reconResult.strategy,
      sourcesCount: reconResult.sources.length,
    },
  });

  return reportContent;
}

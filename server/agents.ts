import { invokeLLM, Tool } from "./_core/llm";
import {
  getUserById,
  getAgentMemory,
  saveAgentMemory,
  updateJobApplicationStatus,
  createJobApplication,
  getJobApplications,
} from "./db";
import { reconCompany as runRecon } from "./recon";
import crypto from "crypto";

const AGENT_TOOLS: Tool[] = [
  {
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
              "es_preparing",
              "es_submitted",
              "interview_1",
              "interview_2",
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
  {
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
];

function educationLabel(lang: "ja" | "zh" | "en", edu?: string | null): string {
  const mapJa: Record<string, string> = {
    high_school: "高校卒",
    associate: "短大・専門卒",
    bachelor: "大学卒（学士）",
    master: "大学院修士課程",
    doctor: "大学院博士課程",
    other: "その他",
  };
  const mapZh: Record<string, string> = {
    high_school: "高中毕业",
    associate: "专科/短大",
    bachelor: "本科",
    master: "硕士研究生",
    doctor: "博士研究生",
    other: "其他",
  };
  const mapEn: Record<string, string> = {
    high_school: "High School",
    associate: "Associate",
    bachelor: "Bachelor's",
    master: "Master's",
    doctor: "Doctorate",
    other: "Other",
  };
  if (!edu) {
    return lang === "zh" ? "未填写" : lang === "en" ? "not provided" : "未記入";
  }
  if (lang === "zh") return mapZh[edu] ?? edu;
  if (lang === "en") return mapEn[edu] ?? edu;
  return mapJa[edu] ?? edu;
}

function buildFixedOpening(
  user: Awaited<ReturnType<typeof getUserById>>,
  sessionId: string
) {
  const lang = (user?.preferredLanguage ?? "ja") as "ja" | "zh" | "en";
  const name =
    user?.name ?? (lang === "zh" ? "同学" : lang === "en" ? "there" : "ユーザーさん");
  const birthDate =
    user?.birthDate ??
    (lang === "zh" ? "未填写" : lang === "en" ? "not provided" : "未記入");
  const education = educationLabel(lang, user?.education);
  const university =
    user?.universityName ??
    (lang === "zh" ? "未填写" : lang === "en" ? "not provided" : "未記入");
  const profileId = `user_${sessionId}`;

  if (lang === "zh") {
    return `您好，${name}。我是就活パス。我知道您正处于一个开始迈入社会的特殊阶段，请让我和您一起努力。\n\n您的档案ID是：*${profileId}*、您是*${birthDate}*出生的*${name}*，*${education}*，来自*${university}*，没错吧？\n\n您是新卒，还是有过工作经验呢？`;
  }

  if (lang === "en") {
    return `Hello, ${name}. I am CareerPass. I understand you are at a special stage of stepping into society, and I would like to work hard together with you.\n\nYour profile ID is: *${profileId}*. You were born on *${birthDate}*, your name is *${name}*, your education is *${education}*, and you are from *${university}*, correct?\n\nAre you a new graduate, or do you already have work experience?`;
  }

  return `こんにちは、${name}さん。私は就活パスです。社会に踏み出す大切な時期だと理解しています。ぜひ一緒に頑張りましょう。\n\nあなたのプロフィールIDは *${profileId}* です。*${birthDate}* 生まれの *${name}* さんで、*${education}*、*${university}* ご出身でお間違いないですか？\n\nあなたは新卒ですか？それとも就業経験がありますか？`;
}

export async function handleAgentChat(userId: number, message: string, sessionId?: string, history: any[] = []) {
  const user = await getUserById(userId);
  const lang = user?.preferredLanguage ?? "ja";

  const sid = sessionId ?? crypto.randomUUID();

  // Keep first-turn greeting deterministic across all accounts.
  if (history.length === 0) {
    const opening = buildFixedOpening(user, sid);
    await saveAgentMemory({
      userId,
      memoryType: "conversation",
      title: `Chat ${new Date().toISOString()}`,
      content: `User: ${message}\nAssistant: ${opening}`,
      metadata: { sessionId: sid },
    });
    return { reply: opening, sessionId: sid };
  }

  // ... (rest of profile context logic stays same)
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
      ? `你是"就活パス"的专属AI求职顾问。你的核心职责：
1. 用STAR法则深挖用户的经历。
2. 引导用户导出 Gemini/ChatGPT 的历史对话。
3. 当用户提到面试或投递进度时，调用 updateJobStatus 工具更新数据库。
4. 当用户想要了解某家公司时，调用 runRecon 工具进行侦察。
5. 不要重复询问用户语言偏好和/register里已有的基础信息（姓名、生日、学历、学校）。
请用中文与用户交流。
${profileContextZh}`
      : lang === "en"
      ? `You are CareerPass, an AI career advisor. Your core responsibilities:
1. Use STAR method to explore user experiences.
2. Guide users to export history.
3. Update job status via updateJobStatus tool when progress is mentioned.
4. Research companies via runRecon tool when requested.
5. Never re-ask language preference or basic profile fields already filled in /register.
Please communicate in English.
${profileContextEn}`
      : `あなたは「就活パス」専属のAIキャリアアドバイザーです。
主な役割：
1. STAR法を使って経験を深堀りする。
2. 面接やエントリーの進捗が語られたら、updateJobStatusツールでデータベースを更新する。
3. 企業について知りたいと言われたら、runReconツールで調査を行う。
4. /registerで入力済みの言語設定・基本プロフィール（氏名、生年月日、学歴、学校名）を再質問しない。
日本語でユーザーとコミュニケーションしてください。
${profileContextJa}`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: message },
  ];

  const response = await invokeLLM({ messages, tools: AGENT_TOOLS, tool_choice: "auto" });
  const choice = response.choices?.[0]?.message;

  if (choice?.tool_calls && choice.tool_calls.length > 0) {
    const results: string[] = [];
    for (const toolCall of choice.tool_calls) {
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
          results.push(`Updated ${args.companyName} status to ${args.status}`);
        }
      } else if (toolCall.function.name === "runRecon") {
        const report = await reconCompany(userId, args.companyName);
        results.push(`Generated recon report for ${args.companyName}:\n${report.slice(0, 500)}...`);
      }
    }

    // Follow up with LLM after tool calls
    const followUpMessages = [
      ...messages,
      { role: "assistant" as const, content: "", tool_calls: choice.tool_calls },
      ...choice.tool_calls.map((tc, i) => ({
        role: "tool" as const,
        tool_call_id: tc.id,
        content: results[i] || "Success",
      })),
    ];
    const finalResponse = await invokeLLM({ messages: followUpMessages });
    const finalReply = finalResponse.choices?.[0]?.message?.content;
    const reply = typeof finalReply === "string" ? finalReply : "Done";

    await saveAgentMemory({
      userId,
      memoryType: "conversation",
      title: `Chat ${new Date().toISOString()}`,
      content: `User: ${message}\nAssistant: ${reply}`,
      metadata: { sessionId: sid },
    });
    return { reply, sessionId: sid };
  }

  const rawReply = choice?.content;
  const reply = typeof rawReply === "string" ? rawReply : "Error";

  await saveAgentMemory({
    userId,
    memoryType: "conversation",
    title: `Chat ${new Date().toISOString()}`,
    content: `User: ${message}\nAssistant: ${reply}`,
    metadata: { sessionId: sid },
  });

  return { reply, sessionId: sid };
}

export async function generateResume(userId: number, experiences: string, sessionId: string) {
  // ... (keep generateResume same)
  const systemPrompt = `あなたはプロのキャリアアドバイザーです。ユーザーの経験を元に、日本の就活で使える構造化された履歴書（USER_${sessionId}.md形式）を作成してください。
STAR法則に基づいて各経験を整理し、以下の形式で出力してください：
# USER_${sessionId} - 個人履歴書
## 基本情報
## 学歴
## 職務・インターン経験（STAR形式）
## スキル・強み
## 自己分析`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: experiences },
    ],
  });

  const rawResume = response.choices?.[0]?.message?.content;
  const resumeContent = typeof rawResume === "string" ? rawResume : "Failed to generate resume.";

  await saveAgentMemory({
    userId,
    memoryType: "resume",
    title: `USER_${sessionId}.md`,
    content: resumeContent,
    metadata: { sessionId },
  });

  return resumeContent;
}

export async function reconCompany(userId: number, companyName: string, jobApplicationId?: number) {
  // ... (keep reconCompany same)
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

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `${companyName}の《企業深度簡報》を作成してください。` },
    ],
  });

  const rawReport = response.choices?.[0]?.message?.content;
  const reportContent = typeof rawReport === "string" ? rawReport : "Failed to generate report.";

  await saveAgentMemory({
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

export async function generateES(userId: number, companyName: string, position: string, sessionId: string) {
  // ... (keep generateES same)
  const memories = await getAgentMemory(userId);
  const resume = memories.find((m) => m.memoryType === "resume");
  const report = memories.find(
    (m) => m.memoryType === "company_report" && m.title.includes(companyName)
  );

  const systemPrompt = `あなたはプロの就活アドバイザーです。以下の情報を元に、${companyName}の${position}ポジション向けの日本語ESを作成してください。

ESには必ず以下の2つのセクションを含めてください：
1. 志望動機 - 企業の実際の課題・痛点と自分の能力を結びつけ、なぜこの会社でなければならないかを説明
2. 自己PR - STAR法則に基づいた具体的な経験と強みのアピール

企業情報：
${report?.content ?? "（企業情報なし）"}

ユーザー履歴書：
${resume?.content ?? "（履歴書なし）"}`;

  const requiredSections = ["志望動機", "自己PR"];

  const callLLM = async () => {
    const res = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${companyName}の${position}向けのESを作成してください。` },
      ],
    });
    const raw = res.choices?.[0]?.message?.content;
    return typeof raw === "string" ? raw : "Failed to generate ES.";
  };

  let esContent = await callLLM();

  // Retry once if required sections are missing
  const missingSections = requiredSections.filter((s) => !esContent.includes(s));
  if (missingSections.length > 0) {
    esContent = await callLLM();
  }

  await saveAgentMemory({
    userId,
    memoryType: "es_draft",
    title: `${companyName}_${position}_ES.md`,
    content: esContent,
    metadata: { companyName, position, sessionId },
  });

  return esContent;
}

export async function startInterview(userId: number, companyName: string, position: string, history: any[] = [], userAnswer?: string) {
  // ... (keep startInterview same)
  const memories = await getAgentMemory(userId);
  const report = memories.find(
    (m) => m.memoryType === "company_report" && m.title.includes(companyName)
  );
  const esDraft = memories.find(
    (m) => m.memoryType === "es_draft" && m.title.includes(companyName)
  );

  const systemPrompt = `あなたは${companyName}の採用面接官です。非常に厳格で、曖昧な回答を絶対に許さない、本物の日本企業の面接官として振る舞ってください。
全て丁寧語・敬語を使用してください。
【重要ルール】毎回必ず1つの質問のみを行い、ユーザーの回答を待ってから次の質問をしてください。複数の質問を一度にしてはいけません。
候補者のESと企業情報を熟読し、ESの内容を深掘りする鋭い質問をしてください。

企業情報：
${report?.content ?? ""}

候補者のES：
${esDraft?.content ?? ""}`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  if (history.length === 0) {
    messages.push({ role: "user" as const, content: "面接を開始してください。" });
  } else if (userAnswer) {
    messages.push({ role: "user" as const, content: userAnswer });
  }

  const response = await invokeLLM({ messages });
  const rawQuestion = response.choices?.[0]?.message?.content;
  let question = typeof rawQuestion === "string" ? rawQuestion : "Failed to start interview.";

  // Enforce single-question rule
  const questionMarks = (question.match(/[？?]/g) ?? []).length;
  if (questionMarks > 1) {
    const parts = question.split(/(?<=[？?])/);
    const firstQuestion = parts.find(p => /[？?]/.test(p));
    if (firstQuestion) {
      const firstQIdx = question.indexOf(firstQuestion);
      const preamble = firstQIdx > 0 ? question.slice(0, firstQIdx) : "";
      question = (preamble + firstQuestion).trim();
    }
  }

  return question;
}

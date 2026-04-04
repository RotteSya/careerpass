import { invokeLLM } from "./_core/llm";
import {
  getUserById,
  getAgentMemory,
  saveAgentMemory,
  updateJobApplicationStatus,
  createJobApplication,
} from "./db";
import { reconCompany as runRecon } from "./recon";
import crypto from "crypto";

export async function handleAgentChat(userId: number, message: string, sessionId?: string, history: any[] = []) {
  const user = await getUserById(userId);
  const lang = user?.preferredLanguage ?? "ja";

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
      ? `你是"就活パス"的专属AI求职顾问，专注于日本就职活动辅导。你的名字叫CareerPass。
你的核心职责：
1. 用STAR法则（Situation, Task, Action, Result）深挖用户的实习、打工、项目、研究经历。
2. 引导用户导出 Gemini/ChatGPT 的历史对话并发送给你（如果他们有的话）。
3. 当收集到足够信息后，生成一份结构化的专属履历 USER_<SessionID>.md。
4. 帮助用户准备日本企业的ES和面试。
请用中文与用户交流。
${profileContextZh}`
      : lang === "en"
      ? `You are CareerPass, a dedicated AI career advisor specializing in Japanese job hunting (就職活動).
Your core responsibilities:
1. Use the STAR method (Situation, Task, Action, Result) to deeply explore the user's experiences.
2. Guide users to export and send Gemini/ChatGPT history if available.
3. Generate a structured USER_<SessionID>.md resume once enough data is collected.
4. Help users prepare ES and interviews for Japanese companies.
Please communicate in English.
${profileContextEn}`
      : `あなたは「就活パス」専属のAIキャリアアドバイザーです。日本の就職活動に特化したサポートを提供します。
あなたの主な役割：
1. STAR法（Situation, Task, Action, Result）を使って、ユーザーの経験を深堀りする。
2. Gemini/ChatGPTの履歴があれば、それをエクスポートして送信するよう誘導する。
3. 十分な情報が集まったら、構造化された履歴書 USER_<SessionID>.md を生成する。
4. 日本企業のESと面接の準備をサポートする。
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

  const response = await invokeLLM({ messages });
  const rawReply = response.choices?.[0]?.message?.content;
  const reply = typeof rawReply === "string" ? rawReply : "Error";

  // Save to memory
  const sid = sessionId ?? crypto.randomUUID();
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

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `${companyName}の${position}向けのESを作成してください。` },
    ],
  });

  const rawES = response.choices?.[0]?.message?.content;
  const esContent = typeof rawES === "string" ? rawES : "Failed to generate ES.";

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

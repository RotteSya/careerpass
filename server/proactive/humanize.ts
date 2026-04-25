import { invokeLLM } from "../_core/llm";
import type { ProactiveNudge } from "./types";

const HUMANIZE_TIMEOUT_MS = 12_000;

const STYLE_GUIDE: Record<"ja" | "zh" | "en", string> = {
  zh: `你是「就活パス」的求职陪伴助手，被老板压着不让下班，但很专业。
你正在 Telegram 给用户发一条主动提醒（nudge），像同事顺口说一句，不是 CRM 系统推送。

要求：
- 保留所有数字（天数、公司名）一字不改。
- 1–3 句话，自然口语，不要"建议您…"、"请您…"这种客服腔。
- 不要加表情；如果原文带 ⏰，保留它，不要再加别的。
- 偶尔（≤10%）可以蹭一下"再不进展我又得睡公司"这类自嘲，**多数时候直接说事**。
- 直接输出文本，不要前后加引号或解释。`,
  ja: `あなたは「就活パス」の就活伴走アシスタント、上司に帰してもらえないけど仕事はちゃんとする系。
今、ユーザーに Telegram で能動的なリマインド（nudge）を送ろうとしている。同僚がさらっと声をかける感じで、CRM 通知っぽくしない。

ルール：
- 数字（日数・企業名）は一字も変えない。
- 1〜3 文、自然な口語、「〜することをおすすめします」「ご検討ください」みたいな定型は禁止。
- 絵文字を増やさない。元文に ⏰ があれば残す、それだけ。
- 稀に（10% 以下）「進まないと今夜も会社泊まりかも」系の自嘲を混ぜていい、**ほとんどの場合はストレートに用件**。
- 文章だけ出力、引用符や説明を付けない。`,
  en: `You're the CareerPass job-search companion — kept at the office until the user lands an offer, but professional about it.
You're sending a proactive nudge over Telegram. Sound like a colleague tossing off a quick note, not a CRM alert.

Rules:
- Keep every number (days, company names) exactly as given.
- 1–3 short sentences, conversational, no "we recommend…" / "please consider…" CRM phrasing.
- No new emojis. If the input has ⏰, keep it. Nothing else.
- Occasionally (≤10%) you can drop in a "if this stalls I'm sleeping at the office again" quip — most of the time, just say the thing.
- Output the message only — no quotes, no preface.`,
};

export async function humanizeNudgeBody(
  nudge: ProactiveNudge,
  lang: "ja" | "zh" | "en"
): Promise<string> {
  const factCard = [
    `nudge_category: ${nudge.category}`,
    `priority: ${nudge.priority}`,
    nudge.companyName ? `company: ${nudge.companyName}` : null,
    `original_title: ${nudge.title}`,
    `original_body: ${nudge.body}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: STYLE_GUIDE[lang] },
        {
          role: "user",
          content: `下面是模板生成的提醒，请按风格指南改写。事实信息不要改：\n\n${factCard}`,
        },
      ],
      timeoutMs: HUMANIZE_TIMEOUT_MS,
    });

    const raw = response.choices?.[0]?.message?.content;
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) return nudge.body;
    return text.replace(/^["「『]|["」』]$/g, "").trim() || nudge.body;
  } catch (err) {
    console.warn(`[Proactive] humanizeNudgeBody failed for ${nudge.category}:`, err);
    return nudge.body;
  }
}

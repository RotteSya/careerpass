type MailEventType =
  | "interview"
  | "briefing"
  | "test"
  | "deadline"
  | "entry"
  | "offer"
  | "rejection"
  | "other";

interface MailDecisionLike {
  isJobRelated: boolean;
  confidence: number;
  reason: string;
  eventType?: string | null;
  companyName?: string | null;
  eventDate?: string | null;
  eventTime?: string | null;
  location?: string | null;
  todoItems?: string[] | null;
}

export interface RecruitingNlpInput {
  subject: string;
  body: string;
  from: string;
  domainSignal: number;
  fallbackDate: string | null;
  fallbackTime: string | null;
}

export interface RecruitingNlpDecision extends MailDecisionLike {
  eventType: MailEventType;
  companyName: string | null;
  eventDate: string | null;
  eventTime: string | null;
  location: string | null;
  todoItems: string[];
  shouldSkipLlm: boolean;
}

const JOB_PLATFORM_HINTS = /(syukatsu-kaigi|syukatsukaigi|就活会議|openwork|vorkers|onecareer|one-career|offerbox|goodfind)/i;
const PROCESS_HINTS = /(選考|面接|面談|説明会|webテスト|spi|適性検査|筆記試験|締切|提出期限|エントリー|応募|内定|不採用|お見送り|合否)/i;

function normalizeEventType(v: string | null | undefined): MailEventType {
  if (v === "interview" || v === "briefing" || v === "test" || v === "deadline" || v === "entry" || v === "offer" || v === "rejection" || v === "other") {
    return v;
  }
  return "other";
}

function normalizeCompanyName(name: string | null | undefined): string | null {
  const raw = (name ?? "").trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/^(【|「|\[|\()(.+?)(】|」|\]|\))$/, "$2")
    .replace(/(採用|採用担当|人事部|HR|Recruiting)$/i, "")
    .trim();
  if (cleaned.length < 2) return null;
  if (JOB_PLATFORM_HINTS.test(cleaned)) return null;
  return cleaned;
}

function extractCompanyCandidate(input: RecruitingNlpInput): string | null {
  const subject = input.subject;
  const from = input.from;

  const legalName = subject.match(/((?:株式会社|合同会社)\s*[^\s【】\[\]<>]{1,40})/);
  if (legalName?.[1]) return normalizeCompanyName(legalName[1]);

  const bracket = subject.match(/【([^】]{2,30})】/);
  if (bracket?.[1]) return normalizeCompanyName(bracket[1]);

  const dm = from.match(/@([a-zA-Z0-9-]+)\./);
  if (dm?.[1]) {
    const sld = dm[1];
    if (!/^(gmail|yahoo|outlook|hotmail|icloud|mail|noreply|no-reply)$/i.test(sld)) {
      return normalizeCompanyName(sld);
    }
  }
  return null;
}

function inferRuleEventType(text: string): { eventType: MailEventType; confidence: number; reason: string } {
  if (/(不採用|見送り|お見送り|不合格|不通過|rejected|not selected|we regret|残念ながら)/i.test(text)) {
    return { eventType: "rejection", confidence: 0.95, reason: "rule:rejection" };
  }
  if (/(内定|offer|採用決定|内々定)/i.test(text)) {
    return { eventType: "offer", confidence: 0.95, reason: "rule:offer" };
  }
  if (/(面接|面談|interview|一次面接|二次面接|最終面接)/i.test(text)) {
    return { eventType: "interview", confidence: 0.9, reason: "rule:interview" };
  }
  if (/(説明会|セミナー|会社説明|briefing)/i.test(text)) {
    return { eventType: "briefing", confidence: 0.85, reason: "rule:briefing" };
  }
  if (/(webテスト|spi|適性検査|筆記試験|test)/i.test(text)) {
    return { eventType: "test", confidence: 0.9, reason: "rule:test" };
  }
  if (/(締切|提出期限|deadline|es提出|エントリーシート提出)/i.test(text)) {
    return { eventType: "deadline", confidence: 0.85, reason: "rule:deadline" };
  }
  if (/(エントリー完了|応募完了|受付完了|application received|entry)/i.test(text)) {
    return { eventType: "entry", confidence: 0.8, reason: "rule:entry" };
  }
  return { eventType: "other", confidence: 0.35, reason: "rule:other" };
}

function defaultTodo(eventType: MailEventType): string[] {
  if (eventType === "interview") return ["确认面试时间和形式，准备1分钟自我介绍"];
  if (eventType === "briefing") return ["确认说明会参加方式，提前准备2个问题"];
  if (eventType === "test") return ["确认测试平台和时限，先做一次模拟题"];
  if (eventType === "deadline") return ["把提交截止时间写入日程并预留缓冲"];
  if (eventType === "entry") return ["确认报名材料已齐全并保留提交凭证"];
  if (eventType === "offer") return ["确认 offer 条件与回复期限"];
  if (eventType === "rejection") return ["记录未通过原因并更新后续投递策略"];
  return [];
}

export function runRecruitingNlpPipeline(
  input: RecruitingNlpInput,
  llmDecision?: MailDecisionLike | null
): RecruitingNlpDecision {
  const text = `${input.subject}\n${input.body}\n${input.from}`;
  const lowerText = text.toLowerCase();
  const rule = inferRuleEventType(lowerText);
  const ruleCompany = extractCompanyCandidate(input);

  const obviousPlatformNoise = JOB_PLATFORM_HINTS.test(lowerText) && !PROCESS_HINTS.test(lowerText);
  if (obviousPlatformNoise) {
    return {
      isJobRelated: false,
      confidence: 0.98,
      reason: "hard-negative:platform-noise",
      eventType: "other",
      companyName: null,
      eventDate: input.fallbackDate,
      eventTime: input.fallbackTime,
      location: null,
      todoItems: [],
      shouldSkipLlm: true,
    };
  }

  const llmEventType = normalizeEventType(llmDecision?.eventType ?? null);
  const hardRuleOutcome = rule.eventType === "offer" || rule.eventType === "rejection";
  const mergedEventType: MailEventType = hardRuleOutcome
    ? rule.eventType
    : llmEventType !== "other"
    ? llmEventType
    : rule.eventType;

  const llmConfidence =
    typeof llmDecision?.confidence === "number" && Number.isFinite(llmDecision.confidence)
      ? Math.max(0, Math.min(1, llmDecision.confidence))
      : 0;
  const mergedConfidence = llmDecision
    ? Math.max(0, Math.min(1, llmConfidence * 0.7 + rule.confidence * 0.3))
    : Math.max(rule.confidence, input.domainSignal * 0.7);

  const mergedIsJobRelated = llmDecision
    ? !!llmDecision.isJobRelated || mergedEventType !== "other"
    : mergedEventType !== "other" || (input.domainSignal >= 0.9 && !!input.fallbackDate);

  const mergedCompany = normalizeCompanyName(llmDecision?.companyName ?? null) ?? ruleCompany;
  const mergedTodo =
    (Array.isArray(llmDecision?.todoItems) ? llmDecision?.todoItems : null)?.filter(
      (t): t is string => typeof t === "string" && t.trim().length > 0
    ) ?? defaultTodo(mergedEventType);

  return {
    isJobRelated: mergedIsJobRelated,
    confidence: mergedConfidence,
    reason: llmDecision ? `${llmDecision.reason ?? "llm"} | ${rule.reason}` : rule.reason,
    eventType: mergedEventType,
    companyName: mergedCompany ?? null,
    eventDate: llmDecision?.eventDate ?? input.fallbackDate,
    eventTime: llmDecision?.eventTime ?? input.fallbackTime,
    location: llmDecision?.location ?? null,
    todoItems: mergedTodo.slice(0, 3),
    shouldSkipLlm: false,
  };
}

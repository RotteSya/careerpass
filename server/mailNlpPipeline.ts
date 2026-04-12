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
const NON_COMPANY_NAME_HINTS =
  /(noreply|no-reply|support|info|notification|採用担当|人事部|運営事務局|マイページ|事務局|team|system)/i;

const EVENT_RULES: Array<{ eventType: MailEventType; confidence: number; reason: string; pattern: RegExp }> = [
  {
    eventType: "rejection",
    confidence: 0.97,
    reason: "rule:rejection",
    pattern:
      /(不採用|見送り|お見送り|不合格|不通過|残念ながら|ご期待に添え|rejected|not selected|we regret|selection result.*unsuccessful)/i,
  },
  {
    eventType: "offer",
    confidence: 0.97,
    reason: "rule:offer",
    pattern: /(内定|内々定|offer|採用決定|採用通知|内定通知|job offer)/i,
  },
  {
    eventType: "interview",
    confidence: 0.92,
    reason: "rule:interview",
    pattern: /(面接|面談|interview|一次面接|二次面接|三次面接|最終面接|グループ面接|個別面接|面接日程)/i,
  },
  {
    eventType: "test",
    confidence: 0.9,
    reason: "rule:test",
    pattern: /(webテスト|spi|適性検査|筆記試験|テスト受検|受検案内|coding test|online assessment|assessment)/i,
  },
  {
    eventType: "deadline",
    confidence: 0.9,
    reason: "rule:deadline",
    pattern:
      /(締切|提出期限|deadline|提出期日|エントリーシート提出|es提出|回答期限|期限までに|応募締切|予約締切)/i,
  },
  {
    eventType: "briefing",
    confidence: 0.86,
    reason: "rule:briefing",
    pattern: /(説明会|セミナー|会社説明|briefing|会社紹介|オープンカンパニー|web説明会|オンライン説明会)/i,
  },
  {
    eventType: "entry",
    confidence: 0.82,
    reason: "rule:entry",
    pattern:
      /(エントリー完了|応募完了|受付完了|応募受付|エントリー受付|application received|entry completed|ご応募ありがとうございます)/i,
  },
];

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
    .replace(/^[\s\-:：|｜]+|[\s\-:：|｜]+$/g, "")
    .replace(/(株式会社|（株）|\(株\))/g, "株式会社")
    .replace(/(採用|採用担当|採用事務局|人事部|人事|HR|Recruiting|recruit)$/i, "")
    .trim();
  if (cleaned.length < 2) return null;
  if (JOB_PLATFORM_HINTS.test(cleaned)) return null;
  if (NON_COMPANY_NAME_HINTS.test(cleaned)) return null;
  return cleaned;
}

function extractCompanyCandidate(input: RecruitingNlpInput): string | null {
  const subject = input.subject;
  const from = input.from;
  const displayName = from.split("<")[0]?.trim() ?? "";

  const legalName = subject.match(/((?:株式会社|合同会社)\s*[^\s【】\[\]<>]{1,40})/);
  if (legalName?.[1]) return normalizeCompanyName(legalName[1]);

  const fromLegalName = `${displayName}\n${subject}`.match(/((?:株式会社|合同会社)\s*[^\n【】\[\]<>]{1,40})/);
  if (fromLegalName?.[1]) return normalizeCompanyName(fromLegalName[1]);

  const fromBrackets = displayName.match(/(?:【|\[|「)?([^】\]」]{2,30})(?:】|\]|」)?\s*(?:採用|採用担当|人事|HR)/i);
  if (fromBrackets?.[1]) return normalizeCompanyName(fromBrackets[1]);

  const subjectCompanyLead = subject.match(/^(?:\[|【)?([^】\]\s]{2,24})(?:\]|】)?\s*(?:採用|選考|面接|説明会|エントリー)/);
  if (subjectCompanyLead?.[1]) return normalizeCompanyName(subjectCompanyLead[1]);

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
  for (const rule of EVENT_RULES) {
    if (rule.pattern.test(text)) {
      return { eventType: rule.eventType, confidence: rule.confidence, reason: rule.reason };
    }
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

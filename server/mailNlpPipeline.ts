/**
 * mailNlpPipeline.ts — Hybrid classification pipeline (heuristic rules + LLM)
 *
 * Architecture inspired by JobFight:
 *   1. Multi-signal rule scoring (not first-match — ALL rules evaluated)
 *   2. Domain reputation & negative signal filtering
 *   3. NER-based entity extraction (company, date/time, location)
 *   4. Dynamic confidence merging with LLM output
 */

import {
  extractBestCompanyName,
  extractBestDateTime,
  extractLocation,
  detectInterviewRound,
  getDomainReputation,
  calculateNegativeSignalPenalty,
  type DomainReputation,
  type InterviewRound,
} from "./mailNer";

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
  /** Extra metadata exposed for downstream logic / debugging */
  _meta?: {
    domainReputation: DomainReputation;
    interviewRound: InterviewRound | null;
    negPenalty: number;
    ruleSignals: Array<{ eventType: MailEventType; confidence: number; reason: string }>;
  };
}

// ─── Platform noise ──────────────────────────────────────────────────────────

const JOB_PLATFORM_HINTS =
  /(syukatsu-kaigi|syukatsukaigi|就活会議|openwork|vorkers|onecareer|one-career|offerbox|goodfind)/i;
const PROCESS_HINTS =
  /(選考|面接|面談|説明会|webテスト|spi|適性検査|筆記試験|締切|提出期限|エントリー|応募|内定|不採用|お見送り|合否)/i;
// Stronger signals for actionable process emails relayed by recruiting platforms.
const ACTIONABLE_PROCESS_HINTS =
  /(提出の御礼|提出ありがとう|ご応募ありがとうございます|ご応募ありがとうございました|今後のスケジュール|次のステップ|選考フロー|エントリーシート提出|es提出|カジュアル面談|適正検査|適性検査|面接\(個別\)|面接（個別）|内定)/i;
const PLATFORM_SURVEY_HINTS =
  /(アンケート|調査|ご協力のお願い|業界イメージ|意識調査|満足度調査|questant\.jp)/i;
const PLATFORM_INCENTIVE_HINTS =
  /(抽選|当たります|プレゼント|ギフトカード|ギフトコード|amazon\s*ギフト|amazonギフト)/i;
const PLATFORM_NEWSLETTER_HINTS =
  /(マイナビメール|ピックアップ|おすすめ企業|新着求人|求人をお届け|特集|キャンペーン|ランキング)/i;
const PLATFORM_ACTIONABLE_RELAY_HINTS =
  /(応募者管理システム|miws\.mynavi\.jp|info-job@|提出の御礼|提出ありがとう|ご応募ありがとうございます|ご応募ありがとうございました)/i;

// ─── Event rules (multi-signal — ALL evaluated) ─────────────────────────────

interface EventRule {
  eventType: MailEventType;
  confidence: number;
  reason: string;
  pattern: RegExp;
  /** Higher = more specific match. Used as tiebreaker. */
  specificity: number;
}

const EVENT_RULES: EventRule[] = [
  // ── Hard outcomes (highest priority, not overridden by LLM) ──
  {
    eventType: "rejection",
    confidence: 0.97,
    reason: "rule:rejection",
    specificity: 10,
    pattern:
      /(不採用|見送り|お見送り|不合格|不通過|残念ながら|ご期待に添え|希望に沿いかね|ご希望に沿いかね|沿いかねる結果|意に沿え|ご縁がなく|rejected|not selected|we regret|selection result.*unsuccessful)/i,
  },
  {
    eventType: "offer",
    confidence: 0.97,
    reason: "rule:offer",
    specificity: 10,
    // Avoid bare "内定" because it often appears in process outlines
    // (e.g. "今後のスケジュール: ... 内定") and can cause false positives.
    pattern:
      /(内々定|内定通知|内定のご連絡|内定のお知らせ|採用決定|採用通知|job offer|offer letter|合格通知|合格のお知らせ)/i,
  },
  // ── Core event types ──
  {
    eventType: "interview",
    confidence: 0.92,
    reason: "rule:interview",
    specificity: 8,
    pattern:
      /(面接|面談|interview|一次面接|二次面接|三次面接|最終面接|グループ面接|個別面接|面接日程|面接のご案内|カジュアル面談|書類選考通過|書類選考合格)/i,
  },
  {
    eventType: "test",
    confidence: 0.90,
    reason: "rule:test",
    specificity: 7,
    pattern:
      /(webテスト|spi|適性検査|筆記試験|テスト受検|受検案内|coding test|online assessment|assessment|玉手箱|GAB|CAB|テストセンター|コーディングテスト)/i,
  },
  {
    eventType: "deadline",
    confidence: 0.90,
    reason: "rule:deadline",
    specificity: 7,
    pattern:
      /(締切|提出期限|deadline|提出期日|エントリーシート提出|es提出|回答期限|期限までに|応募締切|予約締切)/i,
  },
  {
    eventType: "briefing",
    confidence: 0.86,
    reason: "rule:briefing",
    specificity: 6,
    pattern:
      /(説明会|セミナー|会社説明|briefing|会社紹介|オープンカンパニー|web説明会|オンライン説明会|座談会|懇親会)/i,
  },
  {
    eventType: "entry",
    confidence: 0.82,
    reason: "rule:entry",
    specificity: 5,
    pattern:
      /(エントリー完了|応募完了|受付完了|応募受付|エントリー受付|application received|entry completed|ご応募ありがとうございます|マイページ登録|プレエントリー|書類選考のご案内)/i,
  },
];

// ─── Co-occurrence boosting rules ────────────────────────────────────────────
// When certain keyword combinations appear together, boost confidence.

interface CoOccurrenceRule {
  primary: RegExp;
  secondary: RegExp;
  boost: number;
  appliesTo: MailEventType;
}

const CO_OCCURRENCE_RULES: CoOccurrenceRule[] = [
  // "面接" + date/time near each other → strong interview signal
  { primary: /面接|面談|interview/i, secondary: /(\d{1,2})月(\d{1,2})日|(\d{1,2}):(\d{2})|(\d{4})[\/年]/, boost: 0.05, appliesTo: "interview" },
  // "面接" + Zoom/Teams/Meet → strong interview signal
  { primary: /面接|面談|interview/i, secondary: /zoom|teams|google\s*meet|webex|skype|オンライン|web/i, boost: 0.05, appliesTo: "interview" },
  // "説明会" + date → strong briefing signal
  { primary: /説明会|セミナー/i, secondary: /(\d{1,2})月(\d{1,2})日|(\d{1,2}):(\d{2})/, boost: 0.04, appliesTo: "briefing" },
  // "説明会" + viewing link → strong briefing signal
  { primary: /説明会|セミナー/i, secondary: /視聴|参加|URL/i, boost: 0.03, appliesTo: "briefing" },
  // "テスト" + URL → likely a real test invitation
  { primary: /テスト|spi|適性検査|assessment/i, secondary: /https?:\/\/|URL|リンク|ログイン/i, boost: 0.04, appliesTo: "test" },
  // "テスト" + deadline → real test invitation
  { primary: /テスト|spi|適性検査|assessment/i, secondary: /受検期間|受検期限|締切|期限/i, boost: 0.04, appliesTo: "test" },
  // "締切" + specific date → real deadline
  { primary: /締切|期限|deadline/i, secondary: /(\d{1,2})月(\d{1,2})日|(\d{4})[\/年\-]/, boost: 0.04, appliesTo: "deadline" },
  // Rejection + apology pattern → definite rejection
  { primary: /見送り|不採用|不合格/i, secondary: /残念|お祈り|ご縁|沿いかねる/i, boost: 0.04, appliesTo: "rejection" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeEventType(v: string | null | undefined): MailEventType {
  if (
    v === "interview" || v === "briefing" || v === "test" ||
    v === "deadline" || v === "entry" || v === "offer" ||
    v === "rejection" || v === "other"
  ) {
    return v;
  }
  return "other";
}

/**
 * Legacy company-name normalizer (kept for backward compat with LLM output).
 * For rule-based extraction, prefer `extractBestCompanyName` from mailNer.
 */
function normalizeCompanyName(name: string | null | undefined): string | null {
  const raw = (name ?? "").trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/^(【|「|\[|\()(.+?)(】|」|\]|\))$/, "$2")
    .replace(/^[\s\-:：|｜"'`"']+|[\s\-:：|｜"'`"']+$/g, "")
    .replace(/(株式会社|（株）|\(株\))/g, "株式会社")
    .replace(/(採用|採用担当|採用事務局|人事部|人事|HR|Recruiting|recruit)$/i, "")
    .trim();
  if (cleaned.length < 2) return null;
  if (JOB_PLATFORM_HINTS.test(cleaned)) return null;
  return cleaned;
}

function defaultTodo(eventType: MailEventType, text?: string): string[] {
  if (eventType === "interview") {
    if (text && /カジュアル面談/.test(text)) {
      return ["确认 Casual 面谈的时间和形式，准备简单的自我介绍", "准备 3 个你想了解的公司业务或文化问题"];
    }
    if (text && /最終面接/.test(text)) {
      return ["确认最终面试时间和形式", "准备入社意愿、价值观对齐及逆提问"];
    }
    return ["确认面试时间和形式，准备1分钟自我介绍"];
  }
  if (eventType === "briefing") return ["确认说明会参加方式，提前准备2个问题"];
  if (eventType === "test") return ["确认测试平台和时限，先做一次模拟题"];
  if (eventType === "deadline") return ["把提交截止时间写入日程并预留缓冲"];
  if (eventType === "entry") return ["确认报名材料已齐全并保留提交凭证"];
  if (eventType === "offer") return ["确认 offer 条件与回复期限"];
  if (eventType === "rejection") return ["记录未通过原因并更新后续投递策略"];
  return [];
}

// ─── Multi-signal rule evaluation ────────────────────────────────────────────

interface RuleSignal {
  eventType: MailEventType;
  confidence: number;
  reason: string;
  specificity: number;
}

function evaluateAllRules(text: string): RuleSignal[] {
  const signals: RuleSignal[] = [];
  for (const rule of EVENT_RULES) {
    const m = text.match(rule.pattern);
    if (m) {
      // Actual matched length contributes to specificity
      const matchSpecificity = rule.specificity + Math.min(m[0].length / 20, 0.5);
      signals.push({
        eventType: rule.eventType,
        confidence: rule.confidence,
        reason: rule.reason,
        specificity: matchSpecificity,
      });
    }
  }
  return signals;
}

function applyCoOccurrenceBoosts(text: string, signals: RuleSignal[]): RuleSignal[] {
  return signals.map((s) => {
    let boost = 0;
    for (const rule of CO_OCCURRENCE_RULES) {
      if (rule.appliesTo === s.eventType && rule.primary.test(text) && rule.secondary.test(text)) {
        boost += rule.boost;
      }
    }
    return { ...s, confidence: Math.min(s.confidence + boost, 1) };
  });
}

function pickBestRuleSignal(
  signals: RuleSignal[],
): { eventType: MailEventType; confidence: number; reason: string } {
  if (signals.length === 0) return { eventType: "other", confidence: 0.35, reason: "rule:other" };

  // Hard outcome rules ALWAYS win
  const hard = signals.find((s) => s.eventType === "offer" || s.eventType === "rejection");
  if (hard) return { eventType: hard.eventType, confidence: hard.confidence, reason: hard.reason };

  // Sort by composite score: confidence first, specificity as tiebreaker
  const sorted = [...signals].sort((a, b) => {
    const diff = b.confidence - a.confidence;
    return diff !== 0 ? diff : b.specificity - a.specificity;
  });
  return { eventType: sorted[0].eventType, confidence: sorted[0].confidence, reason: sorted[0].reason };
}

// ─── Main pipeline ───────────────────────────────────────────────────────────

export function runRecruitingNlpPipeline(
  input: RecruitingNlpInput,
  llmDecision?: MailDecisionLike | null,
): RecruitingNlpDecision {
  const text = `${input.subject}\n${input.body}\n${input.from}`;
  const lowerText = text.toLowerCase();

  // ① Domain reputation
  const domainRep = getDomainReputation(input.from);

  // ② Platform noise gate (unchanged behavior)
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
      _meta: { domainReputation: domainRep, interviewRound: null, negPenalty: 0, ruleSignals: [] },
    };
  }

  // ③ Negative signal penalty
  const negPenalty = calculateNegativeSignalPenalty(lowerText);
  const isPlatformSurveyPromo =
    domainRep.tier === "recruiting_platform" &&
    PLATFORM_SURVEY_HINTS.test(lowerText) &&
    PLATFORM_INCENTIVE_HINTS.test(lowerText);
  if (isPlatformSurveyPromo) {
    return {
      isJobRelated: false,
      confidence: 0.98,
      reason: "hard-negative:platform-survey",
      eventType: "other",
      companyName: null,
      eventDate: input.fallbackDate,
      eventTime: input.fallbackTime,
      location: null,
      todoItems: [],
      shouldSkipLlm: true,
      _meta: { domainReputation: domainRep, interviewRound: null, negPenalty, ruleSignals: [] },
    };
  }
  const isPlatformNewsletter =
    domainRep.tier === "recruiting_platform" &&
    PLATFORM_NEWSLETTER_HINTS.test(lowerText) &&
    !PLATFORM_ACTIONABLE_RELAY_HINTS.test(`${input.from}\n${input.subject}\n${input.body}`);
  if (isPlatformNewsletter) {
    return {
      isJobRelated: false,
      confidence: 0.96,
      reason: "hard-negative:platform-newsletter",
      eventType: "other",
      companyName: null,
      eventDate: input.fallbackDate,
      eventTime: input.fallbackTime,
      location: null,
      todoItems: [],
      shouldSkipLlm: true,
      _meta: { domainReputation: domainRep, interviewRound: null, negPenalty, ruleSignals: [] },
    };
  }
  const hasActionableProcessHints =
    ACTIONABLE_PROCESS_HINTS.test(`${input.subject}\n${input.body}`) ||
    (/【[^】]{2,40}】/.test(input.subject) && PROCESS_HINTS.test(input.subject));
  const isLikelyNoise =
    negPenalty <= -0.4 &&
    (domainRep.tier === "noise_platform" || domainRep.tier === "recruiting_platform") &&
    !hasActionableProcessHints;
  if (isLikelyNoise) {
    return {
      isJobRelated: false,
      confidence: 0.90,
      reason: "hard-negative:noise-signals",
      eventType: "other",
      companyName: null,
      eventDate: input.fallbackDate,
      eventTime: input.fallbackTime,
      location: null,
      todoItems: [],
      shouldSkipLlm: true,
      _meta: { domainReputation: domainRep, interviewRound: null, negPenalty, ruleSignals: [] },
    };
  }

  // ④ Multi-signal rule evaluation
  let ruleSignals = evaluateAllRules(lowerText);
  ruleSignals = applyCoOccurrenceBoosts(lowerText, ruleSignals);
  const rule = pickBestRuleSignal(ruleSignals);

  // ⑤ NER: company name (pass domain tier so platform emails don't extract from body)
  const nerCompany = extractBestCompanyName(input.subject, input.from, input.body, domainRep.tier);

  // ⑥ NER: date/time
  const nerDateTime = extractBestDateTime(text);

  // ⑦ NER: location
  const nerLocation = extractLocation(input.body);

  // ⑧ Interview round detection
  const interviewRound = detectInterviewRound(text);

  // ⑨ Merge with LLM decision
  const llmEventType = normalizeEventType(llmDecision?.eventType ?? null);
  const hardRuleOutcome = rule.eventType === "offer" || rule.eventType === "rejection";

  // Event type resolution: hard rules > LLM > best rule
  const mergedEventType: MailEventType = hardRuleOutcome
    ? rule.eventType
    : llmEventType !== "other"
      ? llmEventType
      : rule.eventType;

  // ⑩ Dynamic confidence merging
  const llmConfidence =
    typeof llmDecision?.confidence === "number" && Number.isFinite(llmDecision.confidence)
      ? Math.max(0, Math.min(1, llmDecision.confidence))
      : 0;

  let mergedConfidence: number;
  if (llmDecision) {
    // Dynamic weight: if rule is very confident (>=0.9), give rules more weight
    const ruleWeight = rule.confidence >= 0.90 ? 0.45 : 0.30;
    const llmWeight = 1 - ruleWeight;
    const rawConfidence = llmConfidence * llmWeight + rule.confidence * ruleWeight;
    // Apply domain reputation as a multiplier (0.7–1.0)
    const domainMultiplier = 0.7 + domainRep.score * 0.3;
    // Apply negative signal penalty
    mergedConfidence = Math.max(0, Math.min(1, rawConfidence * domainMultiplier + negPenalty * 0.3));
  } else {
    // No LLM — rule + domain signal
    mergedConfidence = Math.max(
      rule.confidence,
      input.domainSignal * 0.7,
      domainRep.score * 0.8,
    );
    mergedConfidence = Math.max(0, Math.min(1, mergedConfidence + negPenalty * 0.3));
  }

  // ⑪ isJobRelated decision
  const mergedIsJobRelated = llmDecision
    ? !!llmDecision.isJobRelated || mergedEventType !== "other"
    : mergedEventType !== "other" || (domainRep.score >= 0.8 && !!input.fallbackDate);

  // ⑫ Company name: NER result > LLM > rule-extracted
  const llmCompany = normalizeCompanyName(llmDecision?.companyName ?? null);
  const mergedCompany =
    (nerCompany.confidence >= 0.70 ? nerCompany.name : null) ??
    llmCompany ??
    (nerCompany.name);

  // ⑬ Date/time: LLM > NER > fallback
  const mergedDate = llmDecision?.eventDate ?? nerDateTime.date ?? input.fallbackDate;
  const mergedTime = llmDecision?.eventTime ?? nerDateTime.time ?? input.fallbackTime;

  // ⑭ Location: LLM > NER
  const mergedLocation = llmDecision?.location ?? nerLocation ?? null;

  // ⑮ Todo items
  const mergedTodo =
    (Array.isArray(llmDecision?.todoItems) ? llmDecision?.todoItems : null)?.filter(
      (t): t is string => typeof t === "string" && t.trim().length > 0,
    ) ?? defaultTodo(mergedEventType, text);

  // ⑯ Check if we can skip LLM
  let skipLlm = false;
  if (!llmDecision) {
    const hasGoodCompany = !!mergedCompany;
    const hasGoodDate = !!mergedDate;
    
    if (mergedIsJobRelated && hasGoodCompany) {
      if ((mergedEventType === "rejection" || mergedEventType === "offer" || mergedEventType === "entry") && mergedConfidence >= 0.90) {
        skipLlm = true; // These types don't strictly need date/time
      } else if (mergedEventType !== "other" && mergedConfidence >= 0.92 && hasGoodDate) {
        skipLlm = true; // Interview/Test/Briefing with high confidence + date + company
      }
    } else if (!mergedIsJobRelated && mergedConfidence >= 0.90) {
      skipLlm = true; // High confidence noise
    }
  }

  return {
    isJobRelated: mergedIsJobRelated,
    confidence: mergedConfidence,
    reason: llmDecision ? `${llmDecision.reason ?? "llm"} | ${rule.reason}` : rule.reason,
    eventType: mergedEventType,
    companyName: mergedCompany ?? null,
    eventDate: mergedDate,
    eventTime: mergedTime,
    location: mergedLocation,
    todoItems: mergedTodo.slice(0, 3),
    shouldSkipLlm: skipLlm,
    _meta: { domainReputation: domainRep, interviewRound, negPenalty, ruleSignals },
  };
}

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
import { normalizeCompanyDisplayName } from "./companyName";
import { buildLimitedMailText } from "./_core/mailText";
import {
  type MailEventType,
  type EventRule,
  type CoOccurrenceRule,
  EVENT_RULES,
  CO_OCCURRENCE_RULES,
  JOB_PLATFORM_HINTS,
  PROCESS_HINTS,
  ACTIONABLE_PROCESS_HINTS,
  PLATFORM_SURVEY_HINTS,
  PLATFORM_INCENTIVE_HINTS,
  PLATFORM_NEWSLETTER_HINTS,
  PLATFORM_MESSAGE_NOTIFICATION_HINTS,
  PLATFORM_ACTIONABLE_RELAY_HINTS,
  SUBJECT_DEADLINE_HINT,
  SUBJECT_TEST_HINT,
  SUBJECT_INTERVIEW_HINT,
  STRONG_SELECTION_SUBJECT_HINT,
  PLATFORM_SEMINAR_PROMO_SUBJECT_HINT,
  SUBJECT_BRACKET_GUIDE_PATTERN,
  SUBJECT_SELECTION_GUIDE_PATTERN,
  RESULT_NOTIFICATION_SUBJECT_PATTERN,
  ENTRY_RECEIPT_SUBJECT_PATTERN,
  HARD_REJECTION_JP_PATTERN,
  HARD_REJECTION_EN_PATTERN,
  HARD_OFFER_JP_PATTERN,
  HARD_OFFER_EN_PATTERN,
} from "./_core/mailKeywords";

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
  _meta?: any;
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
    companyExtraction: {
      name: string | null;
      confidence: number;
      source: string | null;
      sources: string[];
      selectedBy: "ner_high_confidence" | "llm" | "ner_low_confidence" | "none";
      llmCompanyName: string | null;
    };
    hardOutcome?: "offer" | "rejection" | null;
    isResultNotificationSubject?: boolean;
    [key: string]: any;
  };
}

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
  const cleaned = normalizeCompanyDisplayName(name);
  if (!cleaned) return null;
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

function emptyCompanyExtraction(): NonNullable<RecruitingNlpDecision["_meta"]>["companyExtraction"] {
  return {
    name: null,
    confidence: 0,
    source: null,
    sources: [],
    selectedBy: "none",
    llmCompanyName: null,
  };
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
  const limited = buildLimitedMailText({ subject: input.subject, body: input.body, from: input.from });
  const body = limited.body;
  const text = limited.text;
  const inputMeta = {
    inputBodyTruncated: limited.bodyTruncated,
    inputBodyOriginalLength: limited.originalBodyLength,
    inputBodyUsedLength: body.length,
    inputTextUsedLength: text.length,
  };

  // ① Domain reputation
  const domainRep = getDomainReputation(input.from);

  // ② Platform noise gate (unchanged behavior)
  const obviousPlatformNoise = JOB_PLATFORM_HINTS.test(text) && !PROCESS_HINTS.test(text);
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
      _meta: {
        ...inputMeta,
        domainReputation: domainRep,
        interviewRound: null,
        negPenalty: 0,
        ruleSignals: [],
        companyExtraction: emptyCompanyExtraction(),
      },
    };
  }

  // ③ Negative signal penalty
  const negPenalty = calculateNegativeSignalPenalty(text);
  const actionableRelayText = `${input.from}\n${input.subject}\n${body}`;
  const hasActionableRelay = PLATFORM_ACTIONABLE_RELAY_HINTS.test(actionableRelayText);
  const hasPlatformMessageSubject = PLATFORM_MESSAGE_NOTIFICATION_HINTS.test(input.subject);
  const isPlatformSurveyPromo =
    (domainRep.tier === "recruiting_platform" || JOB_PLATFORM_HINTS.test(text)) &&
    PLATFORM_SURVEY_HINTS.test(text) &&
    PLATFORM_INCENTIVE_HINTS.test(text);
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
      _meta: {
        ...inputMeta,
        domainReputation: domainRep,
        interviewRound: null,
        negPenalty,
        ruleSignals: [],
        companyExtraction: emptyCompanyExtraction(),
      },
    };
  }
  const isPlatformNewsletter =
    (domainRep.tier === "recruiting_platform" || JOB_PLATFORM_HINTS.test(text)) &&
    PLATFORM_NEWSLETTER_HINTS.test(text) &&
    !hasActionableRelay &&
    !(SUBJECT_BRACKET_GUIDE_PATTERN.test(input.subject) && SUBJECT_SELECTION_GUIDE_PATTERN.test(input.subject)) &&
    !STRONG_SELECTION_SUBJECT_HINT.test(input.subject);
  // If it's a platform promo, but the subject contains strong words like "面接攻略" or "就活講座",
  // it might be misclassified as a real interview.
  const isPlatformSeminarPromo =
    (domainRep.tier === "recruiting_platform" || JOB_PLATFORM_HINTS.test(text) || /人材紹介/.test(text)) &&
    PLATFORM_SEMINAR_PROMO_SUBJECT_HINT.test(input.subject) &&
    !hasActionableRelay &&
    !hasPlatformMessageSubject &&
    !STRONG_SELECTION_SUBJECT_HINT.test(input.subject);
  const isLearningPromoSubject =
    PLATFORM_SEMINAR_PROMO_SUBJECT_HINT.test(input.subject) ||
    PLATFORM_NEWSLETTER_HINTS.test(input.subject);
  const isConcreteSelectionSchedule =
    /(面接日程|面談日程|日程調整|予約完了|予約ありがとうございます|ご予約ありがとうございます|予約確定|参加URL|本日の参加URL|開催が近づいて|選考会|面接のご案内|面談のご案内|選考.{0,20}予約)/i.test(
      `${input.subject}\n${body}`,
    );
  const isLearningOrEventPromo =
    isLearningPromoSubject &&
    !isConcreteSelectionSchedule &&
    !hasPlatformMessageSubject &&
    (
      domainRep.tier === "recruiting_platform" ||
      domainRep.tier === "noise_platform" ||
      JOB_PLATFORM_HINTS.test(text) ||
      negPenalty <= -0.2
    );
  const isMarketingSeminarPromo =
    PLATFORM_SEMINAR_PROMO_SUBJECT_HINT.test(input.subject) &&
    PLATFORM_NEWSLETTER_HINTS.test(text) &&
    !hasActionableRelay &&
    !STRONG_SELECTION_SUBJECT_HINT.test(input.subject);
  const isNoisePlatformPromo =
    domainRep.tier === "noise_platform" &&
    !hasActionableRelay &&
    !hasPlatformMessageSubject;

  if (
    isPlatformNewsletter ||
    isPlatformSeminarPromo ||
    isLearningOrEventPromo ||
    isMarketingSeminarPromo ||
    isNoisePlatformPromo
  ) {
    return {
      isJobRelated: false,
      confidence: 0.96,
      reason: "hard-negative:platform-or-marketing-promo",
      eventType: "other",
      companyName: null,
      eventDate: input.fallbackDate,
      eventTime: input.fallbackTime,
      location: null,
      todoItems: [],
      shouldSkipLlm: true,
      _meta: {
        ...inputMeta,
        domainReputation: domainRep,
        interviewRound: null,
        negPenalty,
        ruleSignals: [],
        companyExtraction: emptyCompanyExtraction(),
      },
    };
  }

  // Platform message notifications: we mark them as job-related 'other' (or 'entry' if they don't contain strong interview/test signals)
  // because they are just generic notifications telling the user to log in. We want to skip LLM to save cost,
  // since the real action is on the platform's MyPage.
  const isPlatformMessageNotification = 
    domainRep.tier === "recruiting_platform" &&
    hasPlatformMessageSubject;
    
  if (isPlatformMessageNotification) {
    // Try to extract company name from subject or body snippet if possible
    const nerCompany = extractBestCompanyName(input.subject, input.from, body, domainRep.tier);
    const cleanedCompanyName = nerCompany.name?.replace(/\)$/, "").trim() || null;
    
    return {
      isJobRelated: true,
      confidence: 0.95,
      reason: "rule:platform-message-notification",
      eventType: "other", // Mark as other so it doesn't clutter calendar with fake briefings
      companyName: cleanedCompanyName,
      eventDate: input.fallbackDate,
      eventTime: input.fallbackTime,
      location: null,
      todoItems: ["マイページにログインしてメッセージを確認する"],
      shouldSkipLlm: true,
      _meta: {
        ...inputMeta,
        domainReputation: domainRep,
        interviewRound: null,
        negPenalty,
        ruleSignals: [],
        companyExtraction: {
          name: cleanedCompanyName,
          confidence: cleanedCompanyName ? nerCompany.confidence : 0,
          source: cleanedCompanyName ? nerCompany.source : null,
          sources: cleanedCompanyName ? nerCompany.sources : [],
          selectedBy: cleanedCompanyName ? "ner_high_confidence" : "none",
          llmCompanyName: null,
        },
      },
    };
  }

  const hasActionableProcessHints =
    ACTIONABLE_PROCESS_HINTS.test(`${input.subject}\n${body}`) ||
    (SUBJECT_BRACKET_GUIDE_PATTERN.test(input.subject) && PROCESS_HINTS.test(input.subject));
  const hasAnyProcessHints = PROCESS_HINTS.test(text) || hasActionableProcessHints;
  const isObviousMarketing =
    negPenalty <= -0.6 &&
    !hasAnyProcessHints &&
    domainRep.tier !== "recruiting_platform" &&
    domainRep.tier !== "noise_platform";
  if (isObviousMarketing) {
    return {
      isJobRelated: false,
      confidence: 0.92,
      reason: "hard-negative:marketing",
      eventType: "other",
      companyName: null,
      eventDate: input.fallbackDate,
      eventTime: input.fallbackTime,
      location: null,
      todoItems: [],
      shouldSkipLlm: true,
      _meta: {
        ...inputMeta,
        domainReputation: domainRep,
        interviewRound: null,
        negPenalty,
        ruleSignals: [],
        companyExtraction: emptyCompanyExtraction(),
      },
    };
  }
  const isLikelyNoise =
    negPenalty <= -0.4 &&
    (domainRep.tier === "noise_platform" || domainRep.tier === "recruiting_platform" || JOB_PLATFORM_HINTS.test(text)) &&
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
      _meta: {
        ...inputMeta,
        domainReputation: domainRep,
        interviewRound: null,
        negPenalty,
        ruleSignals: [],
        companyExtraction: emptyCompanyExtraction(),
      },
    };
  }

  // ④ Multi-signal rule evaluation
  let ruleSignals = evaluateAllRules(text);
  ruleSignals = applyCoOccurrenceBoosts(text, ruleSignals);
  let rule = pickBestRuleSignal(ruleSignals);
  if (!llmDecision) {
    const subject = input.subject ?? "";
    const hasInterviewSignal = ruleSignals.some((s) => s.eventType === "interview");
    const hasTestSignal = ruleSignals.some((s) => s.eventType === "test");
    const hasDeadlineSignal = ruleSignals.some((s) => s.eventType === "deadline");
    const preferTest = hasTestSignal && SUBJECT_TEST_HINT.test(subject) && !SUBJECT_INTERVIEW_HINT.test(subject);
    const preferDeadline =
      hasDeadlineSignal && SUBJECT_DEADLINE_HINT.test(subject) && !SUBJECT_INTERVIEW_HINT.test(subject);
    if (preferTest) {
      const best = ruleSignals
        .filter((s) => s.eventType === "test")
        .sort((a, b) => b.confidence - a.confidence)[0];
      rule = { eventType: "test", confidence: best?.confidence ?? rule.confidence, reason: best?.reason ?? rule.reason };
    } else if (preferDeadline) {
      const best = ruleSignals
        .filter((s) => s.eventType === "deadline")
        .sort((a, b) => b.confidence - a.confidence)[0];
      rule = {
        eventType: "deadline",
        confidence: best?.confidence ?? rule.confidence,
        reason: best?.reason ?? rule.reason,
      };
    }
  }

  // ⑤ NER: company name (pass domain tier so platform emails don't extract from body)
  const nerCompany = extractBestCompanyName(input.subject, input.from, body, domainRep.tier);

  // ⑥ NER: date/time
  const nerDateTime = extractBestDateTime(text);

  // ⑦ NER: location
  const nerLocation = extractLocation(body);

  // ⑧ Interview round detection
  const interviewRound = detectInterviewRound(text);

  // ⑨ Merge with LLM decision
  const llmEventType = normalizeEventType(llmDecision?.eventType ?? null);
  const isResultNotificationSubject = RESULT_NOTIFICATION_SUBJECT_PATTERN.test(input.subject);

  // Hard outcome logic extracted from gmail.ts
  let hardOutcome: "offer" | "rejection" | null = null;
  if (HARD_REJECTION_JP_PATTERN.test(text) || HARD_REJECTION_EN_PATTERN.test(text)) {
    hardOutcome = "rejection";
  } else if (HARD_OFFER_JP_PATTERN.test(text) || HARD_OFFER_EN_PATTERN.test(text)) {
    hardOutcome = "offer";
  }

  // Event type resolution: hard outcome > result subject gating > LLM > best rule
  let mergedEventType: MailEventType;
  if (hardOutcome === "offer") {
    mergedEventType = "offer";
  } else if (hardOutcome === "rejection") {
    mergedEventType = "rejection";
  } else if (isResultNotificationSubject) {
    // If the subject says "Result Notification" but we didn't explicitly catch a hardOutcome word,
    // prefer an LLM-detected next stage. Without LLM, avoid promoting generic
    // result notices to interview/test just because the body mentions later steps.
    if (llmEventType !== "other") {
      mergedEventType = llmEventType;
    } else if (rule.eventType === "interview" || rule.eventType === "test") {
      mergedEventType = "other";
    } else {
      mergedEventType = rule.eventType;
    }
  } else {
    mergedEventType = llmEventType !== "other" && llmEventType ? llmEventType : rule.eventType;
  }
  
  // Override: If the email subject is purely an ES submission receipt, it should be an 'entry' event,
  // not 'interview', even if 'interview' is mentioned in the body as future steps.
  if (mergedEventType === "interview" || mergedEventType === "test") {
    if (ENTRY_RECEIPT_SUBJECT_PATTERN.test(input.subject)) {
      mergedEventType = "entry";
      rule.reason = "override:entry_receipt";
    }
  }

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
    : mergedEventType !== "other" || (domainRep.score >= 0.8 && !!input.fallbackDate && hasAnyProcessHints);

  // ⑫ Company name resolution:
  //   1. High-confidence NER (≥ 0.70) wins outright.
  //   2. Otherwise prefer the LLM-supplied name (normalized).
  //   3. Fall back to the best low-confidence NER candidate.
  const llmCompany = normalizeCompanyName(llmDecision?.companyName ?? null);
  let mergedCompany: string | null = null;
  let companySelectedBy: NonNullable<RecruitingNlpDecision["_meta"]>["companyExtraction"]["selectedBy"] = "none";
  if (nerCompany.name && nerCompany.confidence >= 0.70) {
    mergedCompany = nerCompany.name;
    companySelectedBy = "ner_high_confidence";
  } else if (llmCompany) {
    mergedCompany = llmCompany;
    companySelectedBy = "llm";
  } else if (nerCompany.name) {
    mergedCompany = nerCompany.name;
    companySelectedBy = "ner_low_confidence";
  }

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
    
    if (hasActionableRelay) {
      skipLlm = false;
    } else if (mergedIsJobRelated && hasGoodCompany) {
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
    _meta: {
      ...inputMeta,
      domainReputation: domainRep,
      interviewRound,
      negPenalty,
      ruleSignals,
      companyExtraction: {
        name: mergedCompany ?? null,
        confidence:
          companySelectedBy === "llm"
            ? Math.max(0, Math.min(1, llmConfidence || 0))
            : nerCompany.confidence,
        source: companySelectedBy === "llm" ? "llm" : nerCompany.source,
        sources: companySelectedBy === "llm" ? ["llm"] : nerCompany.sources,
        selectedBy: companySelectedBy,
        llmCompanyName: llmCompany,
      },
      hardOutcome,
      isResultNotificationSubject
    },
  };
}

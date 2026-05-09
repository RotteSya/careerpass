/**
 * Rules-based classifier for Google Calendar events.
 *
 * Decides whether a calendar event is job-search related and, if so, what
 * type it is (briefing / written test / interview / offer / other). LLM
 * fallback is intentionally deferred: rules cover the 就活 vocabulary that
 * actually appears in calendar events, and a wrong call here only affects
 * the agent ingestion log, not user-visible state.
 */

export type CalendarEventType =
  | "briefing"
  | "written_test"
  | "interview_1"
  | "interview_final"
  | "offer"
  | "other";

export interface CalendarEventNlpInput {
  summary?: string | null;
  description?: string | null;
  location?: string | null;
}

export interface CalendarEventNlpResult {
  isRelevant: boolean;
  eventType: CalendarEventType | null;
  confidence: number;
  matchedKeywords: string[];
}

interface KeywordRule {
  keyword: string;
  type: CalendarEventType;
  // Word-boundary required for ASCII tokens to avoid e.g. "interviewer review".
  wordBoundary?: boolean;
  weight: number;
}

const RULES: KeywordRule[] = [
  // Offers (highest priority — strongest signal)
  { keyword: "内定", type: "offer", weight: 1.0 },
  { keyword: "オファー", type: "offer", weight: 0.9 },
  { keyword: "offer letter", type: "offer", wordBoundary: true, weight: 0.9 },

  // Final interview (more specific than generic interview)
  { keyword: "最終面接", type: "interview_final", weight: 1.0 },
  { keyword: "最終選考", type: "interview_final", weight: 0.95 },
  {
    keyword: "final interview",
    type: "interview_final",
    wordBoundary: true,
    weight: 0.95,
  },

  // Interview (generic — defaults to interview_1; downstream may upgrade)
  { keyword: "面接", type: "interview_1", weight: 0.9 },
  { keyword: "面談", type: "interview_1", weight: 0.7 },
  {
    keyword: "interview",
    type: "interview_1",
    wordBoundary: true,
    weight: 0.85,
  },

  // Written test
  { keyword: "Webテスト", type: "written_test", weight: 0.95 },
  { keyword: "ウェブテスト", type: "written_test", weight: 0.9 },
  { keyword: "SPI", type: "written_test", wordBoundary: true, weight: 0.9 },
  { keyword: "玉手箱", type: "written_test", weight: 0.9 },
  { keyword: "適性検査", type: "written_test", weight: 0.85 },
  { keyword: "筆記試験", type: "written_test", weight: 0.85 },

  // Briefing / info session / OB-OG visit
  { keyword: "説明会", type: "briefing", weight: 0.9 },
  { keyword: "会社説明", type: "briefing", weight: 0.9 },
  { keyword: "セミナー", type: "briefing", weight: 0.7 },
  {
    keyword: "info session",
    type: "briefing",
    wordBoundary: true,
    weight: 0.8,
  },
  {
    keyword: "information session",
    type: "briefing",
    wordBoundary: true,
    weight: 0.85,
  },
  { keyword: "career talk", type: "briefing", wordBoundary: true, weight: 0.7 },
  { keyword: "OB訪問", type: "briefing", weight: 0.9 },
  { keyword: "OG訪問", type: "briefing", weight: 0.9 },
  { keyword: "OB・OG", type: "briefing", weight: 0.85 },

  // Generic recruiting context (only mark relevant — no specific type)
  { keyword: "選考", type: "other", weight: 0.6 },
  { keyword: "就活", type: "other", weight: 0.5 },
  { keyword: "採用", type: "other", weight: 0.5 },
  { keyword: "新卒", type: "other", weight: 0.5 },
  { keyword: "recruiting", type: "other", wordBoundary: true, weight: 0.5 },
  { keyword: "recruitment", type: "other", wordBoundary: true, weight: 0.5 },
];

const TYPE_PRIORITY: CalendarEventType[] = [
  "offer",
  "interview_final",
  "interview_1",
  "written_test",
  "briefing",
  "other",
];

function buildHaystack(input: CalendarEventNlpInput): string {
  const parts = [input.summary, input.description, input.location]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map(v => v.toLowerCase());
  return parts.join("\n");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matches(haystack: string, rule: KeywordRule): boolean {
  const k = rule.keyword.toLowerCase();
  if (rule.wordBoundary) {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(k)}([^a-z0-9]|$)`, "i");
    return re.test(haystack);
  }
  return haystack.includes(k);
}

export function classifyCalendarEvent(
  input: CalendarEventNlpInput
): CalendarEventNlpResult {
  const haystack = buildHaystack(input);
  if (!haystack) {
    return {
      isRelevant: false,
      eventType: null,
      confidence: 0,
      matchedKeywords: [],
    };
  }

  const matched: KeywordRule[] = [];
  for (const rule of RULES) {
    if (matches(haystack, rule)) matched.push(rule);
  }

  if (matched.length === 0) {
    return {
      isRelevant: false,
      eventType: null,
      confidence: 0,
      matchedKeywords: [],
    };
  }

  let chosenType: CalendarEventType = "other";
  for (const t of TYPE_PRIORITY) {
    if (matched.some(m => m.type === t)) {
      chosenType = t;
      break;
    }
  }

  const typeMatches = matched.filter(m => m.type === chosenType);
  const confidence = Math.min(
    1,
    typeMatches.reduce((acc, m) => Math.max(acc, m.weight), 0)
  );

  // "other" alone is a weak signal — require either a stronger sibling match
  // or a confidence floor before flagging the event as relevant.
  const isRelevant =
    chosenType !== "other" ||
    matched.some(m => m.type !== "other") ||
    confidence >= 0.6;

  return {
    isRelevant,
    eventType: isRelevant ? chosenType : null,
    confidence,
    matchedKeywords: Array.from(new Set(matched.map(m => m.keyword))),
  };
}

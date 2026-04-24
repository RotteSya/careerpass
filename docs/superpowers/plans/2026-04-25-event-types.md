# Add New Event Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the recruiting mail event types to include `document_screening`, `casual_interview`, and `deadline_reminder`, while merging `seminar` logic into `briefing` and ensuring platform noise is accurately categorized.

**Architecture:** We will update the `MailEventType` union type in `mailKeywords.ts` to include the new states. Then, we will add/update regular expressions and rules in the `EVENT_RULES` array to accurately capture these new types. Finally, we will ensure that `mailNlpPipeline.test.ts` covers these new classifications to prevent regressions.

**Tech Stack:** TypeScript, Regular Expressions, Vitest

---

### Task 1: Update Types and Patterns in `mailKeywords.ts`

**Files:**
- Modify: `server/_core/mailKeywords.ts`

- [ ] **Step 1: Update `MailEventType` and add new keywords/patterns**

Modify `MailEventType` to include `document_screening` and `casual_interview`. Note: `deadline` already exists in `MailEventType` but was referred to as `deadline_reminder` in the spec. We will use the existing `deadline` type.

In `server/_core/mailKeywords.ts`, replace the `MailEventType` definition:

```typescript
export type MailEventType =
  | "interview"
  | "briefing"
  | "test"
  | "deadline"
  | "entry"
  | "offer"
  | "rejection"
  | "document_screening"
  | "casual_interview"
  | "other";
```

Add new constants for the new event types around line 134:

```typescript
export const SUBJECT_DOCUMENT_SCREENING_HINT =
  /(書類選考のご案内|書類選考結果|エントリーシート選考|es選考)/i;
export const SUBJECT_CASUAL_INTERVIEW_HINT =
  /(カジュアル面談|casual interview)/i;
```

Update `STRONG_SELECTION_SUBJECT_HINT` to include the new hints around line 136:

```typescript
export const STRONG_SELECTION_SUBJECT_HINT =
  /カジュアル面談|一次面接|二次面接|三次面接|四次面接|最終面接|最終選考|書類選考|適性検査|合否/;
```

Update the `EVENT_RULES` array around line 150 to include the new rules and modify existing ones.
Remove `カジュアル面談` from the `interview` pattern.
Remove `書類選考のご案内` from the `entry` pattern.
Add the new rules for `casual_interview` and `document_screening`.

```typescript
export const EVENT_RULES: readonly EventRule[] = [
  // Hard outcomes (highest priority, not overridden by LLM).
  { eventType: "rejection", confidence: 0.97, reason: "rule:rejection", specificity: 10, pattern: REJECTION_RULE_PATTERN },
  { eventType: "offer",     confidence: 0.97, reason: "rule:offer",     specificity: 10, pattern: OFFER_RULE_PATTERN },

  // Core event types.
  {
    eventType: "interview", confidence: 0.92, reason: "rule:interview", specificity: 8,
    pattern: /(書類選考通過|書類選考合格|グループ面接|一次面接|二次面接|三次面接|最終面接|個別面接|面接のご案内|面接日程|interview|面接|面談)/i,
  },
  {
    eventType: "casual_interview", confidence: 0.93, reason: "rule:casual_interview", specificity: 9,
    pattern: /(カジュアル面談|casual interview)/i,
  },
  {
    eventType: "document_screening", confidence: 0.91, reason: "rule:document_screening", specificity: 8,
    pattern: /(書類選考のご案内|書類選考結果|エントリーシート選考|es選考|書類選考開始)/i,
  },
  {
    eventType: "test", confidence: 0.90, reason: "rule:test", specificity: 7,
    pattern: /(webテスト|\bspi\b|適性検査|筆記試験|テスト受検|受検案内|coding test|online assessment|assessment|玉手箱|\bgab\b|\bcab\b|テストセンター|コーディングテスト)/i,
  },
  {
    eventType: "deadline", confidence: 0.90, reason: "rule:deadline", specificity: 7,
    pattern: /(締切|提出期限|deadline|提出期日|エントリーシート提出|es提出|回答期限|期限までに|応募締切|予約締切|提出をお願いします)/i,
  },
  {
    eventType: "briefing", confidence: 0.86, reason: "rule:briefing", specificity: 6,
    pattern: /(説明会|セミナー|会社説明|briefing|会社紹介|オープンカンパニー|web説明会|オンライン説明会|座談会|懇親会)/i,
  },
  {
    eventType: "entry", confidence: 0.82, reason: "rule:entry", specificity: 5,
    pattern: /(エントリーシートご提出の御礼|エントリー完了|応募完了|受付完了|応募受付|エントリー受付|application received|entry completed|ご応募ありがとうございます|マイページ登録|プレエントリー)/i,
  },
] as const;
```

Update `CO_OCCURRENCE_RULES` around line 179 to support `casual_interview`. Add these rules:

```typescript
  { primary: /カジュアル面談/i, secondary: /(\d{1,2})月(\d{1,2})日|(\d{1,2}):(\d{2})|(\d{4})[\/年]/, boost: 0.05, appliesTo: "casual_interview" },
  { primary: /カジュアル面談/i, secondary: /zoom|teams|google\s*meet|webex|skype|オンライン|web/i,    boost: 0.05, appliesTo: "casual_interview" },
```

- [ ] **Step 2: Commit the changes**

```bash
git add server/_core/mailKeywords.ts
git commit -m "feat: add casual_interview and document_screening event types"
```

### Task 2: Add Tests for New Classifications

**Files:**
- Modify: `server/mailNlpPipeline.test.ts`

- [ ] **Step 1: Write tests for the new classifications**

Open `server/mailNlpPipeline.test.ts` and add these tests at the end of the file, just before the final `});` (around line 763):

```typescript
  it("classifies casual interviews correctly", () => {
    const d = runRecruitingNlpPipeline({
      subject: "カジュアル面談のご案内",
      body: "まずはカジュアルにお話ししませんか？",
      from: "hr@startup.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.eventType).toBe("casual_interview");
    expect(d.isJobRelated).toBe(true);
  });

  it("classifies document screening correctly", () => {
    const d = runRecruitingNlpPipeline({
      subject: "書類選考のご案内",
      body: "エントリーありがとうございます。書類選考を開始いたします。",
      from: "recruit@bigcorp.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.eventType).toBe("document_screening");
    expect(d.isJobRelated).toBe(true);
  });

  it("classifies deadline reminders correctly", () => {
    const d = runRecruitingNlpPipeline({
      subject: "【明日締切】エントリーシート提出のお願い",
      body: "エントリーシートの提出期限が明日となっております。",
      from: "hr@company.co.jp",
      domainSignal: 0.9,
      fallbackDate: null,
      fallbackTime: null,
    });
    expect(d.eventType).toBe("deadline");
    expect(d.isJobRelated).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm exec vitest run server/mailNlpPipeline.test.ts`
Expected: PASS

- [ ] **Step 3: Commit the changes**

```bash
git add server/mailNlpPipeline.test.ts
git commit -m "test: add test cases for casual_interview, document_screening, and deadline"
```

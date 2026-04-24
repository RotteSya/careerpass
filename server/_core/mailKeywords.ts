/**
 * mailKeywords.ts — Single source of truth for recruiting-email keyword patterns.
 *
 * Previously the same concepts (rejection / offer / platform-noise / …) were
 * declared as separate regexes in both `mailNlpPipeline.ts` and `mailNer.ts`.
 * Whenever a maintainer tweaked one they had to find & sync every duplicate;
 * in practice the four copies had already drifted apart.
 *
 * This module consolidates them while preserving each call site's original
 * matching behaviour. The patterns below are exact extractions of the inline
 * regexes they replace.
 */

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

export interface EventRule {
  eventType: MailEventType;
  confidence: number;
  reason: string;
  pattern: RegExp;
  /** Higher = more specific match. Used as tiebreaker. */
  specificity: number;
}

export interface CoOccurrenceRule {
  primary: RegExp;
  secondary: RegExp;
  boost: number;
  appliesTo: MailEventType;
}

export interface NegativeSignal {
  pattern: RegExp;
  weight: number;
}

// ─── Rejection / Offer — rule and hard-outcome variants ─────────────────────
//
// The rule-layer pattern and hard-outcome pattern for each outcome differ
// slightly in the original code (hard-outcome is a superset for some tokens,
// subset for others).  We preserve both sets verbatim.

export const REJECTION_RULE_PATTERN =
  /(不採用|見送り|お見送り|見送らせて|不合格|不通過|残念ながら|ご期待に添え|希望に沿いかね|ご希望に沿いかね|沿いかねる結果|意に沿え|ご縁がなく|添いかねる|rejected|not selected|we regret|selection result.{0,50}unsuccessful)/i;

export const OFFER_RULE_PATTERN =
  /(内々定|内定通知|内定のご連絡|内定のお知らせ|採用内定|採用決定|採用通知|job offer|offer letter)/i;

export const HARD_REJECTION_JP_PATTERN =
  /(不採用|見送り|お見送り|見送らせて|選考結果.{0,40}残念|残念ながら|ご縁がなく|ご期待に添え|希望に沿いかね|ご希望に沿いかね|沿いかねる結果|意に沿え|添いかねる|不合格|不通過)/;

export const HARD_REJECTION_EN_PATTERN =
  /(rejected|unfortunately|we regret|not selected)/i;

export const HARD_OFFER_JP_PATTERN =
  /(内定通知|内定のご連絡|内定のお知らせ|内定.{0,40}決定|採用内定|採用決定)/;

export const HARD_OFFER_EN_PATTERN =
  /(offer\s*letter|job\s*offer|we are pleased to offer)/i;

export const LIFESTYLE_NON_RECRUITING_WORDS = [
  "口座", "入金", "カード", "物件", "号室", "賃貸", "お支払い", "審査結果",
  "ご注文", "発送", "配達", "暗証番号", "決済", "ポイント", "お買い上げ", "請求金額"
];
export const LIFESTYLE_NON_RECRUITING_HINTS = new RegExp(`(${LIFESTYLE_NON_RECRUITING_WORDS.join("|")})`, "i");

// ─── Platform & process hints ────────────────────────────────────────────────

export const JOB_PLATFORM_WORDS = [
  "syukatsu-kaigi", "syukatsukaigi", "就活会議", "openwork", "vorkers",
  "onecareer", "one-career", "ワンキャリア", "offerbox", "goodfind",
  "mynavi", "マイナビ", "リクナビ", "rikunabi", "キャリタス", "career-tasu",
  "doda", "unistyle", "iroots", "マスナビ", "massnavi", "paiza", "itmedia", "アイティメディア"
];
export const JOB_PLATFORM_HINTS = new RegExp(`(${JOB_PLATFORM_WORDS.join("|")})`, "i");

export const PROCESS_WORDS = [
  "選考", "面接", "面談", "説明会", "webテスト", "spi", "適性検査", "筆記試験",
  "締切", "提出期限", "エントリー", "応募", "内定", "不採用", "お見送り", "合否"
];
export const PROCESS_HINTS = new RegExp(`(${PROCESS_WORDS.join("|")})`, "i");

export const ACTIONABLE_PROCESS_WORDS = [
  "提出の御礼", "提出ありがとう", "ご応募ありがとうございます", "ご応募ありがとうございました",
  "今後のスケジュール", "次のステップ", "選考フロー", "エントリーシート提出", "es提出",
  "カジュアル面談", "適正検査", "適性検査", "面接\\(個別\\)", "面接（個別）", "内定"
];
export const ACTIONABLE_PROCESS_HINTS = new RegExp(`(${ACTIONABLE_PROCESS_WORDS.join("|")})`, "i");

export const PLATFORM_SURVEY_HINTS = /(アンケート|調査|ご協力のお願い|業界イメージ|意識調査|満足度調査|questant\.jp)/i;

export const PLATFORM_INCENTIVE_HINTS = /(抽選|当たります|プレゼント|ギフトカード|ギフトコード|amazon\s*ギフト|amazonギフト)/i;

export const PLATFORM_NEWSLETTER_WORDS = [
  "マイナビメール", "ピックアップ", "おすすめ企業", "おすすめ求人", "新着求人", "求人をお届け",
  "特集", "キャンペーン", "ランキング", "就活講座", "就活準備講座", "就活対策", "面接対策",
  "模擬面接", "面接攻略", "回答例", "回答事例", "頻出質問", "深掘り質問", "基礎知識",
  "就活準備", "就活を始める方", "希望勤務地別", "方向性を考える", "企業選びの軸",
  "自分に合った企業", "インターンシップの体験談", "業界研究", "セミナー開催",
  "おすすめのセミナー情報", "ビジネスオンライン通信", "メールサービス", "合同説明会",
  "合説", "就活イベント", "就活セミナー", "フォーラム", "本人確認", "会員登録",
  "サービスのご案内", "利用規約", "退会フォーム"
];
export const PLATFORM_NEWSLETTER_HINTS = new RegExp(`(${PLATFORM_NEWSLETTER_WORDS.join("|")})`, "i");

export const PLATFORM_MESSAGE_NOTIFICATION_HINTS =
  /(メッセージが届きました|新着メッセージ|企業から.{0,40}メッセージ|メッセージ受信)/i;

export const PLATFORM_ACTIONABLE_RELAY_HINTS =
  /(応募者管理システム|miws\.mynavi\.jp|info-job@|提出の御礼|提出ありがとう|ご応募ありがとうございます|ご応募ありがとうございました)/i;

/** Subject tokens that force-override interview/test classification to "entry". */
export const ENTRY_RECEIPT_SUBJECT_PATTERN =
  /(エントリーシートご提出の御礼|エントリー完了|応募完了|受付完了|応募受付|エントリー受付|ご応募ありがとうございます|書類選考のご案内)/i;

/** Subject patterns indicating "result notification" wrapper. */
export const RESULT_NOTIFICATION_SUBJECT_PATTERN =
  /(結果通知|選考結果|合否通知|合否のご連絡|お祈り|お見送り|不採用通知|不合格通知)/;

export const SUBJECT_DEADLINE_HINT =
  /(提出期限|提出締切|提出のお願い|締切|〆切|締め切り|回答期限|期限までに|提出をお願いします)/i;
export const SUBJECT_TEST_HINT =
  /(適性検査|webテスト|spi|筆記試験|テスト受検|受検案内|assessment|coding\s*test|オンラインアセスメント)/i;
export const SUBJECT_INTERVIEW_HINT =
  /(面接|面談|interview|面接日程|日程調整|面接予約|面接のご案内|面談のご案内)/i;

/** Strong interview/test/briefing signal on subject (used to defeat newsletter/seminar hard-negatives). */
export const STRONG_SELECTION_SUBJECT_HINT =
  /カジュアル面談|一次面接|二次面接|三次面接|四次面接|最終面接|最終選考|書類選考|適性検査|合否/;

/** Pattern used by platform-seminar-promo gate to short-circuit the newsletter path. */
export const PLATFORM_SEMINAR_PROMO_SUBJECT_HINT =
  /セミナー|就活講座|攻略法|面接対策|模擬面接|面接攻略|回答例|回答事例|頻出質問|深掘り質問|基礎知識|就活準備|就活を始める方|希望勤務地別|方向性を考える|企業選びの軸|自分に合った企業|企業研究|インターンシップの体験談|合同説明会|合説|就活イベント|フォーラム|ホール(?!ディングス)|会場|web開催|オンラインイベント|本人確認|会員登録/i;

/** Subject-level bracketed "guide" markers used in newsletter gating. */
export const SUBJECT_BRACKET_GUIDE_PATTERN = /【[^】]{2,40}】/;
export const SUBJECT_SELECTION_GUIDE_PATTERN = /面接のご案内|選考のご案内|書類選考/;

// ─── Event rule table ────────────────────────────────────────────────────────

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

// ─── Co-occurrence boosts ────────────────────────────────────────────────────

export const CO_OCCURRENCE_RULES: readonly CoOccurrenceRule[] = [
  { primary: /面接|面談|interview/i, secondary: /(\d{1,2})月(\d{1,2})日|(\d{1,2}):(\d{2})|(\d{4})[\/年]/, boost: 0.05, appliesTo: "interview" },
  { primary: /面接|面談|interview/i, secondary: /zoom|teams|google\s*meet|webex|skype|オンライン|web/i,    boost: 0.05, appliesTo: "interview" },
  { primary: /カジュアル面談/i, secondary: /(\d{1,2})月(\d{1,2})日|(\d{1,2}):(\d{2})|(\d{4})[\/年]/, boost: 0.05, appliesTo: "casual_interview" },
  { primary: /カジュアル面談/i, secondary: /zoom|teams|google\s*meet|webex|skype|オンライン|web/i,    boost: 0.05, appliesTo: "casual_interview" },
  { primary: /説明会|セミナー/i,     secondary: /(\d{1,2})月(\d{1,2})日|(\d{1,2}):(\d{2})/,                boost: 0.04, appliesTo: "briefing" },
  { primary: /説明会|セミナー/i,     secondary: /視聴|参加|URL/i,                                           boost: 0.03, appliesTo: "briefing" },
  { primary: /テスト|spi|適性検査|assessment/i, secondary: /https?:\/\/|URL|リンク|ログイン/i,            boost: 0.04, appliesTo: "test" },
  { primary: /テスト|spi|適性検査|assessment/i, secondary: /受検期間|受検期限|締切|期限/i,                boost: 0.04, appliesTo: "test" },
  { primary: /締切|期限|deadline/i,  secondary: /(\d{1,2})月(\d{1,2})日|(\d{4})[\/年\-]/,                 boost: 0.04, appliesTo: "deadline" },
  { primary: /見送り|不採用|不合格/i, secondary: /残念|お祈り|ご縁|沿いかねる/i,                           boost: 0.04, appliesTo: "rejection" },
] as const;

// ─── Negative signals ────────────────────────────────────────────────────────

export const NEGATIVE_SIGNALS: readonly NegativeSignal[] = [
  { pattern: /(配信停止|配信解除|unsubscribe|opt[\s-]?out|メール配信の停止|退会)/i, weight: -0.30 },
  { pattern: /(メルマガ|ニュースレター|newsletter|magazine|お役立ち情報|コラム)/i, weight: -0.25 },
  { pattern: /(キャンペーン|campaign|セール|sale|クーポン|coupon|割引)/i,            weight: -0.20 },
  { pattern: /(広告|PR|sponsored|advertisement|プロモーション)/i,                   weight: -0.20 },
  { pattern: /(口コミ|レビュー|review|評判|ランキング|ranking|年収|給与データ)/i,    weight: -0.15 },
  { pattern: /(おすすめのセミナー情報|ビジネスオンライン通信|メールサービス|就活講座|面接対策|模擬面接|頻出質問|回答例|回答事例)/i, weight: -0.20 },
  { pattern: /(新着求人|おすすめ求人|求人情報|job alert|recommended jobs|あなたへのおすすめ)/i, weight: -0.10 },
  { pattern: /(アンケート|アンケートのお願い|ご回答のお願い)/i,                       weight: -0.20 },
  { pattern: /(自動配信|自動送信|自動返信|this is an automated message)/i,           weight: -0.15 },
  { pattern: /(登録完了|パスワード変更|パスワード再発行|メールアドレスの確認|セキュリティ通知|アカウント設定)/i, weight: -0.25 },
] as const;
